/**
 * Env-exposure detector.
 *
 * Mirrors Phase 5a (webhook-unverified) architecture: path/import + regex
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

const DETECTOR_ID = "env-exposure-multi";

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
  { id: "js_dot_json_env",        re: /\.json\s*\([^)]*process\.env/ },
  { id: "js_dot_send_env",        re: /\.send\s*\([^)]*process\.env/ },
  { id: "js_return_process_env",  re: /\breturn\s+process\.env\b/ },
  { id: "js_jsonify_process_env", re: /JSON\.stringify\s*\(\s*process\.env\b/ },
  { id: "js_logger_env",          re: /\b(?:log|logger|console)\.\w+\s*\([^)]*process\.env/ },
  { id: "js_iter_env",            re: /Object\.(?:keys|entries|values)\s*\(\s*process\.env\b/ },
  { id: "py_return_environ",      re: /\breturn\s+(?:dict\(\s*)?os\.environ\b/ },
  { id: "py_jsonify_environ",     re: /\bjsonify\s*\([^)]*os\.environ/ },
  { id: "py_return_dict_env",     re: /return\s+\{[^}]*os\.environ/ },
  { id: "py_dict_environ",        re: /\bdict\s*\(\s*os\.environ\s*\)/ },
  { id: "go_marshal_environ",     re: /(?:json\.Marshal|\.Encode)\s*\([^)]*os\.Environ/ },
  { id: "go_iter_environ",        re: /\bos\.Environ\s*\(\s*\)/ },
];

const SKIP_PATH_RE =
  /(^|\/)(test|tests|__tests__|spec|fixtures|examples?|scripts|dev-tools|migrations?|seed|seeds|demo)(\/|$)/i;

const SERVER_ONLY_RE = /^\s*import\s+["']server-only["']\s*;?\s*$/m;

const SYSTEM_PROMPT = `You are a security auditor analyzing a code change for environment-variable
exposure vulnerabilities. Env exposure means server environment variables
(secrets, database URLs, API keys, configuration) are returned in HTTP
responses or written to user-accessible logs, allowing attackers to read
the entire server configuration.

Set confidence:
- HIGH: Full process.env or os.environ dumped to a response or log accessible
  to non-admin callers
- MEDIUM: Subset returned but includes potentially sensitive keys
  (DATABASE_URL, AUTH, KEY, SECRET, TOKEN patterns)
- LOW: Hand-picked non-secret values (NODE_ENV, region, version), or full
  env behind strict admin+prod gating, or env routed through a redacting
  logger (not a response)

IMPORTANT:
- Only return findings with confidence "high" or "medium".
- Reject when the response includes ONLY explicitly allowlisted, non-secret
  values (NODE_ENV, APP_VERSION, REGION, SITE_URL).
- Reject when the route is gated by both admin auth AND a production check,
  and returns a curated subset.
- Reject when env is logged via a redacting logger (pino redact, winston
  format.combine with redaction).
- Reject when only env KEY NAMES are returned (no values), and the route
  is dev-only / 404 in production.
- Reject when regex redaction strips SECRET/KEY/TOKEN/PASSWORD before responding.`;

const REPORT_TOOL: Tool = {
  name: "report_env_exposure_verdict",
  description:
    "Report the env-exposure analysis verdict for the supplied code context.",
  input_schema: {
    type: "object",
    properties: {
      isVulnerable: {
        type: "boolean",
        description: "True if this is a real env-exposure vulnerability.",
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

Analyze whether this is a real env-exposure vulnerability. Consider:

1. Is the response body or log payload returning the full process.env /
   os.environ, or just a hand-picked subset?
2. Is the route gated by admin auth AND a production check before returning?
3. Are SECRET / KEY / TOKEN / PASSWORD values redacted before being emitted?
4. Are only env KEY NAMES returned (no values), with a dev-only / 404-in-prod
   guard?
5. Is process.env passed only to a redacting logger (pino redact list, etc.)
   rather than to an HTTP response?

Call the report_env_exposure_verdict tool with your verdict.`;
}

export class EnvExposureDetector implements Detector {
  readonly id = DETECTOR_ID;
  readonly displayName = "Environment Variable Exposure";
  readonly supports = ["env_exposure_risk"] as const;
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
      findingType: "env_exposure_risk",
      file: finding.file,
      line: finding.startLine,
      originalCode: finding.originalCode,
      fixedCode: finding.originalCode,
      explanation:
        finding.explanation ||
        "Environment exposure detected. Replace the env dump with an explicit allowlist of non-secret values, gate the route behind admin auth + a production check, or route the env through a redacting logger instead of the response.",
      confidence: finding.confidence,
      patchQuality: "low",
      patchWarnings: [
        "Picking which env values are safe to expose requires human review; no automated patch produced.",
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
          category: "env-exposure-review-queue",
          file: filePath,
          line: trigger.line,
          pattern: trigger.patternText,
          reasoning: verdict.reasoning,
        },
        "env-exposure: medium-confidence verdict suppressed",
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
        type: "env_exposure_risk",
        file: filePath,
        startLine: trigger.line,
        endLine: trigger.line,
        originalCode: snippet,
        ruleId: `env-exposure-${trigger.patternId}`,
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
    // Full-content scan (multi-line aware): some patterns like
    //   res.json({
    //     env: process.env,
    //   })
    // span lines and would be missed by per-line testing. Phase 5a fix.
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
        "env-exposure: LLM call failed",
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
        "env-exposure: malformed verdict",
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
