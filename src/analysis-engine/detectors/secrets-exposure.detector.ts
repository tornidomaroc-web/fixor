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
  redactionSkipCount?: number;
  verdict?: LlmVerdict | null;
  flagged: boolean;
}
interface PrefilterPattern {
  id: string;
  re: RegExp;
  /**
   * Hand-authored finding explanation used on the default regex-only path,
   * where LLM validation is disabled and the Option G bypass emits directly
   * (opt in to the LLM path with FIXOR_SECRETS_LLM_OPT_IN=true). Format:
   * identify the secret class + attack surface + remediation steps. Used as
   * both `message` and `explanation` on the emitted NormalizedFinding.
   *
   * See docs/detector-test-rules.md "Reasoning quality for literal-pattern
   * detectors" for the design rationale (Option 4 from the Day 6+ pilot
   * design doc).
   */
  explanation: string;
}

const PREFILTER_PATTERNS: PrefilterPattern[] = [
  {
    id: "supabase_service_role",
    re: /\bSUPABASE_SERVICE_ROLE/,
    explanation:
      "Supabase service-role key reference. The service-role key bypasses Row-Level Security and grants full database access; if this file ships to a client bundle or runs in a context reachable by untrusted code, the key is exposed. Move usage to a server-only file (add `import 'server-only';` and verify the route isn't invokable from the client) and rotate the key if there is any chance it has already shipped.",
  },
  {
    id: "next_public_service_role",
    re: /\bNEXT_PUBLIC_\w*SERVICE_ROLE/i,
    explanation:
      "Service-role-shaped variable name with the NEXT_PUBLIC_ prefix. Next.js inlines NEXT_PUBLIC_* into client bundles, so the service-role secret will be visible in browser-deliverable JavaScript. Rename the env var to drop NEXT_PUBLIC_, consume it only in server-side code, and rotate the key in Supabase since it has likely shipped.",
  },
  {
    id: "next_public_suspicious",
    re: /\bNEXT_PUBLIC_(\w*SECRET|\w*PRIVATE|OPENAI|ANTHROPIC)/i,
    explanation:
      "Sensitive credential variable (OpenAI/Anthropic key, or *_SECRET / *_PRIVATE) exposed via NEXT_PUBLIC_ prefix. Next.js inlines NEXT_PUBLIC_* into client bundles, exposing the secret to anyone who downloads your site. Move to a server-only env var (drop the NEXT_PUBLIC_ prefix) and consume from a server route or React Server Component. Rotate the key — assume it has shipped.",
  },
  {
    id: "firebase_admin_import",
    re: /from\s+["']firebase-admin/,
    explanation:
      "firebase-admin SDK import. The Admin SDK uses a service-account credential that grants full project access; it must never run in client code. Verify this file is server-only (Next.js `'server-only'` import, server-side framework path, or build-time tree-shaking proof), confirm no client component imports from here, and rotate the service-account credential if the file has shipped client-side.",
  },
  {
    id: "stripe_live_secret",
    re: /\bsk_live_[A-Za-z0-9]{16,}/,
    explanation:
      "Stripe live secret key (sk_live_*) hardcoded in source. This key authorizes charges against the live Stripe account. Rotate the key in the Stripe dashboard immediately, move the new key to an env var (STRIPE_SECRET_KEY), and audit recent Stripe activity for unauthorized charges.",
  },
  {
    id: "anthropic_key",
    re: /\bsk-ant-api03-[A-Za-z0-9_-]{20,}/,
    explanation:
      "Anthropic API key hardcoded in source. This key authorizes API calls billed to your account. Rotate the key in the Anthropic console, move to an env var, and check recent usage in the Anthropic dashboard for anomalies.",
  },
  {
    id: "google_api_key",
    re: /\bAIza[A-Za-z0-9_-]{30,}/,
    explanation:
      "Google API key (AIza...) hardcoded in source. Depending on the key's scope, this may authorize Maps, Firebase, Cloud, or other Google services billed to your account. Rotate in the Google Cloud Console, move to an env var, and apply API key restrictions (HTTP referrer or IP) on the replacement.",
  },
  {
    id: "stripe_live_publishable",
    re: /\bpk_live_[A-Za-z0-9]{16,}/,
    explanation:
      "Stripe live publishable key (pk_live_*) hardcoded in source. The publishable key is not in itself sensitive (it's client-side by design), but its presence in code often signals the matching secret key is nearby. Audit this file for an sk_live_* key, move both to env vars, and ensure the publishable key is loaded via env to support test/live environment switching.",
  },
  {
    id: "aws_access_key",
    re: /\bAKIA[A-Z0-9]{16}\b/,
    explanation:
      "AWS access key ID (AKIA*) hardcoded in source. The AKIA prefix is a long-lived IAM user access key. If the matching secret access key is also in this file or recoverable elsewhere, this is a full-AWS-account credential leak. Rotate the IAM access key pair immediately, prefer IAM roles over long-lived keys for the new credential, and audit CloudTrail for unauthorized API calls.",
  },
  {
    id: "aws_secret_literal",
    re: /\bAWS_SECRET_ACCESS_KEY\s*=\s*['"]/,
    explanation:
      "AWS_SECRET_ACCESS_KEY assigned to a hardcoded string. Pairs with an AKIA-prefixed access key ID to grant full IAM-user permissions. Rotate the IAM access key pair in the AWS console, switch to IAM roles for the host runtime where possible, move any remaining static key to env vars, and audit CloudTrail.",
  },
  {
    id: "jwt_secret_literal",
    re: /\b(JWT_SECRET|JWT_SIGNING_KEY|jwtSigningKey|jwt_signing_key)\s*=\s*['"]/,
    explanation:
      "JWT signing secret hardcoded in source. Anyone with this secret can forge valid tokens for any user, enabling identity impersonation. Rotate the secret immediately (this invalidates all outstanding tokens), move to an env var, and force re-authentication on all active sessions.",
  },
  {
    id: "private_key_literal",
    re: /\bprivate[_-]?key\s*[:=]\s*['"]/i,
    explanation:
      "Private key value assigned as a hardcoded string. Possible key types: SSH key (rotate via the destination service's key management), JWT signing key for RS256/ES256 (rotate at the auth provider, force re-auth), TLS private key (rotate via your CA or certificate manager), service-account credential (rotate at the upstream provider). Identify the key type from the surrounding imports and usage. Move to a secret store (cloud KMS, vault) and ensure key material is never committed to version control.",
  },
  {
    id: "password_literal",
    re: /\b(password|passwd|pwd)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
    explanation:
      "Password assigned to a hardcoded string of length 8+. Possible types: database password (rotate at the DB, update env var, restart services), service-account credential (rotate at the upstream service), admin login (rotate the admin account password), or test fixture credential (move to a test-only config gated by NODE_ENV, or relocate the file to a `tests/` path). Identify the type from surrounding context. Production credentials require rotation + env var + audit; test credentials require relocation to avoid mass-flagging.",
  },
  {
    id: "postgres_url_password",
    re: /postgres(?:ql)?:\/\/[^:\/\s]+:[^@\s'"]+@/,
    explanation:
      "Postgres connection URL with embedded password (`postgres://user:password@host/db`). The password is exposed to anyone with repository access. Rotate the database password, move the URL to an env var (DATABASE_URL), and ensure the new URL is set in deployment config before the next deploy.",
  },
  {
    id: "slack_webhook_hardcoded",
    re: /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\//,
    explanation:
      "Slack incoming-webhook URL hardcoded in source. Anyone with this URL can post arbitrary messages to the destination channel without further authentication. Rotate the webhook (delete it in Slack and create a new one), move the new URL to an env var, and audit the channel history for unauthorized posts.",
  },
];

const SKIP_PATH_RE =
  /(^|\/)(test|tests|__tests__|spec|fixtures|examples?|scripts|dev-tools|migrations?|seed|seeds|demo)(\/|$)/i;

const SERVER_ONLY_RE = /^\s*import\s+["']server-only["']\s*;?\s*$/m;

/**
 * Day 13 redaction-shape exemption. When a pre-filter pattern matches and the
 * value on the right-hand side is itself a redaction artifact, the line is the
 * REDACTOR, not the leak. Emitting a finding there flags anti-leak code as
 * the leak. First instance: Twenty `url.password = '********'` in
 * config-variable-mask-sensitive-data.util.ts (Step 4 §7 worst-FP class).
 *
 * Scope is deliberately tight: ambiguous shapes (`''` empty, `'xxx'`,
 * `'changeme'`, template placeholders `'<your-password>'`) err toward emit
 * because they may be defaults a customer should change, not redactions.
 */
const REDACTION_VALUE_PATTERNS: RegExp[] = [
  /[:=]\s*['"`]\*{2,}['"`]/,
  /[:=]\s*['"`]\*['"`]\s*\+/,
  /[:=]\s*['"`]\[(?:REDACTED|FILTERED|HIDDEN|MASKED|PROTECTED|SCRUBBED)\]['"`]/i,
  /[:=]\s*['"`]<(?:hidden|redacted|filtered|masked|scrubbed)>['"`]/i,
  /[:=]\s*['"`]redacted['"`]/i,
  /[:=]\s*(?:mask|redact|sanitize|obfuscate|scrub|hide)\w*\s*\(/i,
];

function isRedactionShape(line: string): boolean {
  for (const re of REDACTION_VALUE_PATTERNS) {
    if (re.test(line)) return true;
  }
  return false;
}

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

export const SYSTEM_PROMPT_FINGERPRINT = createHash("sha256")
  .update(SYSTEM_PROMPT)
  .digest("hex")
  .slice(0, 12);

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

  /**
   * When false (default), regex pre-filter matches emit findings directly
   * using the pattern's hand-authored explanation (no LLM call). When true,
   * the LLM is invoked to confirm and produce reasoning text.
   *
   * **Default flipped to false on Day 7** (2026-05-15): the LLM-validation
   * path quoted secret values verbatim into PR comment output (see D8 in
   * docs/detector-test-rules.md). Hand-authored explanations are
   * structurally safer because they cannot re-expose what the finding is
   * flagging. The Day 7 pilot validated regex-only mode produces identical
   * fixture verdicts to LLM mode (100% RUBBER-STAMP on this detector), so
   * the default flip is verdict-preserving and leak-eliminating.
   *
   * LLM mode is preserved as an opt-in for any future deployment where
   * specific reasoning-text shape matters. To opt in, set
   * `FIXOR_SECRETS_LLM_OPT_IN=true` or pass `{ llmValidation: true }`
   * to the constructor.
   *
   * Resolution order: env var wins over constructor (deployment override);
   * env unset OR constructor default → false (regex-only).
   */
  private readonly llmValidation: boolean;

  /** For test diagnostics; reset at the start of each `detect()` call. */
  public lastDiagnostics: FileDiagnostic[] = [];

  constructor(options: { llmValidation?: boolean } = {}) {
    const envValue = process.env.FIXOR_SECRETS_LLM_OPT_IN;
    if (envValue !== undefined) {
      this.llmValidation = envValue === "true";
    } else {
      this.llmValidation = options.llmValidation ?? false;
    }
  }

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
      // Real-file line translation; identity on synthetic diffs.
      findings.push(...remapFindingLines(fileFindings, file.lineMap));
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

    const liveTriggers = triggers.filter((t) => !isRedactionShape(t.patternText));
    if (liveTriggers.length < triggers.length) {
      diag.redactionSkipCount = triggers.length - liveTriggers.length;
    }
    if (liveTriggers.length === 0) {
      diag.preFilterReason = "redaction-shape exemption";
      this.lastDiagnostics.push(diag);
      return [];
    }

    const trigger = liveTriggers[0]!;

    // Option G pilot bypass: when LLM validation is disabled, emit finding
    // directly from the matched pattern's hand-authored explanation. See
    // docs/detector-test-rules.md D7 (pilot scope discipline) and the
    // "Reasoning quality for literal-pattern detectors" note. Bypass
    // assumes every PREFILTER_PATTERN is literal-tier (regex match IS
    // sufficient evidence); when adding non-literal patterns in future,
    // gate bypass per-pattern (Option B/C from the pilot design doc).
    if (!this.llmValidation) {
      const pattern = PREFILTER_PATTERNS.find(
        (p) => p.id === trigger.patternId,
      );
      if (!pattern) {
        diag.preFilterReason = `bypass: unknown patternId ${trigger.patternId}`;
        this.lastDiagnostics.push(diag);
        return [];
      }
      diag.verdict = {
        isVulnerable: true,
        confidence: "high",
        reasoning: pattern.explanation,
      };
      diag.flagged = true;
      // Mark as pre-filter outcome so the shared harness's LLM-call
      // counter doesn't overstate cost. No `callClaude` invocation
      // happened on this path; the finding came entirely from the regex
      // match + hand-authored explanation.
      diag.preFilterReason = "llm-bypass";
      this.lastDiagnostics.push(diag);

      const bypassSnippet = extractContextWindow(content, trigger.line);
      return [
        {
          detectorId: DETECTOR_ID,
          type: "secrets_exposure_risk",
          file: filePath,
          startLine: trigger.line,
          endLine: trigger.line,
          originalCode: bypassSnippet,
          ruleId: `secrets-exposure-${trigger.patternId}`,
          message: pattern.explanation,
          explanation: pattern.explanation,
          confidence: "high",
          severity: "critical",
        },
      ];
    }

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
      // H8: route the MEDIUM through the shared verdict-layer escalation.
      // Flag OFF (default) → resolveMediumVerdict returns "review-queue"
      // synchronously (no call), so this branch behaves exactly as before.
      const escalation = await resolveMediumVerdict({
        detectorId: DETECTOR_ID,
        findingType: "secrets_exposure_risk",
        filePath,
        candidateLine: trigger.line,
        originalReasoning: verdict.reasoning,
        wholeFileContent: content,
      });
      if (escalation !== "emit-high") {
        if (escalation === "review-queue") {
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
        }
        // "drop": escalation cleared it — silent, like LOW.
        this.lastDiagnostics.push(diag);
        return [];
      }
      // "emit-high": escalation promoted the MEDIUM — fall through to the
      // HIGH-emit path below.
      logger.warn(
        {
          category: "secrets-exposure-escalation-promoted",
          file: filePath,
          line: trigger.line,
          pattern: trigger.patternText,
          reasoning: verdict.reasoning,
        },
        "secrets-exposure: medium-confidence verdict promoted to HIGH by escalation",
      );
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
