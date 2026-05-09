/**
 * Webhook-unverified detector.
 *
 * Mirrors the auth-bypass / secrets-exposure architecture (Phases 3-4):
 * path/import + regex pre-filter, then per-file LLM call via callClaude
 * with a tool that enforces the verdict JSON shape. Only HIGH-confidence
 * verdicts are emitted; MEDIUM is logged via logger.warn for offline
 * review; LOW is dropped silently.
 *
 * Filter order (must match the other detectors):
 *   1. shouldSkipPath
 *   2. hasServerOnlyMarker
 *   3. prefilterRegex   (route discovery — see PREFILTER_PATTERNS)
 *   4. LLM call
 *
 * Note: webhook absence-of-verification cannot be detected by regex alone,
 * so the regex layer's role here is to identify candidate webhook handlers
 * and let the LLM judge whether verification is present (via library,
 * middleware, or timing-safe HMAC).
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

const DETECTOR_ID = "webhook-unverified-multi";

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
  { id: "express_post_webhook",         re: /\b(?:app|router)\.post\s*\([^)]*['"][^'"]*\/(?:webhook|hook|hooks)\b/i },
  { id: "express_use_webhook",          re: /\b(?:app|router)\.use\s*\([^)]*['"][^'"]*\/(?:webhook|hook|hooks)\b/i },
  { id: "flask_decorator_webhook",      re: /@\w+\.(?:route|post|get)\s*\(\s*['"][^'"]*\/(?:webhook|hooks?)\b/i },
  { id: "rails_post_webhook",           re: /^\s*post\s+['"][^'"]*\/(?:webhook|hooks?)\b/i },
  { id: "go_handler_webhook",           re: /(?:HandleFunc|Handle|Post|Get)\s*\(\s*"[^"]*\/(?:webhook|hooks?)\b/i },
  { id: "go_func_webhook",              re: /\bfunc\s+\w*[Ww]ebhook\w*\b/ },
  { id: "webhook_lib_import",           re: /(?:require\s*\(|from)\s*['"][^'"]*[Ww]ebhooks?['"]/ },
  { id: "webhook_factory",              re: /\bnew\s+Webhooks?\s*\(/ },
  { id: "webhook_verify_toggle",        re: /WEBHOOK_VERIFY\s*={2,3}\s*['"](?:off|false|disabled|0)/i },
  { id: "signature_loose_eq",           re: /\b(?:sig|signature|provided)\s*(?:!=|={2,3})\s*(?:expected|computed|hash|hmac|mac)\b/i },
  { id: "raw_signature_string_compare", re: /(?:sig|signature)\s*(?:!=|={2,3})\s*expected/i },
];

const SKIP_PATH_RE =
  /(^|\/)(test|tests|__tests__|spec|fixtures|examples?|scripts|dev-tools|migrations?|seed|seeds|demo)(\/|$)/i;

const SERVER_ONLY_RE = /^\s*import\s+["']server-only["']\s*;?\s*$/m;

const SYSTEM_PROMPT = `You are a security auditor analyzing a code change for webhook signature
verification vulnerabilities. A webhook handler that processes incoming
requests without verifying the sender's signature can be exploited by
attackers who forge events to trigger state changes.

Set confidence:
- HIGH: Webhook handler with no signature verification visible AND no
  library-based verification (e.g., stripe.webhooks.constructEvent,
  @octokit/webhooks, twilio.validateRequest) AND no dedicated verification
  middleware applied to the route
- MEDIUM: Signature verification present but uses insecure comparison
  (=== instead of timingSafeEqual/compare_digest)
- LOW: Verification clearly handled (library, middleware, or proper HMAC)

IMPORTANT:
- Only return findings with confidence "high" or "medium".
- Reject when the handler uses a known verification library
  (@octokit/webhooks, stripe.webhooks.constructEvent, twilio.validateRequest,
  github-webhook-handler, sveltekit-webhooks).
- Reject when verification middleware is applied to the route
  (e.g., app.use('/webhook', verifyStripeSignature, handler)).
- Reject when timing-safe comparison is used
  (crypto.timingSafeEqual, hmac.compare_digest, subtle.ConstantTimeCompare,
  hmac.Equal).
- Reject when the handler is behind authenticated middleware (requireAuth)
  AND the body is not used for state changes.`;

const REPORT_TOOL: Tool = {
  name: "report_webhook_unverified_verdict",
  description:
    "Report the webhook-unverified analysis verdict for the supplied code context.",
  input_schema: {
    type: "object",
    properties: {
      isVulnerable: {
        type: "boolean",
        description:
          "True if this is a real webhook-without-signature-verification vulnerability.",
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

Analyze whether this is a real webhook-without-signature-verification
vulnerability. Consider:

1. Is this a webhook endpoint that accepts external POSTs from a third
   party (Stripe, GitHub, Twilio, Lemon Squeezy, etc.)?
2. Does the handler call a known verification library
   (constructEvent, validateRequest, @octokit/webhooks)?
3. Is there a dedicated verification middleware applied before the
   handler runs?
4. Is the signature compared with a timing-safe primitive
   (timingSafeEqual / compare_digest / ConstantTimeCompare / hmac.Equal)?
5. If verification is present but uses === or !=, that is MEDIUM (timing leak).

Call the report_webhook_unverified_verdict tool with your verdict.`;
}

export class WebhookUnverifiedDetector implements Detector {
  readonly id = DETECTOR_ID;
  readonly displayName = "Webhook Without Signature Verification";
  readonly supports = ["webhook_unverified_risk"] as const;
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
      findingType: "webhook_unverified_risk",
      file: finding.file,
      line: finding.startLine,
      originalCode: finding.originalCode,
      fixedCode: finding.originalCode,
      explanation:
        finding.explanation ||
        "Webhook handler is missing signature verification. Add the provider's verification helper (e.g., stripe.webhooks.constructEvent, hmac.compare_digest) before processing the request body, and reject requests with invalid or missing signatures.",
      confidence: finding.confidence,
      patchQuality: "low",
      patchWarnings: [
        "Webhook signature wiring depends on the provider and secret storage; no automated patch produced.",
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
          category: "webhook-unverified-review-queue",
          file: filePath,
          line: trigger.line,
          pattern: trigger.patternText,
          reasoning: verdict.reasoning,
        },
        "webhook-unverified: medium-confidence verdict suppressed",
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
        type: "webhook_unverified_risk",
        file: filePath,
        startLine: trigger.line,
        endLine: trigger.line,
        originalCode: snippet,
        ruleId: `webhook-unverified-${trigger.patternId}`,
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
    // Test each pattern against the full content (not line-by-line) so
    // multi-line constructs like
    //   router.post(
    //     "/webhook/stripe",
    //     ...
    // match. Per-line testing missed these in Phase 5a's first run.
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
        "webhook-unverified: LLM call failed",
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
        "webhook-unverified: malformed verdict",
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
