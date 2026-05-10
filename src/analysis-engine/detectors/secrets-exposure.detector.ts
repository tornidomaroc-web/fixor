/**
 * Secrets-exposure detector.
 *
 * Mirrors the auth-bypass detector architecture (Phase 3): path/import +
 * regex pre-filter, then per-file LLM call via callClaude with a tool
 * that enforces the verdict JSON shape. Only HIGH-confidence verdicts
 * are emitted as findings; MEDIUM is logged via logger.warn for offline
 * review; LOW is dropped silently.
 *
 * Filter order (must match auth-bypass):
 *   1. shouldSkipPath  (drops fixtures/, tests/, scripts/, migrations/, ...)
 *   2. hasServerOnlyMarker  (skips files importing "server-only")
 *   3. prefilterRegex  (15 patterns for service-role, client-bundled keys, etc.)
 *   4. LLM call
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

const DETECTOR_ID = "secrets-exposure-multi";

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
  { id: "supabase_service_role",    re: /\bSUPABASE_SERVICE_ROLE/ },
  { id: "next_public_service_role", re: /\bNEXT_PUBLIC_\w*SERVICE_ROLE/i },
  { id: "next_public_suspicious",   re: /\bNEXT_PUBLIC_(\w*SECRET|\w*PRIVATE|OPENAI|ANTHROPIC)/i },
  { id: "firebase_admin_import",    re: /from\s+["']firebase-admin/ },
  { id: "stripe_live_secret",       re: /\bsk_live_[A-Za-z0-9]{16,}/ },
  { id: "anthropic_key",            re: /\bsk-ant-api03-[A-Za-z0-9_-]{20,}/ },
  { id: "google_api_key",           re: /\bAIza[A-Za-z0-9_-]{30,}/ },
  { id: "stripe_live_publishable",  re: /\bpk_live_[A-Za-z0-9]{16,}/ },
  { id: "aws_access_key",           re: /\bAKIA[A-Z0-9]{16}\b/ },
  { id: "aws_secret_literal",       re: /\bAWS_SECRET_ACCESS_KEY\s*=\s*['"]/ },
  { id: "jwt_secret_literal",       re: /\b(JWT_SECRET|JWT_SIGNING_KEY|jwtSigningKey|jwt_signing_key)\s*=\s*['"]/ },
  { id: "private_key_literal",      re: /\bprivate[_-]?key\s*[:=]\s*['"]/i },
  { id: "password_literal",         re: /\b(password|passwd|pwd)\s*[:=]\s*['"][^'"\s]{8,}['"]/i },
  { id: "postgres_url_password",    re: /postgres(?:ql)?:\/\/[^:\/\s]+:[^@\s'"]+@/ },
  { id: "slack_webhook_hardcoded",  re: /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/ },
];

const SKIP_PATH_RE =
  /(^|\/)(test|tests|__tests__|spec|fixtures|examples?|scripts|dev-tools|migrations?|seed|seeds|demo)(\/|$)/i;

const SERVER_ONLY_RE = /^\s*import\s+["']server-only["']\s*;?\s*$/m;

const SYSTEM_PROMPT = `You are a security auditor analyzing a code change for secrets-exposure
vulnerabilities. Secrets exposure means privileged credentials (service
role keys, admin tokens, private API keys, signing secrets) are embedded
in code that ships to clients/browsers, OR are accessible via code paths
reachable by users.

Set confidence:
- HIGH: Clear evidence of a privileged secret in client-bundled code OR
  hardcoded literal credential in any code path
- MEDIUM: Pattern present but context partially ambiguous
- LOW: Pattern present but context strongly suggests safety (env-loaded,
  server-only, encrypted at rest, public-by-design value)

IMPORTANT:
- Only return findings with confidence "high" or "medium".
- Reject patterns when imports show "server-only" directive.
- Reject NEXT_PUBLIC_ values that are legitimately public (anon keys,
  site URLs, project IDs without privileges).
- Reject pk_test_ and sk_test_ keys (Stripe test mode is safe).
- Reject env-loaded secrets that fail-fast if missing.
- Reject secrets accessed only inside getServerSideProps, getStaticProps,
  server actions, or backend API routes.`;

const REPORT_TOOL: Tool = {
  name: "report_secrets_exposure_verdict",
  description:
    "Report the secrets-exposure analysis verdict for the supplied code context.",
  input_schema: {
    type: "object",
    properties: {
      isVulnerable: {
        type: "boolean",
        description: "True if this is a real secrets-exposure vulnerability.",
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

Analyze whether this is a real secrets-exposure vulnerability. Consider:

1. Is the secret embedded as a literal string in source, or loaded from env?
2. Does the file ship to the client (component, NEXT_PUBLIC_, "use client")?
3. Is the secret guarded by "server-only", getServerSideProps, or a backend route?
4. Is the value legitimately public (anon key, site URL, test-mode key)?
5. Is the secret encrypted at rest and decrypted only at boot?

Call the report_secrets_exposure_verdict tool with your verdict.`;
}

export class SecretsExposureDetector implements Detector {
  readonly id = DETECTOR_ID;
  readonly displayName = "Secrets Exposure";
  readonly supports = ["secrets_exposure_risk"] as const;
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
      findingType: "secrets_exposure_risk",
      file: finding.file,
      line: finding.startLine,
      originalCode: finding.originalCode,
      fixedCode: finding.originalCode,
      explanation:
        finding.explanation ||
        "Secrets exposure detected. Move the credential to a server-only environment variable, rotate the leaked secret, and ensure it is not bundled into client code.",
      confidence: finding.confidence,
      patchQuality: "low",
      patchWarnings: [
        "Secret rotation and environment configuration require human action; no automated patch produced.",
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
          category: "secrets-exposure-review-queue",
          file: filePath,
          line: trigger.line,
          pattern: trigger.patternText,
          reasoning: verdict.reasoning,
        },
        "secrets-exposure: medium-confidence verdict suppressed",
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
        type: "secrets_exposure_risk",
        file: filePath,
        startLine: trigger.line,
        endLine: trigger.line,
        originalCode: snippet,
        ruleId: `secrets-exposure-${trigger.patternId}`,
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
          break;
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
        "secrets-exposure: LLM call failed",
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
        "secrets-exposure: malformed verdict",
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
