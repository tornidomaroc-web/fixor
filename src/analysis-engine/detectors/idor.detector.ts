/**
 * IDOR (Broken Object-Level Authorization) detector.
 *
 * Mirrors Phase 5c (admin-check) architecture: path/import + regex
 * pre-filter (full-content scan), then per-file LLM call via callClaude
 * with a tool that enforces the verdict JSON shape. Only HIGH-confidence
 * verdicts are emitted; MEDIUM is logged via logger.warn for offline
 * review; LOW is dropped silently.
 *
 * Filter order:
 *   1. shouldSkipPath           (negative: tests, fixtures, seeds, etc.)
 *   2. hasServerOnlyMarker      (skip if `import "server-only";` present)
 *   3. prefilterRegex           (require co-occurrence of one SOURCE
 *                                pattern and one SINK pattern within
 *                                PROXIMITY_THRESHOLD lines)
 *   4. LLM call                 (verdict on whether ownership is checked)
 *
 * Co-occurrence is "anywhere in file" at the regex stage; the LLM is
 * responsible for confirming source and sink share a control-flow path
 * (same handler / function). Pairs more than PROXIMITY_THRESHOLD lines
 * apart skip the LLM call; they are almost always unrelated.
 */

import { createHash } from "node:crypto";

import type { Tool } from "@anthropic-ai/sdk/resources/messages";

import type {
  Detector,
  DetectorContext,
  NormalizedFinding,
  NormalizedFixSuggestion,
} from "../detector.types";
import { deriveFindingId } from "../detector.types";
import { callClaude, cachedSystem } from "../anthropic-client";
import { CLAUDE_MODELS } from "../../config/models";
import { logger } from "../../lib/logger";
import { parseDiff, remapFindingLines } from "./shared/diff-parser";
import { SIDECAR_KINDS } from "../sidecar-kinds";
import { extractReportSnippet } from "./shared/route-def-pattern";

const DETECTOR_ID = "idor-multi";

const SUPPORTED_LANGS = [
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "go",
  "rb",
  "java",
  "kt",
] as const;
type SupportedLang = (typeof SUPPORTED_LANGS)[number];

/**
 * Pre-filter pattern shape. `lang` optionally scopes a pattern to a
 * subset of supported languages; patterns without `lang` run against
 * every supported language.
 */
type PrefilterPattern = {
  id: string;
  re: RegExp;
  lang?: SupportedLang[];
};

interface PatternHit {
  patternId: string;
  patternText: string;
  line: number;
}

interface IdorPrefilterHit {
  source: PatternHit;
  sink: PatternHit;
  distance: number;
}

interface LlmVerdict {
  isVulnerable: boolean;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  suggestedFix?: string | null;
  /** Lane FACT (not a verdict): is the handler's caller authenticated?
   *  "unauthenticated" is only claimable for in-signature DI frameworks
   *  (FastAPI/Flask); middleware frameworks report "unclear". */
  callerAuth: "authenticated" | "unauthenticated" | "unclear";
  /** Lane FACT: user-ownable resource access vs an administrative
   *  capability (role change, user management) where an ownership
   *  filter could never be the right fix. */
  operationClass: "user_resource" | "administrative" | "unclear";
}

interface FileDiagnostic {
  file: string;
  preFilterReason?: string;
  triggerCount: number;
  pairDistance?: number;
  verdict?: LlmVerdict | null;
  /** Set when a HIGH verdict was deterministically routed to a sibling
   *  detector's lane (R10) instead of emitting. */
  laneDeferral?: string;
  flagged: boolean;
}
/**
 * SOURCE patterns: a request-derived identifier enters the handler.
 * The pre-filter is permissive on purpose; the LLM is the final judge of
 * whether the value actually flows into a DB lookup unguarded.
 */
