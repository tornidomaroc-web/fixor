/**
 * Authorization-bypass detector.
 *
 * Two-stage filter:
 *  1. Path/import + regex pre-filter (cheap, runs in-process).
 *  2. Per-file LLM call via callClaude with a tool that enforces the
 *     verdict JSON shape.
 *
 * HIGH and MEDIUM verdicts are both EMITTED as findings, carrying the
 * model's own confidence; LOW is dropped silently. MEDIUM used to be
 * discarded to a logger.warn nothing consumed — the emit-policy decision
 * of 2026-08-07 ended that. Severity is unchanged by confidence.
 *
 * NOTE: /server/, /lib/server/, /api/server/ are NOT path-skipped — real
 * bypass bugs live in those folders. Server-only context is detected via
 * the explicit `import "server-only";` directive only.
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
import { resolveMediumVerdict } from "../verdict-escalation";
import { parseDiff, remapFindingLines } from "./shared/diff-parser";
import {
  APP_ROUTER_ROUTE_DEF_RE,
  EXPRESS_ROUTE_DEF_RE,
  REMIX_HANDLER_DEF_RE,
  FASTAPI_ROUTE_DEF_RE,
  FLASK_ROUTE_DEF_RE,
  buildFunctionCodePayload,
  isRemixRoutePath,
  isPythonPath,
  resolveRouteAnchorLine,
  extractReportSnippet,
} from "./shared/route-def-pattern";
import { SIDECAR_KINDS } from "../sidecar-kinds";

const DETECTOR_ID = "auth-bypass-multi";

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

interface PrefilterHit {
  patternId: string;
  patternText: string;
  line: number;
}

interface LlmVerdict {
  isVulnerable: boolean;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  suggestedFix?: string | null;
  /** Method+path of the single route this verdict concerns, copied verbatim
   *  by the LLM, used to anchor the finding at that route (not the first
   *  route in the file). Optional; absent → fall back to the trigger line. */
  vulnerableRoute?: string | null;
  /** Lane fact (H7): is the route under review gated by an AUTHENTICATION
   *  mechanism (caller identified)? Distinct from authorization for the
   *  specific action. A sabotaged/bypassed check reports "no". */
  authPresent: "yes" | "no" | "unclear";
  /** Lane fact (H7): is the sensitive operation administrative (manages
   *  other users / roles / privilege / system state) or a general
   *  authenticated operation? */
  operationKind: "admin" | "general";
}

