/**
 * Authorization-bypass detector.
 *
 * Two-stage filter:
 *  1. Path/import + regex pre-filter (cheap, runs in-process).
 *  2. Per-file LLM call via callClaude with a tool that enforces the
 *     verdict JSON shape.
 *
 * Only HIGH-confidence verdicts are emitted as findings. MEDIUM is
 * routed to logger.warn for offline review; LOW is dropped silently.
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
import {
  EXPRESS_ROUTE_DEF_RE,
  buildFunctionCodePayload,
} from "./shared/route-def-pattern";

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
}

interface FileDiagnostic {
  file: string;
  preFilterReason?: string;
  triggerCount: number;
  verdict?: LlmVerdict | null;
  flagged: boolean;
}

interface DiffFile {
  path: string;
  content: string;
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

Set confidence:
- HIGH: Clear evidence of bypass in destructive operation (DELETE/UPDATE/admin action).
  For missing-middleware: destructive route, sibling routes are guarded, no other
  auth signal in the handler body.
- MEDIUM: Pattern present but context partially ambiguous.
- LOW: Pattern present but context strongly suggests safety (e.g., every route on
  the router is unguarded by design, or the handler itself checks req.user).

IMPORTANT:
- Only return findings with confidence "high" or "medium".
- Reject patterns in test/, fixtures/, examples/, scripts/, dev-tools/ paths.
- Reject when imports show server-only or internal-only modules.
- Reject when the pattern appears in seed/migration scripts.
- For missing-middleware: a route is NOT vulnerable if requireAuth (or an
  equivalent auth middleware) appears as an argument to the route call, OR
  if the router itself was mounted under an auth-protected base path that
  is visible in the imports/context.`;

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
    },
    required: ["isVulnerable", "confidence", "reasoning"],
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

function parseDiff(diff: string): DiffFile[] {
  const out: DiffFile[] = [];
  const parts = diff.split(/^diff --git /m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const lines = part.split(/\r?\n/);
    let path: string | null = null;
    let inHunk = false;
    const content: string[] = [];
    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        path = line.slice("+++ b/".length).trim();
      } else if (line.startsWith("@@")) {
        inHunk = true;
      } else if (inHunk && line.startsWith("+") && !line.startsWith("+++")) {
        content.push(line.slice(1));
      }
    }
    if (path && content.length > 0) {
      out.push({ path, content: content.join("\n") });
    }
  }
  return out;
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
}): string {
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

Pattern that triggered review: ${params.triggerPattern}
Triggered at line: ${params.lineNumber}

Analyze whether this is a real authorization bypass. Consider:

1. Does the suspicious pattern actually skip an authorization check?
2. Or is it intentional public access (e.g., serving public data)?
3. Is this in production runtime code, or in dev/seed/migration scripts?
4. Are there other authorization layers (middleware, library internals)
   that would catch this?
5. Does verification happen elsewhere in the code path?

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

      const fileFindings = await this.analyzeFile(
        file.path,
        file.content,
        lang,
      );
      findings.push(...fileFindings);
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
  ): Promise<NormalizedFinding[]> {
    const triggers = this.prefilterRegex(content);
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
      (t) => t.patternId === "express_route_def",
    );
    const trigger = routeDefTrigger ?? triggers[0]!;
    const functionCode = buildFunctionCodePayload({
      content,
      anchorLine: trigger.line,
      isRouteDefTrigger: routeDefTrigger !== undefined,
    });

    const verdict = await this.callLlm({
      filePath,
      language: langDisplay(lang),
      functionCode,
      imports: extractImports(content),
      triggerPattern: trigger.patternText,
      lineNumber: trigger.line,
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
          category: "auth-bypass-review-queue",
          file: filePath,
          line: trigger.line,
          pattern: trigger.patternText,
          reasoning: verdict.reasoning,
        },
        "auth-bypass: medium-confidence verdict suppressed",
      );
      this.lastDiagnostics.push(diag);
      return [];
    }

    // HIGH confidence — emit.
    diag.flagged = true;
    this.lastDiagnostics.push(diag);

    const snippet = extractContextWindow(content, trigger.line);
    return [
      {
        detectorId: DETECTOR_ID,
        type: "auth_bypass_risk",
        file: filePath,
        startLine: trigger.line,
        endLine: trigger.line,
        originalCode: snippet,
        ruleId: `auth-bypass-${trigger.patternId}`,
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

  private prefilterRegex(content: string): PrefilterHit[] {
    const hits: PrefilterHit[] = [];
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const p of PREFILTER_PATTERNS) {
        if (p.re.test(line)) {
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
  }): Promise<LlmVerdict | null> {
    const result = await callClaude({
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
    return {
      isVulnerable: input.isVulnerable,
      confidence: conf as LlmVerdict["confidence"],
      reasoning: input.reasoning,
      suggestedFix: input.suggestedFix ?? null,
    };
  }
}