const SOURCE_PATTERNS: PrefilterPattern[] = [
  // Express / Node generic
  { id: "express_params",          re: /\breq\.params\.\w+/ },
  { id: "express_query",           re: /\breq\.query\.\w+/ },
  { id: "express_body_id",         re: /\breq\.body\.\w*[iI]d\b/ },
  // Koa
  { id: "koa_ctx_params",          re: /\bctx\.params\.\w+/ },
  // Hono
  { id: "hono_param",              re: /\bc\.req\.param\s*\(/ },
  // NestJS @Param('id') decorator. Framework-specific syntax with low
  // FP risk; @Req()-style NestJS is already covered by `express_params`.
  { id: "nestjs_param",            re: /@Param\s*\(\s*['"][^'"]+['"]\s*\)/ },
  // Next.js App Router (destructured params on the route handler's
  // second arg). Pages Router is covered by `req.query` / `req.params`.
  // Tolerates both Next.js 14 ({ params: { id: string } }) and Next.js
  // 15+ async-params ({ params: Promise<{ id: string }> }) shapes via
  // the optional `Promise<` group. The trailing `\s*\{\s*\w+\s*:\s*string`
  // still requires the inner object-type shape, which is what carries
  // the per-handler ID parameter we need to flow-track to the DB query.
  // Surfaced as a Phase A gap on 2026-05-23; see
  // docs/APP-ROUTER-COVERAGE-PLAN.md Phase A.
  { id: "nextjs_destructured",     re: /\bparams\s*:\s*(?:Promise\s*<\s*)?\{\s*\w+\s*:\s*string/ },
  // tRPC v10+ procedures receive `{ input, ctx }` and dereference
  // `input.X` to pass the request value into the DB query. The actual
  // SOURCE is the property access inside the handler body, not the
  // procedure declaration — schema-reference patterns (input(MyZod))
  // make the declaration site harder to fingerprint than the
  // dereference. `\b` boundary prevents `myinput.foo`-style FPs.
  { id: "trpc_input_access",       re: /\binput\.\w+/ },
  // FastAPI / Starlette
  { id: "fastapi_path_params",     re: /\brequest\.path_params\[/ },
  { id: "fastapi_path_params_alt", re: /\bpath_params\s*\[\s*['"]/ },
  // FastAPI idiomatic typed path/query param as a handler argument
  // (Python slice 1b, 2026-05-28): `@app.get("/items/{item_id}")` +
  // `def read_item(item_id: int)`. The id-typed function arg is the
  // request-derived source slice 1 flagged as the gap. The name
  // alternation (`id` | `*_id` | `*Id`) avoids matching words that merely
  // end in "id" (valid, uuid, void). Permissive by design — the LLM
  // confirms the value reaches the sink without an ownership filter.
  {
    id: "fastapi_typed_path_param",
    re: /\bdef\s+\w+\s*\([^)]*?\b(?:id|[A-Za-z0-9]+_id|[a-z0-9]+Id)\s*:\s*(?:int|str|float|UUID|uuid\.UUID)\b/,
    lang: ["py"],
  },
  // Django
  { id: "django_kwargs_id",        re: /\bkwargs\.get\s*\(\s*['"]\w*id/i },
  { id: "django_request_get",      re: /\brequest\.GET\.get\s*\(\s*['"]\w*id/i },
  // Rails / Sinatra
  { id: "rails_params_sym",        re: /\bparams\[:\w+\]/ },
  // AWS Lambda
  { id: "lambda_path_params",      re: /\bevent\.pathParameters\b/ },
  // Go HTTP routers
  { id: "go_chi_urlparam",         re: /\bchi\.URLParam\s*\(/ },
  { id: "go_mux_vars",             re: /\bmux\.Vars\s*\(/ },
];

/**
 * SINK patterns: a database lookup by identifier. Includes ORM helpers,
 * SQLAlchemy/Django querysets, raw SQL with a WHERE id clause, and
 * common Go DB drivers.
 */
const SINK_PATTERNS: PrefilterPattern[] = [
  // Prisma
  { id: "prisma_find_unique",      re: /\.findUnique\s*\(/ },
  { id: "prisma_find_first",       re: /\.findFirst\s*\(/ },
  // TypeORM / Mongoose / Sequelize / generic
  { id: "orm_find_one",            re: /\.findOne\s*\(/ },
  { id: "orm_find_by_id",          re: /\.findById\s*\(/ },
  { id: "sequelize_find_by_pk",    re: /\.findByPk\s*\(/ },
  // SQLAlchemy
  { id: "sqlalchemy_query_get",    re: /\.query\.get\s*\(/ },
  { id: "sqlalchemy_filter_by_id", re: /\.filter_by\s*\(\s*\w*id\s*=/ },
  // SQLAlchemy 2.0 / SQLModel direct primary-key fetch: `session.get(Item,
  // id)` / `db.get(Item, id)` (Python slice 1b). First arg required to be
  // a Model class (uppercase) so `session.get("string-key")` dict-style
  // lookups do not match. This is the modern idiom the full-stack-fastapi
  // -template uses; the older `.query.get` above is SQLAlchemy 1.x.
  { id: "sqlalchemy_session_get",  re: /\b(?:session|db)\.get\s*\(\s*[A-Z]\w*/, lang: ["py"] },
  // Django ORM
  { id: "django_objects_get",      re: /\.objects\.get\s*\(/ },
  { id: "django_objects_filter",   re: /\.objects\.filter\s*\(\s*\w*id\s*=/ },
  // Active Record (Ruby)
  { id: "rails_find_by",           re: /\.find_by\s*\(/ },
  { id: "rails_class_find",        re: /\b[A-Z]\w*\.find\s*\(/, lang: ["rb"] },
  // Raw SQL via common Node drivers
  { id: "node_pg_query",           re: /\b(?:pool|client|db)\.query\s*\(/ },
  // Go database/sql
  { id: "go_db_queryrow",          re: /\b(?:db|tx)\.(?:QueryRow|Query|Exec)(?:Context)?\s*\(/ },
  // Raw SELECT ... WHERE id (multi-line, bounded)
  { id: "raw_sql_where_id",        re: /\bSELECT\b[\s\S]{0,200}?\bWHERE\s+\w*[iI][dD]\s*=/i },
];

const SKIP_PATH_RE =
  /(^|\/)(test|tests|__tests__|spec|fixtures|examples?|scripts|dev-tools|migrations?|seed|seeds|demo)(\/|$)/i;

const SERVER_ONLY_RE = /^\s*import\s+["']server-only["']\s*;?\s*$/m;

/**
 * Maximum line distance between SOURCE and SINK before we declare the
 * pair unrelated and skip the LLM call. Sized to cover a generously
 * long route handler with helpers above/below, while excluding pairs
 * that almost certainly live in different functions.
 */
const PROXIMITY_THRESHOLD = 200;

const SYSTEM_PROMPT = `You are a security auditor analyzing a code change for IDOR (Insecure
Direct Object Reference) vulnerabilities, also known as broken
object-level authorization.

An IDOR exists when a route handler fetches a resource by an identifier
derived from the request without verifying that the authenticated caller
is authorized to access that specific resource. Authorization can be
enforced by including an ownership filter in the query (e.g.
\`where { id, userId: session.user.id }\`) or by an explicit ownership
check after the fetch (e.g. \`if (resource.userId !== session.user.id)
return 403\`).

Set confidence:
- HIGH: A request-derived ID flows into a DB lookup on an owned resource
  (model has user_id / organization_id / account_id / tenant_id), with
  no ownership filter in the query and no post-fetch ownership check,
  in production runtime code.
- MEDIUM: An ownership check exists but is partial (role-only, or
  applied on some code paths but not this one), or the resource model
  is ambiguous about ownership.
- LOW: Clear ownership filter in the query, explicit ownership guard
  after fetch, resource is intentionally public, or authorization is
  enforced at a layer the regex pre-filter cannot see (RLS, signed
  token).

IMPORTANT: only return findings with confidence "high" or "medium".

Reject (treat as not vulnerable) when:
- The resource is intentionally public (published blog post, public
  profile page, marketing content) and the model has no owner field.
- The endpoint is unambiguously admin-only and admin is intentionally
  granted cross-tenant access (support, fraud review, moderation,
  billing workflows). Concrete admin-only signals:
    * File path contains \`/admin/\` or filename starts with \`admin-\`.
    * Middleware named \`requireAdmin\`, \`isAdmin\`, \`adminOnly\`
      (NOT generic \`requireAuth\`, \`authenticate\`, or \`jwt()\`).
    * Decorator \`@Roles('admin')\`, \`@AdminOnly\`, \`@RequireAdmin\`
      applied in isolation (NOT \`@Roles('admin', 'user')\` or any
      mixed list).
    * Inline check \`session.user.role !== 'admin'\` returning 403
      before DB access (NOT softer checks like \`role !== 'guest'\`
      that admit non-admin users).
    * Controller or class name contains \`Admin\`.
  When the admin gate is clear and EXCLUSIVE, the lack of object-level
  ownership filter is intentional and NOT an IDOR. If the gate is
  mixed (admin + user, or any non-admin role allowed through), this
  clause does NOT apply; fall through to normal IDOR analysis.
- A non-admin role middleware (\`requireAuth\`, \`authenticate\`,
  \`jwt()\` without a role check, generic \`verifyClaims\`) is the
  only authorization. These middlewares enforce session validity but
  not object-level access. Only treat middleware as resolving IDOR if
  it (a) restricts to admin-only per the rule above, (b) explicitly
  injects an ownership filter, or (c) guards against cross-tenant
  access.
- Database-layer row-level security is in force. RLS policies typically
  live in migration files (e.g., \`db/migrations/*.sql\`,
  \`supabase/migrations/*.sql\`, Drizzle policy DDL), NOT in handler
  code; the handler under review only shows symptoms of RLS being
  applied. Absence of the policy text in the handler is NOT evidence of
  missing RLS. Treat ANY of the following handler-visible signals as
  sufficient evidence that RLS is in force:
    * \`SET LOCAL\` of a per-request session variable (e.g.,
      \`app.current_user_id\`, \`app.user_id\`, \`request.jwt.claims\`)
      inside the transaction that wraps the query.
    * Use of a Supabase client (\`createClient\` from
      \`@supabase/supabase-js\`) with the caller's access token bound to
      the request, where queries flow through PostgREST or \`.rpc()\`.
    * A tenant-scoped Prisma client (\`prisma.$extends\` that
      auto-injects a tenant filter on every operation; often named
      \`tenantPrisma\`, \`scopedPrisma\`, or similar).
    * Comments adjacent to the queries that document an RLS policy
      (\`CREATE POLICY ... USING (...)\`, references to \`auth.uid()\`
      inside a policy block, explicit mentions of row-level security on
      the queried table).
    * Imports of Drizzle's \`pgPolicy\` or \`pgRole\` builders from
      \`drizzle-orm/pg-core\`.
  When any one of these signals is present, classify as LOW. Do not
  require the policy text itself to be visible in the file.
- The lookup is on the caller's own resource (fetching session.user,
  current user's profile by their own id, a "me" endpoint).
- The ID is opaque and unforgeable (signed share token, pre-signed S3
  URL, JWT-encoded resource handle) such that possessing it implies
  authorization.

Confidence ladder is strict: when in doubt between high and medium,
choose medium. When in doubt between medium and low, choose low.

LANE FACTS — report routing facts; never change your verdict logic.
Fixor runs sibling detectors for missing authentication (auth-bypass)
and missing admin gates (admin-check). Your isVulnerable judgment stays
purely about object-level authorization, exactly as specified above.
Alongside it, report two FACTS the pipeline uses to route findings to
the right detector lane:

- callerAuth — is the handler's caller authenticated?
    * "authenticated": an auth mechanism is visible for this handler —
      an auth dependency in the signature (\`Depends(get_current_user)\`,
      \`CurrentUser\`, \`Security(...)\`), an auth decorator
      (\`@login_required\`), \`before_action :authenticate*\`, auth
      middleware in the route arglist, or handler code that uses the
      authenticated session/user.
    * "unauthenticated": ONLY when the framework expresses
      authentication in the handler signature or decorator (FastAPI /
      Flask style dependency injection) AND this handler visibly has no
      auth dependency or decorator while the file's imports or sibling
      handlers show the auth idiom is in use. A missing gate here is
      the auth-bypass detector's lane, not an IDOR.
    * "unclear": every other case — especially middleware-mounted
      frameworks (Express, Go net/http, Next.js, Hono, NestJS, tRPC,
      Rails without a visible before_action) where authentication
      commonly lives in another file, so its absence from this window
      proves nothing.
- operationClass — what kind of operation does the route perform?
    * "administrative": the operation is an admin capability — changing
      another user's role / privileges / tier, managing arbitrary user
      accounts (delete/provision users by id), instance-wide settings
      or stats. The correct fix is an admin gate, not an ownership
      filter; that gate's absence is the admin-check detector's lane.
    * "user_resource": ordinary access to a resource a user can own
      (documents, invoices, notes, items, projects, tickets, orders).
    * "unclear": cannot tell from the visible context.

These facts NEVER soften isVulnerable: report the ownership verdict as
before, and the facts as you see them. When in doubt on either fact,
report "unclear".

CONTEXT BLOCKS — Verified RLS policy: when a block titled "Verified RLS policy for this file (ground truth):" appears in the user message, the SQL policy text is the authoritative authorization layer for queries in this file. Apply the existing "database-layer row-level security in force" exception even if the in-file handler shows a bare \`WHERE id = $1\`: the policy auto-scopes rows to the caller. When no such block is present, require handler-visible RLS signals per existing rules (current behavior, unchanged).

CONTEXT BLOCKS — Verified middleware: when a block titled "Verified middleware for this file (ground truth):" appears in the user message, the middleware definition (auth gate, tenant scoping, ORM-level scoping wrapper such as Prisma \`$extends\`) is authoritative for the guarantees applied to handlers in this file. Use the middleware body to determine whether queries are admin-gated, tenant-scoped, or otherwise authorization-bounded before reaching the handler. When no such block is present, assess from handler code alone (current behavior, unchanged).`;

/**
 * Short fingerprint of SYSTEM_PROMPT, computed once at module load.
 * Logged on every debug input snapshot (when FIXOR_DEBUG_IDOR_LLM=1) so
 * operators can confirm prompt stability across runs; a mismatch across
 * runs proves the prompt changed mid-session.
 */
export const SYSTEM_PROMPT_FINGERPRINT = createHash("sha256")
  .update(SYSTEM_PROMPT)
  .digest("hex")
  .slice(0, 12);

/**
 * Module-level latch so the full SYSTEM_PROMPT is emitted only on the
 * FIRST debug input snapshot per process; subsequent snapshots carry
 * only the fingerprint. Hot-reload (`tsx --watch`) resets this; that is
 * acceptable for a debug-only path.
 */
let systemPromptLogged = false;

const REPORT_TOOL: Tool = {
  name: "report_idor_verdict",
  description:
    "Report the IDOR analysis verdict for the supplied code context.",
  input_schema: {
    type: "object",
    properties: {
      isVulnerable: {
        type: "boolean",
        description: "True if this is a real IDOR vulnerability.",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
      },
      reasoning: {
        type: "string",
        description: "1-2 sentences explaining your decision.",
      },
      suggestedFix: {
        type: "string",
        description:
          "1-2 sentences suggesting a fix; empty string if not vulnerable.",
      },
      callerAuth: {
        type: "string",
        enum: ["authenticated", "unauthenticated", "unclear"],
        description:
          "Lane fact (see LANE FACTS in the system prompt): 'unauthenticated' ONLY when the framework expresses auth in the handler signature/decorator (FastAPI/Flask style) and this handler visibly lacks it; for middleware-based frameworks absence is 'unclear'.",
      },
      operationClass: {
        type: "string",
        enum: ["user_resource", "administrative", "unclear"],
        description:
          "Lane fact: 'administrative' when the operation is an admin capability (role/privilege change, arbitrary user management, instance-wide ops) where an ownership filter could never be the right fix.",
      },
    },
    required: [
      "isVulnerable",
      "confidence",
      "reasoning",
      "callerAuth",
      "operationClass",
    ],
  },
};

const EXT_TO_LANG: Record<string, SupportedLang> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  py: "py",
  go: "go",
  rb: "rb",
  java: "java",
  kt: "kt",
};

function languageForPath(path: string): SupportedLang | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

function langDisplay(lang: SupportedLang): string {
  switch (lang) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "py":
      return "python";
    case "go":
      return "go";
    case "rb":
      return "ruby";
    case "java":
      return "java";
    case "kt":
      return "kotlin";
  }
}

function countLinesBefore(content: string, idx: number): number {
  let count = 0;
  const stop = Math.min(idx, content.length);
  for (let i = 0; i < stop; i++) {
    if (content[i] === "\n") count++;
  }
  return count;
}

/**
 * Find every match of every pattern across the file content. Returns
 * line numbers (1-indexed) and a short snippet for telemetry.
 */
function findPatternHits(
  content: string,
  patterns: PrefilterPattern[],
  lang: SupportedLang,
): PatternHit[] {
  const lines = content.split(/\r?\n/);
  const hits: PatternHit[] = [];
  for (const p of patterns) {
    if (p.lang && !p.lang.includes(lang)) continue;
    const flags = p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g";
    const globalRe = new RegExp(p.re.source, flags);
    let m: RegExpExecArray | null;
    while ((m = globalRe.exec(content)) !== null) {
      if (m.index === undefined) break;
      const line = countLinesBefore(content, m.index) + 1;
      const lineText = lines[line - 1] ?? "";
      hits.push({
        patternId: p.id,
        patternText: lineText.trim().slice(0, 200),
        line,
      });
      if (m.index === globalRe.lastIndex) globalRe.lastIndex++;
    }
  }
  return hits;
}

/**
 * Returns the SOURCE/SINK pair closest by absolute line distance, or
 * null if no pair sits within PROXIMITY_THRESHOLD lines.
 */
function closestSourceSinkPair(
  sourceHits: PatternHit[],
  sinkHits: PatternHit[],
): IdorPrefilterHit | null {
  let best: IdorPrefilterHit | null = null;
  for (const s of sourceHits) {
    for (const k of sinkHits) {
      const distance = Math.abs(s.line - k.line);
      if (distance > PROXIMITY_THRESHOLD) continue;
      if (best === null || distance < best.distance) {
        best = { source: s, sink: k, distance };
      }
    }
  }
  return best;
}

/**
 * Build a context window that covers both the source and sink. For
 * tight pairs returns a contiguous slice; for wider pairs returns two
 * focused windows with an omission marker so token cost stays bounded.
 */
function extractIdorContextWindow(
  content: string,
  sourceLine: number,
  sinkLine: number,
): string {
  const lines = content.split(/\r?\n/);
  const minLine = Math.min(sourceLine, sinkLine);
  const maxLine = Math.max(sourceLine, sinkLine);
  const span = maxLine - minLine + 1;
  const MAX_CONTIGUOUS = 230;

  if (span <= MAX_CONTIGUOUS - 20) {
    const start = Math.max(0, minLine - 1 - 10);
    const end = Math.min(lines.length, maxLine - 1 + 10);
    return lines.slice(start, end).join("\n");
  }

  const srcStart = Math.max(0, minLine - 1 - 8);
  const srcEnd = Math.min(lines.length, minLine - 1 + 16);
  const sinkStart = Math.max(0, maxLine - 1 - 8);
  const sinkEnd = Math.min(lines.length, maxLine - 1 + 16);
  const omitted = Math.max(0, sinkStart - srcEnd);
  return (
    lines.slice(srcStart, srcEnd).join("\n") +
    `\n\n// [... ${omitted} lines omitted ...]\n\n` +
    lines.slice(sinkStart, sinkEnd).join("\n")
  );
}

/**
 * Tight context window for finding emission (PR comment, SARIF, PDF).
 * Matches the 8-before / 16-after split used by admin-check and the
 * other Phase 5 detectors so the rendered output stays within the
 * comment-size-guard budget. Independent of the wider window sent to
 * the LLM, which can span the full source-to-sink range.
 */
function extractContextWindow(content: string, lineNumber: number): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, lineNumber - 1 - 8);
  const end = Math.min(lines.length, lineNumber - 1 + 16);
  return lines.slice(start, end).join("\n");
}

function extractImports(content: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < Math.min(40, lines.length); i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (
      /^(import|from\s+\S+\s+import|require\s*\(|const\s+\S+\s*=\s*require|package\s+\w+|@app\.|use\s+strict|"use\s+\w+")/.test(
        trimmed,
      ) ||
      /^[A-Z_].* = require\(/.test(trimmed) ||
      /^require(_relative)?\s+/.test(trimmed)
    ) {
      out.push(line);
    } else if (out.length > 0 && /^[a-z_$]/i.test(trimmed)) {
      break;
    }
  }
  return out.join("\n");
}

function buildUserMessage(params: {
  filePath: string;
  language: string;
  contextWindow: string;
  imports: string;
  sourcePattern: string;
  sourceLine: number;
  sinkPattern: string;
  sinkLine: number;
  pairDistance: number;
  sidecars?: Record<string, string>;
}): string {
  const policy = params.sidecars?.[SIDECAR_KINDS.RLS_POLICY];
  const middleware = params.sidecars?.[SIDECAR_KINDS.MIDDLEWARE];
  let sidecarSection = "";
  if (policy) {
    sidecarSection += `\n\nVerified RLS policy for this file (ground truth):\n\`\`\`sql\n${policy.trim()}\n\`\`\``;
  }
  if (middleware) {
    sidecarSection += `\n\nVerified middleware for this file (ground truth):\n\`\`\`typescript\n${middleware.trim()}\n\`\`\``;
  }
  return `CONTEXT:
File: ${params.filePath}
Language: ${params.language}${sidecarSection}
Code context (covers both source and sink):
\`\`\`${params.language}
${params.contextWindow}
\`\`\`

Imports in file:
\`\`\`${params.language}
${params.imports}
\`\`\`

Pre-filter triggers:
- SOURCE (request-derived identifier) at line ${params.sourceLine}: ${params.sourcePattern}
- SINK (database lookup) at line ${params.sinkLine}: ${params.sinkPattern}
- Lines between source and sink: ${params.pairDistance}

Analyze whether this is a real IDOR. Specifically:

1. Does the request-derived identifier flow into the DB lookup, in the
   same handler / control-flow path?
2. Is there an ownership filter in the query (e.g. \`where { id, userId }\`)?
3. Is there an explicit ownership check after the fetch?
4. Is the resource intentionally public, or owned (model has user_id /
   organization_id / tenant_id)?
5. Is authorization enforced at the DB layer (Postgres RLS, Supabase
   policies, tenant-scoped Prisma client)?
6. Does a role-only middleware appear sufficient here? It usually is
   NOT, for IDOR; only middleware that injects an ownership filter or
   guards object-level access counts.

Call the report_idor_verdict tool with your verdict.`;
}

export class IdorDetector implements Detector {
  readonly id = DETECTOR_ID;
  readonly displayName = "Broken Object-Level Authorization (IDOR)";
  readonly supports = ["idor_risk"] as const;
  readonly languages = SUPPORTED_LANGS;

  /** For test diagnostics; reset at the start of each `detect()` call. */
  public lastDiagnostics: FileDiagnostic[] = [];

  async detect(ctx: DetectorContext): Promise<NormalizedFinding[]> {
    this.lastDiagnostics = [];
    const findings: NormalizedFinding[] = [];

    for (const file of parseDiff(ctx.diff)) {
      const lang = languageForPath(file.path);
      if (!lang) {
        this.lastDiagnostics.push({
          file: file.path,
          preFilterReason: "unsupported language",
          triggerCount: 0,
          flagged: false,
        });
        continue;
      }

      if (this.shouldSkipPath(file.path)) {
        this.lastDiagnostics.push({
          file: file.path,
          preFilterReason: "path filter",
          triggerCount: 0,
          flagged: false,
        });
        continue;
      }

      if (this.hasServerOnlyMarker(file.content)) {
        this.lastDiagnostics.push({
          file: file.path,
          preFilterReason: "server-only marker",
          triggerCount: 0,
          flagged: false,
        });
        continue;
      }

      const sidecars = ctx.sidecarsByPath?.[file.path];
      const fileFindings = await this.analyzeFile(
        file.path,
        file.content,
        lang,
        sidecars,
      );
      // Translate content-relative line numbers to real target-file
      // lines (identity for synthetic whole-file diffs; hunk-mapped
      // for real PR diffs). See shared/diff-parser.ts.
      findings.push(...remapFindingLines(fileFindings, file.lineMap));
    }

    return findings;
  }

  async fix(finding: NormalizedFinding): Promise<NormalizedFixSuggestion> {
    return {
      findingId: deriveFindingId(finding),
      detectorId: DETECTOR_ID,
      findingType: "idor_risk",
      file: finding.file,
      line: finding.startLine,
      originalCode: finding.originalCode,
      fixedCode: finding.originalCode,
      explanation:
        finding.explanation ||
        "IDOR detected. Add an ownership filter to the query (e.g. `where { id, userId: session.user.id }`) or an explicit ownership check after the fetch. Fixes depend on the resource's ownership field; no automated patch produced.",
      confidence: finding.confidence,
      patchQuality: "low",
      patchWarnings: [
        "IDOR fixes depend on the resource ownership model; no automated patch produced.",
      ],
    };
  }

  /** Public for test access; production callers should go through detect(). */
  async analyzeFile(
    filePath: string,
    content: string,
    lang: SupportedLang,
    sidecars?: Record<string, string>,
  ): Promise<NormalizedFinding[]> {
    const sourceHits = findPatternHits(content, SOURCE_PATTERNS, lang);
    const sinkHits = findPatternHits(content, SINK_PATTERNS, lang);
    const diag: FileDiagnostic = {
      file: filePath,
      triggerCount: sourceHits.length + sinkHits.length,
      flagged: false,
    };

    if (sourceHits.length === 0 || sinkHits.length === 0) {
      diag.preFilterReason = "no source/sink co-occurrence";
      this.lastDiagnostics.push(diag);
      return [];
    }

    const pair = closestSourceSinkPair(sourceHits, sinkHits);
    if (!pair) {
      diag.preFilterReason = `source/sink > ${PROXIMITY_THRESHOLD} lines apart`;
      this.lastDiagnostics.push(diag);
      return [];
    }
    diag.pairDistance = pair.distance;

    const verdict = await this.callLlm({
      filePath,
      language: langDisplay(lang),
      contextWindow: extractIdorContextWindow(
        content,
        pair.source.line,
        pair.sink.line,
      ),
      imports: extractImports(content),
      sourcePattern: pair.source.patternText,
      sourceLine: pair.source.line,
      sinkPattern: pair.sink.patternText,
      sinkLine: pair.sink.line,
      pairDistance: pair.distance,
      sidecars,
    });
    diag.verdict = verdict;

    if (!verdict || !verdict.isVulnerable) {
      this.lastDiagnostics.push(diag);
      return [];
    }
    if (verdict.confidence === "low") {
      this.lastDiagnostics.push(diag);
      return [];
    }
    if (verdict.confidence === "medium") {
      logger.warn(
        {
          category: "idor-review-queue",
          file: filePath,
          sourceLine: pair.source.line,
          sinkLine: pair.sink.line,
          // Log pattern IDs only: matched line text may contain secrets or PII.
          sourcePatternId: pair.source.patternId,
          sinkPatternId: pair.sink.patternId,
          reasoning: verdict.reasoning,
        },
        "idor: medium-confidence verdict suppressed",
      );
      this.lastDiagnostics.push(diag);
      return [];
    }

    // Lane discipline (R10) — deterministic routing bound, in code per
    // the deterministic-safety-bounds rule: the model rationalizes past
    // prose lane clauses (a prompt-only clause was tried and reverted),
    // so the LLM reports lane FACTS and THIS code decides. The gate only
    // ever converts an emit-bound HIGH verdict into a review-queue
    // deferral; "unclear" fails open and emits, so windows that cannot
    // see auth (Express/Go middleware frameworks) are unaffected.
    const laneDeferral =
      verdict.callerAuth === "unauthenticated"
        ? "caller unauthenticated — auth-bypass lane"
        : verdict.operationClass === "administrative"
          ? "administrative operation — admin-check lane"
          : null;
    if (laneDeferral) {
      logger.warn(
        {
          category: "idor-lane-deferral",
          file: filePath,
          sourceLine: pair.source.line,
          sinkLine: pair.sink.line,
          callerAuth: verdict.callerAuth,
          operationClass: verdict.operationClass,
          laneDeferral,
          reasoning: verdict.reasoning,
        },
        "idor: HIGH verdict deferred to sibling detector lane",
      );
      diag.laneDeferral = laneDeferral;
      this.lastDiagnostics.push(diag);
      return [];
    }

    diag.flagged = true;
    this.lastDiagnostics.push(diag);

    const reportLine = pair.sink.line;
    const snippet = extractReportSnippet(content, reportLine);
    return [
      {
        detectorId: DETECTOR_ID,
        type: "idor_risk",
        file: filePath,
        startLine: reportLine,
        endLine: reportLine,
        originalCode: snippet,
        ruleId: `idor-${pair.source.patternId}-${pair.sink.patternId}`,
        message: verdict.reasoning,
        explanation: verdict.reasoning,
        confidence: "high",
        severity: "critical",
      },
    ];
  }

  private shouldSkipPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/");
    return SKIP_PATH_RE.test(normalized);
  }

  private hasServerOnlyMarker(content: string): boolean {
    return SERVER_ONLY_RE.test(content);
  }

  private async callLlm(params: {
    filePath: string;
    language: string;
    contextWindow: string;
    imports: string;
    sourcePattern: string;
    sourceLine: number;
    sinkPattern: string;
    sinkLine: number;
    pairDistance: number;
    sidecars?: Record<string, string>;
  }): Promise<LlmVerdict | null> {
    const userMessage = buildUserMessage(params);
    const debugLlm = process.env.FIXOR_DEBUG_IDOR_LLM === "1";

    if (debugLlm) {
      const includeFullPrompt = !systemPromptLogged;
      systemPromptLogged = true;
      logger.info(
        {
          category: "idor-debug-llm-input",
          file: params.filePath,
          sourceLine: params.sourceLine,
          sinkLine: params.sinkLine,
          systemPromptFingerprint: SYSTEM_PROMPT_FINGERPRINT,
          ...(includeFullPrompt ? { systemPrompt: SYSTEM_PROMPT } : {}),
          userMessage,
        },
        "idor: LLM input snapshot",
      );
    }

    const result = await callClaude({
      callerId: DETECTOR_ID,
      model: CLAUDE_MODELS.DETECTION,
      system: cachedSystem(SYSTEM_PROMPT),
      tool: REPORT_TOOL,
      temperature: 0,
      messages: [{ role: "user", content: userMessage }],
    });

    if (debugLlm) {
      logger.info(
        {
          category: "idor-debug-llm-output",
          file: params.filePath,
          result: result.ok
            ? { toolInput: result.toolInput, text: result.text }
            : { error: result.reason },
        },
        "idor: LLM output snapshot",
      );
    }

    if (!result.ok) {
      logger.warn(
        { reason: result.reason, file: params.filePath },
        "idor: LLM call failed",
      );
      return null;
    }

    const input = result.toolInput as
      | {
          isVulnerable?: boolean;
          confidence?: string;
          reasoning?: string;
          suggestedFix?: string | null;
          callerAuth?: string;
          operationClass?: string;
        }
      | undefined;
    if (
      !input ||
      typeof input.isVulnerable !== "boolean" ||
      typeof input.confidence !== "string" ||
      typeof input.reasoning !== "string"
    ) {
      logger.warn(
        { file: params.filePath, input },
        "idor: malformed verdict",
      );
      return null;
    }
    const conf = input.confidence.toLowerCase();
    if (conf !== "high" && conf !== "medium" && conf !== "low") {
      return null;
    }
    // Lane facts parse defensively to "unclear" (fail-open: emit). A
    // missing or malformed fact must never suppress a finding.
    const callerAuth =
      input.callerAuth === "authenticated" ||
      input.callerAuth === "unauthenticated"
        ? input.callerAuth
        : "unclear";
    const operationClass =
      input.operationClass === "user_resource" ||
      input.operationClass === "administrative"
        ? input.operationClass
        : "unclear";
    return {
      isVulnerable: input.isVulnerable,
      confidence: conf as LlmVerdict["confidence"],
      reasoning: input.reasoning,
      suggestedFix: input.suggestedFix ?? null,
      callerAuth,
      operationClass,
    };
  }
}