interface FileDiagnostic {
  file: string;
  preFilterReason?: string;
  triggerCount: number;
  verdict?: LlmVerdict | null;
  flagged: boolean;
  /** Set when a HIGH verdict was deferred to a sibling detector's lane
   *  (H7) instead of emitted — e.g. auth present on an admin route. */
  laneDeferral?: string;
}
const PREFILTER_PATTERNS: { id: string; re: RegExp }[] = [
  // anonymous bypass (multi-language)
  { id: "anon_strict_eq", re: /\b(userId|user_id|userID)\s*={2,3}\s*['"]anonymous['"]/i },
  { id: "anon_equals_method", re: /\b(userId|user_id|userID)\.equals\(\s*['"]anonymous['"]/i },

  // role wildcard / OR-true
  { id: "role_or_true", re: /\brole\s*={2,3}\s*['"](admin|owner)['"]\s*\|\|/i },
  { id: "or_true_literal", re: /\|\|\s*true\b/ },

  // token === public
  { id: "token_public", re: /\btoken\s*={2,3}\s*['"]public['"]/i },

  // DEFAULT user/admin id/email
  { id: "default_user_id", re: /\bDEFAULT_(USER|ADMIN)_ID\b/ },
  { id: "default_admin_email", re: /\bDEFAULT_ADMIN_EMAIL\b/ },

  // role coerced to admin via fallback
  { id: "role_or_admin", re: /\brole\s*\|\|\s*['"](admin|owner)['"]/i },
  { id: "role_nullish_admin", re: /\brole\s*\?\?\s*['"](admin|owner)['"]/i },

  // JWT verify with try/catch (suspicious; LLM decides)
  { id: "jwt_verify", re: /\bjwt\.verify\s*\(/ },
  { id: "jwt_verify_false", re: /["']?verify_signature["']?\s*[:=]\s*False/i },

  // Ruby params fallback to admin
  { id: "ruby_admin_fallback", re: /params\[:\w+\]\s*\|\|\s*['"]admin['"]/ },

  // Express-family route definition (Phase 1 missing-middleware
  // remediation, factored to detectors/shared/route-def-pattern.ts in
  // Phase 2 so admin-check can share the same trigger). Catches an
  // HTTP route declaration on a router-like identifier and routes
  // the whole file (subject to a size cap) to the LLM, which then
  // judges whether the route has appropriate auth middleware in its
  // argument list. We accept that every Express routes file now
  // reaches the LLM — see shouldSkipPath() which still excludes
  // test/fixtures/demo/scripts dirs from production scans.
  //
  // Limitation by design (Phase 1+2): Express-family only. Fastify,
  // Koa, Hono are NOT covered until we add positive fixtures for
  // each.
  { id: "express_route_def", re: EXPRESS_ROUTE_DEF_RE },
  // File-system-routed framework handlers (Next.js App Router, Remix).
  // Sibling to express_route_def — both trigger whole-file LLM context
  // selection via buildFunctionCodePayload. The HOC-name-convention
  // judgment for App Router handlers happens in the LLM stage; the
  // prefilter just gates which files reach the model.
  { id: "app_router_route_def", re: APP_ROUTER_ROUTE_DEF_RE },
  // Remix v2 `loader` / `action` exports (Phase E, 2026-05-23). Sibling
  // to app_router_route_def with the same downstream wiring (whole-file
  // payload, missing-HOC-wrapper rubric in SYSTEM_PROMPT case 3). The
  // prefilter applies isRemixRoutePath to bound the over-match risk on
  // utility modules that export `loader`/`action` from outside
  // `app/routes/` — see analyzeFile.
  { id: "remix_handler_def", re: REMIX_HANDLER_DEF_RE },
  // FastAPI / Flask-2.0 route decorators (Python slice 1, 2026-05-28).
  // Lang-gated to `.py` in prefilterRegex (isPythonPath) so it cannot
  // fire on TS files and the JS route-def patterns cannot fire on Python.
  // Routes the whole file to the LLM, which judges whether the decorated
  // handler has an auth-suggesting `Depends(...)` dependency or an inline
  // auth check (SYSTEM_PROMPT case 4 — in-file Depends only this slice).
  { id: "fastapi_route_def", re: FASTAPI_ROUTE_DEF_RE },
  // Flask classic `@app.route(..., methods=[...])` decorator (Python Flask
  // slice, 2026-05-28). Lang-gated to `.py`. The `.route` method is
  // Flask-only (no FastAPI overlap); the shared `@app.get` shorthand is
  // matched by fastapi_route_def and disambiguated in the LLM stage by
  // imports. SYSTEM_PROMPT case 6 (Flask). In-file decorator/name-
  // convention only this slice.
  { id: "flask_route_def", re: FLASK_ROUTE_DEF_RE },
];

const SKIP_PATH_RE =
  /(^|\/)(test|tests|__tests__|spec|fixtures|examples?|scripts|dev-tools|migrations?|seed|seeds|demo)(\/|$)/i;

const SERVER_ONLY_RE = /^\s*import\s+["']server-only["']\s*;?\s*$/m;

const SYSTEM_PROMPT = `You are a security auditor analyzing a code change for authorization bypass
vulnerabilities. Authorization bypass means a code path skips, weakens, or
bypasses authorization checks based on user-controlled or hardcoded values.

Bypass shapes you must detect:
1. Sentinel-string bypasses: hardcoded values like "anonymous" / "admin" /
   "public" that skip ownership checks, OR shortcuts like \`|| true\`,
   \`|| "admin"\`, JWT verify with swallowed errors, verify_signature=False.
2. Missing-middleware bypasses: an HTTP route declaration on an
   Express-family router (e.g., \`router.post("/users/delete", handler)\`,
   \`adminRouter.delete("/x", handler)\`) where the route performs a
   destructive or sensitive action (delete, update, admin operation, money
   movement, account changes) and has NO authentication/authorization
   middleware in its argument list. Strong tell: sibling routes in the
   SAME file DO pass an auth middleware (e.g., requireAuth, isAdmin) as
   an argument and only this route is missing it. If every sibling route
   on the same router is also unguarded, it is more likely a public
   router by design — be cautious and prefer medium/low confidence
   unless the route is unambiguously destructive.
3. Missing-HOC-wrapper bypasses on file-system-routed frameworks
   (Next.js App Router, Remix): a handler exported as
   \`export const POST = ...\`, \`export async function GET(...)\`, or
   \`export default function PUT(...)\` performs a destructive or
   sensitive action AND is NOT wrapped in a higher-order function whose
   NAME convention suggests auth/admin enforcement.
   - Treat as GATED (NOT vulnerable) when wrapped in any of:
     \`withAuth\`, \`withAdmin\`, \`requireAuth\`, \`requireAdmin\`,
     \`protect\`, \`secure\`, \`authMiddleware\`,
     \`withMiddleware(auth, ...)\`, or any HOC identifier containing
     "auth" or "admin" as a substring of its name.
   - For HOCs whose name contains "session" as a substring
     (\`withSession\`, \`withSessionAuth\`, \`withSessionGuard\`,
     \`withSessionTracking\`, \`withSessionAnalytics\`, etc.):
     session counts as gating ONLY when the handler body uses the
     session value for an authorization decision — e.g., a 401
     return on missing session, or an ownership filter keyed on
     \`session.user.id\` in the destructive query. A session-
     substring HOC whose body merely sets a tracking cookie, fires
     an analytics event, or otherwise does NOT use the session for
     an authorization decision is NOT gating, and the route is
     effectively unguarded.
   - Do NOT assume gating for HOCs whose name does not suggest auth:
     \`withLogging\`, \`withCors\`, \`withRateLimit\`, \`withTrace\`,
     \`withErrorBoundary\`, \`withMetrics\`, \`withDb\`, \`withCache\`.
     These are observability / policy / infrastructure wrappers, not
     auth gates — the route is effectively unguarded.
   - Generic-named wrappers like \`withRoute(...)\` or \`appWrapper(...)\`
     are ambiguous — treat as UNgated by default. An HOC that hides auth
     invisibly behind a non-auth-suggesting name is a documented
     out-of-scope limitation analogous to Express's cross-file
     \`router.use(authMiddleware)\` gap.
   - Bare \`export async function POST(req) { ... }\` with no wrapper
     and no inline auth check in the body is unguarded.
   - Inline auth checks in the handler body (e.g., a call to
     \`await getServerSession()\` followed by an unauthorized return,
     or \`auth()\` returning a user, or an explicit \`requireAdmin()\`
     call before the destructive action) DO count as gating — judge
     content, not just the wrapper.
4. Cross-file PARENT-LAYOUT guard (Remix / React Router v7 only): when a
   "PARENT ROUTE GUARDS" block is present in the context below, it holds
   the loader(s) of this route's ancestor layout route(s), resolved from
   the file system. Judge them with the SAME rigor as an in-file guard:
   - GATES only if the layout loader (a) performs an auth/session check
     AND (b) BLOCKS on failure (throw redirect, throw a 401/403 Response).
     A loader that merely READS the session without blocking is NOT a gate
     — the same rule as a withSession HOC whose body never uses the session
     for an authorization decision.
   - COVERAGE: a guard may CLEAR this route (isVulnerable=false) ONLY when
     its "Structural coverage" is PROVEN. If coverage is UNVERIFIED you
     MUST NOT clear the route: set isVulnerable=true with confidence at
     most medium (review queue). "Read-only", "likely nested", or the
     file path are NOT grounds to clear — only a PROVEN, blocking guard
     clears.
   - READ vs WRITE: a layout exposes a \`loader\`, which runs before child
     loaders on GET (reads) but NOT before a child route's \`action\`
     (mutations run first). So a parent layout loader gates READ access
     only. If the concern is a destructive ACTION in this route, the
     parent loader does NOT gate it — judge the action's own authorization
     and ignore the parent loader for that concern.
   - When a PROVEN, blocking parent layout loader gates the READ concern
     that triggered review, the route is NOT vulnerable (isVulnerable
     false, low): the apparent missing in-file check is a false positive
     because the gate lives in the ancestor layout.
PYTHON FRAMEWORK DISAMBIGUATION (read before cases 5-6): the
\`@app.get\`/\`@app.post\` decorator SHORTHAND is shared by FastAPI and
Flask 2.0, so decide the framework from the file's IMPORTS. \`from fastapi\`
/ \`import fastapi\` => FastAPI, use case 5 (Depends/Security rubric).
\`from flask\` / \`from flask_login\` / \`import flask\` => Flask, use case 6
(decorator/current_user rubric). Flask's \`@app.route(...)\` decorator is
Flask-only. If the file imports NEITHER framework (the app/router is
imported from another module and no framework primitive is imported here),
you CANNOT attribute the framework in-file: do NOT apply either missing-
guard rubric, return isVulnerable=false, low (cross-file attribution, out
of scope).

5. Missing-Depends-auth bypasses on FastAPI: a handler decorated with
   \`@app.METHOD\` / \`@router.METHOD\` (e.g. \`@router.delete("/items/{id}")\`)
   in a file whose imports show FastAPI, that performs a destructive or
   sensitive action AND has NO authentication dependency and no inline
   auth check is unguarded.
   - Treat as GATED (NOT vulnerable) when the handler signature includes
     an auth-suggesting FastAPI dependency by NAME convention:
     \`Depends(get_current_user)\`, \`Depends(get_current_active_user)\`,
     \`Depends(require_admin)\`, \`Depends(get_admin_user)\`,
     \`Depends(verify_token)\`, \`Depends(authenticate)\`, a \`Security(...)\`
     dependency, or any \`Depends(...)\` whose function name contains
     "auth", "current_user", "admin", "require", "verify", "login", or
     "permission" as a substring. Flask: an \`@login_required\` /
     \`@admin_required\` decorator counts as gating.
   - NON-auth dependencies do NOT gate: \`Depends(get_db)\`,
     \`Depends(get_session)\` (a SQLAlchemy/SQLModel DB session, NOT an
     auth session), \`Depends(get_settings)\`, \`Depends(pagination_params)\`,
     \`Depends(get_redis)\`. A route whose ONLY dependencies are these is
     effectively unguarded. The "session" ambiguity follows the same rule
     as a session-substring HOC: \`get_session\` counts as auth ONLY if the
     handler body uses its value for an authorization decision (a 401/403
     raise, or an ownership filter keyed on the user); a bare DB session
     dependency is not auth.
   - Inline auth checks in the body DO count: \`if not current_user...:
     raise HTTPException(status_code=401)\`, an explicit role check, or a
     \`Depends\`-injected user that is then checked before the action.
   - What the function passed to \`Depends(...)\` actually does lives in
     another module; verifying that (and router-level
     \`dependencies=[Depends(...)]\` declared where the router is created)
     is cross-file and OUT OF SCOPE this slice — judge by the dependency's
     NAME convention, exactly like the App Router HOC-wrapper rule.
6. Missing-auth bypasses on Flask: a route decorated with
   \`@app.route(..., methods=[...])\` or the \`@app.get\`/\`@app.post\`
   shorthand, in a file whose imports show Flask (per the disambiguation
   rule above), performing a destructive or sensitive action with no auth.
   - Treat as GATED (NOT vulnerable) when the route function is decorated
     with \`@login_required\` (flask_login) or any decorator whose name
     contains "login_required", "auth", "requires_auth", or "authenticated"
     as a substring; OR the body uses \`current_user\` (flask_login) /
     \`g.user\` / \`session[...]\` for an authorization decision (a 401/403
     \`abort()\`, or a redirect to login on missing/invalid user).
   - A bare \`@app.route(...)\` / \`@app.post(...)\` with no auth decorator
     and no inline \`current_user\`/\`g.user\`/\`session\` auth check,
     performing a sensitive action, is unguarded.
   - A custom decorator whose auth behavior is defined in another module is
     cross-file and OUT OF SCOPE — judge by decorator NAME convention,
     exactly like the FastAPI and HOC rules.

Set confidence:
- HIGH: Clear evidence of bypass in destructive operation (DELETE/UPDATE/admin action).
  For missing-middleware: destructive route, sibling routes are guarded, no other
  auth signal in the handler body.
  For missing-HOC-wrapper: destructive App Router handler, no auth-suggesting
  HOC, no inline auth check in the body.
- MEDIUM: Pattern present but context partially ambiguous (e.g., handler does
  destructive work but the wrapper name is generic and could plausibly enforce
  auth; or sibling \`route.ts\` files in the same /app/api/ subtree are gated
  and this one is not, but the action is not unambiguously destructive).
- LOW: Pattern present but context strongly suggests safety (e.g., every route on
  the router is unguarded by design, the handler itself checks req.user, the
  App Router handler wraps an auth-suggesting HOC, or the handler body contains
  an explicit auth check before the destructive action).

IMPORTANT:
- Only return findings with confidence "high" or "medium".
- Reject patterns in test/, fixtures/, examples/, scripts/, dev-tools/ paths.
- Reject when imports show server-only or internal-only modules.
- Reject when the pattern appears in seed/migration scripts.
- For missing-middleware: a route is NOT vulnerable if requireAuth (or an
  equivalent auth middleware) appears as an argument to the route call, OR
  if the router itself was mounted under an auth-protected base path that
  is visible in the imports/context.
- For missing-HOC-wrapper: a route is NOT vulnerable if it is wrapped in an
  auth-suggesting HOC by name convention, OR if the handler body contains an
  explicit auth check before the destructive action, OR if every sibling
  \`route.ts\` in the same /app/api/ subtree is also unwrapped (suggesting
  public-by-design rather than missed gating).
- A route is NOT vulnerable when a PROVEN, blocking parent-layout loader in
  the PARENT ROUTE GUARDS block gates the READ concern that triggered review
  — the authorization check lives cross-file in the ancestor layout. This
  applies to read/loader concerns only; a destructive ACTION is never gated
  by a parent loader.
- For FastAPI: a route is NOT vulnerable if an auth-suggesting Depends/
  Security dependency (by name convention) is in the handler signature, OR
  the body contains an inline auth check before the sensitive action. A
  bare \`Depends(get_db)\` / \`Depends(get_session)\` / other non-auth
  dependency is NOT sufficient.
- For Flask: a route is NOT vulnerable if it is decorated with
  \`@login_required\` (or a login/auth-named decorator), OR the body uses
  \`current_user\`/\`g.user\`/\`session\` for an authorization decision. A
  bare \`@app.route\`/\`@app.post\` with no auth decorator and no inline
  user check is unguarded. Attribute Flask vs FastAPI by the file's imports
  for the shared \`@app.get\`/\`@app.post\` shorthand.

LANE FACTS (report ALWAYS, alongside every verdict — even when not
vulnerable). These route a finding to the correct detector's lane. Judge
them only from the context shown; do not assume beyond the file.
- authPresent: is the route/handler gated by AUTHENTICATION — is the CALLER
  IDENTIFIED (logged in)? This is distinct from whether the caller is
  AUTHORIZED for this specific action.
  * "yes": an auth signal gates the route — an auth middleware argument
    (requireAuth, isAuthenticated, ensureLoggedIn), a router-level
    \`router.use(requireAuth)\` visible in this file, an auth-suggesting
    \`Depends(...)\`/\`Security(...)\` in the FastAPI signature, a parameter
    typed as the current user (\`current_user: CurrentUser\`,
    \`user: CurrentUser\`, or any alias that injects the authenticated
    principal), a Flask \`@login_required\`, or an inline session/token
    check that BLOCKS (401/403/redirect) when the caller is absent.
  * "no": reachable anonymously — no auth middleware, no auth dependency, no
    auth decorator, no blocking inline identity check. A non-auth dependency
    alone (\`Depends(get_db)\`, a bare DB \`get_session\`) is NOT auth. A
    SABOTAGED or BYPASSED check is also "no" — \`role === "admin" || true\`,
    \`role || "admin"\`, a swallowed \`jwt.verify\` downgrading to anon: the
    check is defeated, so authentication is effectively absent (and that
    bypass is squarely auth-bypass's own lane, NOT a deferral).
  * "unclear": auth may exist but cannot be confirmed here (mounted on the
    router elsewhere, or behind an ambiguously named wrapper). When unsure,
    prefer "unclear" or "no" over "yes".
- operationKind: is the sensitive operation ADMINISTRATIVE or GENERAL?
  * "admin": manages OTHER users or system-wide state, assigns or escalates
    roles/privileges (sets \`role\`, \`is_superuser\`/\`isSuperuser\`, grants
    permissions), or otherwise legitimately requires elevated (admin)
    privilege.
  * "general": an ordinary authenticated operation — a user acting on their
    own resource, routine CRUD, a general-purpose API.
These two facts are reported in addition to — and never change — your
isVulnerable / confidence verdict above. Report what you see; downstream
code decides routing.`;

export const SYSTEM_PROMPT_FINGERPRINT = createHash("sha256")
  .update(SYSTEM_PROMPT)
  .digest("hex")
  .slice(0, 12);

const REPORT_TOOL: Tool = {
  name: "report_auth_bypass_verdict",
  description:
    "Report the auth-bypass analysis verdict for the supplied code context.",
  input_schema: {
    type: "object",
    properties: {
      isVulnerable: {
        type: "boolean",
        description: "True if this is a real authorization bypass.",
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
      vulnerableRoute: {
        type: "string",
        description:
          "The HTTP method and path of the SINGLE route your verdict concerns, copied verbatim from its decorator/definition (e.g. \"DELETE /users/{user_id}\"). Empty string if not a route-specific finding or not vulnerable.",
      },
      authPresent: {
        type: "string",
        enum: ["yes", "no", "unclear"],
        description:
          "Lane fact: is the route/handler under review gated by an AUTHENTICATION mechanism (is the CALLER IDENTIFIED — logged in)? NOT about authorization for the specific action. \"yes\" = an auth middleware arg (requireAuth), a router.use(requireAuth) visible in-file, an auth-suggesting Depends/Security or a current-user-typed param (e.g. current_user: CurrentUser), an @login_required decorator, or an inline session/token check that BLOCKS when absent. \"no\" = reachable anonymously, OR the only check is sabotaged/bypassed (|| true, role||\"admin\", swallowed jwt.verify) — a defeated check is NOT auth present. \"unclear\" = auth may be mounted cross-file or behind an ambiguous wrapper.",
      },
      operationKind: {
        type: "string",
        enum: ["admin", "general"],
        description:
          "Lane fact: is the sensitive operation ADMINISTRATIVE — manages OTHER users, assigns/escalates roles or privileges (role, is_superuser/isSuperuser, permissions), or mutates system-wide state — or GENERAL (a user acting on their own resource, routine CRUD, general API)?",
      },
    },
    required: ["isVulnerable", "confidence", "reasoning", "authPresent", "operationKind"],
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
      // First real declaration after the import block.
      break;
    }
  }
  return out.join("\n");
}

function buildUserMessage(params: {
  filePath: string;
  language: string;
  functionCode: string;
  imports: string;
  triggerPattern: string;
  lineNumber: number;
  routeGuard?: string | null;
}): string {
  const guardBlock = params.routeGuard
    ? `\nPARENT ROUTE GUARDS (cross-file):\n${params.routeGuard}\n`
    : "";
  return `CONTEXT:
File: ${params.filePath}
Language: ${params.language}
Function context:
\`\`\`${params.language}
${params.functionCode}
\`\`\`

Imports in file:
\`\`\`${params.language}
${params.imports}
\`\`\`
${guardBlock}
Pattern that triggered review: ${params.triggerPattern}
Triggered at line: ${params.lineNumber}

Analyze whether this is a real authorization bypass. Consider:

1. Does the suspicious pattern actually skip an authorization check?
2. Or is it intentional public access (e.g., serving public data)?
3. Is this in production runtime code, or in dev/seed/migration scripts?
4. Are there other authorization layers (middleware, library internals)
   that would catch this?
5. Does verification happen elsewhere in the code path?

When the finding is a specific route, set \`vulnerableRoute\` to that route's
HTTP method and path, copied verbatim from its decorator/definition (e.g.
"DELETE /users/{user_id}") — NOT a sibling route you cite only for contrast.

Call the report_auth_bypass_verdict tool with your verdict.`;
}

export class AuthBypassDetector implements Detector {
  readonly id = DETECTOR_ID;
  readonly displayName = "Authorization Bypass";
  readonly supports = ["auth_bypass_risk"] as const;
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
      // Real-file line translation; identity on synthetic diffs.
      findings.push(...remapFindingLines(fileFindings, file.lineMap));
    }

    return findings;
  }

  async fix(finding: NormalizedFinding): Promise<NormalizedFixSuggestion> {
    // Phase 3 scope: detector + test only. Fixes for auth-bypass require
    // human review; emit an advisory rather than a code patch.
    return {
      findingId: deriveFindingId(finding),
      detectorId: DETECTOR_ID,
      findingType: "auth_bypass_risk",
      file: finding.file,
      line: finding.startLine,
      originalCode: finding.originalCode,
      fixedCode: finding.originalCode,
      explanation:
        finding.explanation ||
        "Authorization bypass detected. Manual review required: ensure the code path does not grant access based on a hardcoded sentinel or user-controlled value.",
      confidence: finding.confidence,
      patchQuality: "low",
      patchWarnings: [
        "Auth-bypass fixes require human design decisions; no automated patch produced.",
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
    const triggers = this.prefilterRegex(content, filePath);
    const diag: FileDiagnostic = {
      file: filePath,
      triggerCount: triggers.length,
      flagged: false,
    };

    if (triggers.length === 0) {
      diag.preFilterReason = "no regex match";
      this.lastDiagnostics.push(diag);
      return [];
    }

    // For the missing-middleware case we MUST show the whole file: the
    // LLM's verdict depends on whether *sibling* routes in the same
    // router are guarded. Picking the first route-def trigger as the
    // primary anchor; full file content goes into functionCode, subject
    // to the shared WHOLE_FILE_PAYLOAD_CAP_BYTES bound (oversize files
    // fall back to the window — see Phase 1 P2 closure in
    // detectors/shared/route-def-pattern.ts).
    const routeDefTrigger = triggers.find(
      (t) =>
        t.patternId === "express_route_def" ||
        t.patternId === "app_router_route_def" ||
        t.patternId === "remix_handler_def" ||
        t.patternId === "fastapi_route_def" ||
        t.patternId === "flask_route_def",
    );
    const trigger = routeDefTrigger ?? triggers[0]!;
    const functionCode = buildFunctionCodePayload({
      content,
      anchorLine: trigger.line,
      isRouteDefTrigger: routeDefTrigger !== undefined,
    });

    // Cross-file parent-layout guard (Phase G): only relevant for
    // route-def triggers, where a missing in-file check may be a false
    // positive gated by an ancestor layout loader. The resolver
    // (cli/scan.ts, GitHub App, or fixture sidecar) supplies the guard.
    const routeGuard =
      routeDefTrigger !== undefined
        ? sidecars?.[SIDECAR_KINDS.ROUTE_GUARD]
        : undefined;

    const verdict = await this.callLlm({
      filePath,
      language: langDisplay(lang),
      functionCode,
      imports: extractImports(content),
      triggerPattern: trigger.patternText,
      lineNumber: trigger.line,
      routeGuard,
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
    // The confidence the FINDING carries. A HIGH verdict, and a MEDIUM that
    // escalation promoted, emit as "high". An unescalated MEDIUM now emits as
    // "medium" instead of being discarded — the emit-policy decision of
    // 2026-08-07. Severity is unchanged: it answers "how bad if real", while
    // confidence answers "is it real", and only the latter is in doubt here.
    let emitConfidence: "high" | "medium" = "high";

    if (verdict.confidence === "medium") {
      // H8: route the MEDIUM through the shared verdict-layer escalation.
      // Flag OFF (default) → resolveMediumVerdict returns "review-queue"
      // synchronously, with no client and no call. Either way the verdict
      // falls through to the H7 lane gate below — an emitted MEDIUM respects
      // lane discipline exactly as a promoted HIGH does.
      const escalation = await resolveMediumVerdict({
        detectorId: DETECTOR_ID,
        findingType: "auth_bypass_risk",
        filePath,
        candidateLine: trigger.line,
        originalReasoning: verdict.reasoning,
        wholeFileContent: content,
      });
      if (escalation === "drop") {
        // Escalation ADJUDICATED it clear. Reachable only with the flag ON; an
        // explicit clear still drops silently, like LOW. This is the one path
        // that still discards a MEDIUM, and it does so on a positive decision
        // rather than on absence of one.
        this.lastDiagnostics.push(diag);
        return [];
      }
      if (escalation !== "emit-high") {
        // "review-queue". With escalation OFF — the shipped configuration —
        // this is EVERY naturally arising MEDIUM. It used to return [] and
        // write a log line nothing consumed. It now emits, at the model's own
        // confidence, so the customer sees both the finding and the doubt.
        emitConfidence = "medium";
        logger.warn(
          {
            category: "auth-bypass-medium-emitted",
            file: filePath,
            line: trigger.line,
            pattern: trigger.patternText,
            reasoning: verdict.reasoning,
          },
          "auth-bypass: medium-confidence verdict emitted at MEDIUM confidence",
        );
      } else {
        logger.warn(
          {
            category: "auth-bypass-escalation-promoted",
            file: filePath,
            line: trigger.line,
            pattern: trigger.patternText,
            reasoning: verdict.reasoning,
          },
          "auth-bypass: medium-confidence verdict promoted to HIGH by escalation",
        );
      }
    }

    // Lane discipline (H7, 2026-06-13) — deterministic routing bound in
    // CODE, not prompt prose (per the deterministic-safety-bounds rule).
    // A ROUTE-DEF finding where authentication IS present and the operation
    // is administrative is a missing-ADMIN-GATE defect, which is
    // admin-check's lane — not an auth bypass. Defer it (admin-check, which
    // we never suppress, owns and reports it). Two bounds keep this safe:
    //  - Scoped to route-def triggers: sentinel / HOC bypasses (`|| true`,
    //    role||"admin", swallowed jwt.verify) are auth-bypass's OWN lane and
    //    must keep firing — they never reach this gate.
    //  - Fails OPEN: only authPresent==="yes" defers; "no"/"unclear" auth
    //    FIRES (a missed admin-gate finding is worse than a redundant one).
    // Preserves shape #3 (auth absent + admin → fires, honest double-report)
    // and all general missing-auth findings.
    const laneDeferral =
      routeDefTrigger !== undefined &&
      verdict.authPresent === "yes" &&
      verdict.operationKind === "admin"
        ? "auth present on an admin operation; missing admin gate is admin-check's lane"
        : null;
    if (laneDeferral) {
      logger.warn(
        {
          category: "auth-bypass-lane-deferral",
          file: filePath,
          line: trigger.line,
          pattern: trigger.patternText,
          authPresent: verdict.authPresent,
          operationKind: verdict.operationKind,
          laneDeferral,
          reasoning: verdict.reasoning,
        },
        "auth-bypass: HIGH verdict deferred to admin-check lane",
      );
      diag.laneDeferral = laneDeferral;
      this.lastDiagnostics.push(diag);
      return [];
    }

    // HIGH confidence — emit.
    diag.flagged = true;
    this.lastDiagnostics.push(diag);

    // Anchor at the route the verdict actually concerns (not the first route
    // in the file, which on a multi-route file is often a safe sibling).
    // Falls back to trigger.line on no LLM route / no signature match.
    const anchorLine = resolveRouteAnchorLine(
      content,
      verdict.vulnerableRoute,
      trigger.line,
    );
    const snippet = extractReportSnippet(content, anchorLine);
    return [
      {
        detectorId: DETECTOR_ID,
        type: "auth_bypass_risk",
        file: filePath,
        startLine: anchorLine,
        endLine: anchorLine,
        originalCode: snippet,
        ruleId: `auth-bypass-${trigger.patternId}`,
        message: verdict.reasoning,
        explanation: verdict.reasoning,
        confidence: emitConfidence,
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

  private prefilterRegex(content: string, filePath: string): PrefilterHit[] {
    const hits: PrefilterHit[] = [];
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const p of PREFILTER_PATTERNS) {
        if (p.re.test(line)) {
          // Phase E (2026-05-23): bound REMIX_HANDLER_DEF_RE over-match.
          // `export const loader` is also a Remix data-fetch utility
          // convention; without the path filter, utility modules under
          // `app/lib/` or `app/utils/` would route to the LLM as if
          // they were route handlers.
          if (
            p.id === "remix_handler_def" &&
            !isRemixRoutePath(filePath)
          ) {
            continue; // path-filtered; let other patterns test this line
          }
          // Python slice 1 (2026-05-28): lang-gate the route-def
          // prefilters so JS/TS and Python shapes never cross-fire.
          // The JS route-def patterns are meaningless on `.py`; the
          // FastAPI decorator pattern is meaningless off `.py`. Sentinel
          // / content patterns stay cross-language (no gate).
          if (
            (p.id === "fastapi_route_def" || p.id === "flask_route_def") &&
            !isPythonPath(filePath)
          ) {
            continue;
          }
          if (
            (p.id === "express_route_def" ||
              p.id === "app_router_route_def" ||
              p.id === "remix_handler_def") &&
            isPythonPath(filePath)
          ) {
            continue;
          }
          hits.push({
            patternId: p.id,
            patternText: line.trim(),
            line: i + 1,
          });
          break; // one hit per line is enough
        }
      }
    }
    return hits;
  }

  private async callLlm(params: {
    filePath: string;
    language: string;
    functionCode: string;
    imports: string;
    triggerPattern: string;
    lineNumber: number;
    routeGuard?: string | null;
  }): Promise<LlmVerdict | null> {
    const result = await callClaude({
      callerId: DETECTOR_ID,
      model: CLAUDE_MODELS.DETECTION,
      system: cachedSystem(SYSTEM_PROMPT),
      tool: REPORT_TOOL,
      temperature: 0,
      messages: [{ role: "user", content: buildUserMessage(params) }],
    });

    if (!result.ok) {
      logger.warn(
        { reason: result.reason, file: params.filePath },
        "auth-bypass: LLM call failed",
      );
      return null;
    }

    const input = result.toolInput as
      | {
          isVulnerable?: boolean;
          confidence?: string;
          reasoning?: string;
          suggestedFix?: string | null;
          vulnerableRoute?: string | null;
          authPresent?: unknown;
          operationKind?: unknown;
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
        "auth-bypass: malformed verdict",
      );
      return null;
    }
    const conf = input.confidence.toLowerCase();
    if (conf !== "high" && conf !== "medium" && conf !== "low") {
      return null;
    }
    // Lane facts — lenient parse with fail-OPEN defaults: an unrecognized or
    // missing value must NOT trigger the admin-check deferral. authPresent
    // defaults to "unclear" and operationKind to "general"; both make the
    // deferral gate fall through to firing (over-report > missed finding).
    const authPresent =
      input.authPresent === "yes" ||
      input.authPresent === "no" ||
      input.authPresent === "unclear"
        ? input.authPresent
        : "unclear";
    const operationKind =
      input.operationKind === "admin" ? "admin" : "general";
    return {
      isVulnerable: input.isVulnerable,
      confidence: conf as LlmVerdict["confidence"],
      reasoning: input.reasoning,
      suggestedFix: input.suggestedFix ?? null,
      vulnerableRoute:
        typeof input.vulnerableRoute === "string"
          ? input.vulnerableRoute
          : null,
      authPresent,
      operationKind,
    };
  }
}
