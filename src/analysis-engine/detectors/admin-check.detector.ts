/**
 * Admin-check detector.
 *
 * Mirrors Phase 5b (env-exposure) architecture: path/import + regex
 * pre-filter (full-content scan), then per-file LLM call via callClaude
 * with a tool that enforces the verdict JSON shape. Only HIGH-confidence
 * verdicts are emitted; MEDIUM is logged via logger.warn for offline
 * review; LOW is dropped silently.
 *
 * Filter order:
 *   1. shouldSkipPath
 *   2. hasServerOnlyMarker
 *   3. prefilterRegex   (full-content scan; multi-line aware)
 *   4. LLM call
 *
 * Note: the role_string_compare pattern (P9) is intentionally broad — it
 * matches both vulnerable (string-only) and safe (DB-then-string-check)
 * cases. The LLM's job, per the prompt's reject rules, is to distinguish
 * "role from DB / JWT / RBAC middleware" (safe) from "role from hardcoded
 * string only" (vulnerable).
 */

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

const DETECTOR_ID = "admin-check-multi";

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
  { id: "email_eq_literal",        re: /\bemail\s*===?\s*['"][^'"@]+@/i },
  { id: "email_endswith_at",       re: /\bemail\.endsWith\s*\(\s*['"]\s*@/i },
  { id: "py_email_endswith_at",    re: /\bemail\.endswith\s*\(\s*['"]\s*@/i },
  { id: "email_includes_admin",    re: /\bemail\.includes\s*\(\s*['"](?:admin|owner|founder|root|superuser)/i },
  { id: "strings_hassuffix_email", re: /strings\.HasSuffix\s*\(\s*\w*email\w*\s*,\s*['"]@/i },
  { id: "default_admin_id",        re: /\bDEFAULT_ADMIN_ID\b/ },
  { id: "default_admin_email",     re: /\bDEFAULT_ADMIN_EMAIL\b/ },
  { id: "admin_emails_array",      re: /\b(?:ADMIN_EMAILS|admin_emails)\s*=\s*\[/ },
  { id: "role_string_compare",     re: /\b(?:userRole|user\.role|role|claims\.role)\s*(?:===?|!==?)\s*['"](?:admin|owner|superadmin|root)['"]/i },
  { id: "role_fallback_admin",     re: /\brole\s*\?\?\s*['"](?:admin|owner)['"]/i },
  { id: "body_role_check",         re: /req\.(?:body|query|params)\.\w*[Rr]ole\b/ },
  { id: "admin_email_const",       re: /\b(?:ADMIN_EMAIL|admin_email)\s*=\s*['"][^'"]*@/i },
];

const SKIP_PATH_RE =
  /(^|\/)(test|tests|__tests__|spec|fixtures|examples?|scripts|dev-tools|migrations?|seed|seeds|demo)(\/|$)/i;

const SERVER_ONLY_RE = /^\s*import\s+["']server-only["']\s*;?\s*$/m;

const SYSTEM_PROMPT = `You are a security auditor analyzing a code change for admin-check
vulnerabilities. Admin-check vulnerability means administrator privileges
are granted via hardcoded email comparison, domain suffix matching, or
string-based role check instead of proper RBAC backed by a database
table or server-signed JWT claims.

Set confidence:
- HIGH: Admin grant based on hardcoded email/domain/role string with no
  database or signed-claim verification, in production runtime code
- MEDIUM: Hybrid check (e.g., string match AS PRIMARY but DB verification
  later) or partial RBAC with hardcoded fallback
- LOW: RBAC clearly backed by DB lookup, server-signed JWT with issuer
  validation, or RBAC middleware that consults user_roles/org_members tables

IMPORTANT:
- Only return findings with confidence "high" or "medium".
- Reject when role is read from a database table (user_roles, org_members,
  permissions) before granting access.
- Reject when role comes from a server-signed JWT with issuer verification.
- Reject when email match is used only to verify an invite token (grants
  member, not admin).
- Reject when hardcoded admins appear only in bootstrap/seed scripts (not
  runtime code).
- Reject when a dedicated RBAC middleware (verifyClaims, requireRole)
  enforces the check before the route handler.`;

const REPORT_TOOL: Tool = {
  name: "report_admin_check_verdict",
  description:
    "Report the admin-check analysis verdict for the supplied code context.",
  input_schema: {
    type: "object",
    properties: {
      isVulnerable: {
        type: "boolean",
        description: "True if this is a real admin-check vulnerability.",
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

function countLinesBefore(content: string, idx: number): number {
  let count = 0;
  const stop = Math.min(idx, content.length);
  for (let i = 0; i < stop; i++) {
    if (content[i] === "\n") count++;
  }
  return count;
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

Analyze whether this is a real admin-check vulnerability. Consider:

1. Is admin granted purely by hardcoded email comparison, domain suffix
   matching, or string-based role check?
2. Is the role read from a database table (user_roles, org_members,
   permissions) before the check?
3. Does the role come from a server-signed JWT with issuer verification?
4. Is the email match used only to verify an invite token (grants member,
   not admin)?
5. Is a dedicated RBAC middleware (verifyClaims, requireRole) applied
   before the route handler?

Call the report_admin_check_verdict tool with your verdict.`;
}

export class AdminCheckDetector implements Detector {
  readonly id = DETECTOR_ID;
  readonly displayName = "Hardcoded Admin Check";
  readonly supports = ["admin_check_risk"] as const;
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
    return {
      findingId: deriveFindingId(finding),
      detectorId: DETECTOR_ID,
      findingType: "admin_check_risk",
      file: finding.file,
      line: finding.startLine,
      originalCode: finding.originalCode,
      fixedCode: finding.originalCode,
      explanation:
        finding.explanation ||
        "Hardcoded admin check detected. Replace the email/role string comparison with a database-backed RBAC lookup (user_roles or org_members table), or use a server-signed JWT claim with issuer verification.",
      confidence: finding.confidence,
      patchQuality: "low",
      patchWarnings: [
        "RBAC migration requires schema and policy decisions; no automated patch produced.",
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

    const trigger = triggers[0]!;
    const verdict = await this.callLlm({
      filePath,
      language: langDisplay(lang),
      functionCode: extractContextWindow(content, trigger.line),
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
          category: "admin-check-review-queue",
          file: filePath,
          line: trigger.line,
          pattern: trigger.patternText,
          reasoning: verdict.reasoning,
        },
        "admin-check: medium-confidence verdict suppressed",
      );
      this.lastDiagnostics.push(diag);
      return [];
    }

    diag.flagged = true;
    this.lastDiagnostics.push(diag);

    const snippet = extractContextWindow(content, trigger.line);
    return [
      {
        detectorId: DETECTOR_ID,
        type: "admin_check_risk",
        file: filePath,
        startLine: trigger.line,
        endLine: trigger.line,
        originalCode: snippet,
        ruleId: `admin-check-${trigger.patternId}`,
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
    // Full-content scan (multi-line aware) — Phase 5a fix.
    let earliest: { idx: number; patternId: string } | null = null;
    for (const p of PREFILTER_PATTERNS) {
      const m = p.re.exec(content);
      if (!m || m.index === undefined) continue;
      if (earliest === null || m.index < earliest.idx) {
        earliest = { idx: m.index, patternId: p.id };
      }
    }
    if (!earliest) return [];

    const lineNumber = countLinesBefore(content, earliest.idx) + 1;
    const lines = content.split(/\r?\n/);
    const lineText = lines[lineNumber - 1] ?? "";
    return [
      {
        patternId: earliest.patternId,
        patternText: lineText.trim(),
        line: lineNumber,
      },
    ];
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
        "admin-check: LLM call failed",
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
        "admin-check: malformed verdict",
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
