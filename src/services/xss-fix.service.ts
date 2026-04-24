/**
 * XSS fix generator — LLM-based rewrite of a vulnerable snippet into
 * an output-encoded safe equivalent.
 *
 * Detection is handled upstream by the central LLM analyzer; this
 * service is invoked only when the XssDetector dispatches a finding
 * of type `xss_risk`.
 *
 * XSS fixes are highly context-dependent (HTML body vs attribute vs JS
 * vs URL), so regex-based rewrites are too brittle. We let Claude pick
 * the correct encoder and return it along with the detected context.
 */

import type {
  NormalizedFinding,
  NormalizedFixSuggestion,
} from "../analysis-engine/detector.types";
import { deriveFindingId } from "../analysis-engine/detector.types";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { cachedSystem, callClaude } from "../analysis-engine/anthropic-client";
import { CLAUDE_MODELS } from "../config/models";

const DETECTOR_ID = "xss-js-ts";

const XSS_FIX_SYSTEM_PROMPT = `You rewrite a single cross-site-scripting
(XSS) vulnerable snippet into an output-encoded safe equivalent.

Rules
- Identify the OUTPUT CONTEXT first: html body, html attribute, JS, or
  URL. The correct fix depends on it.
- HTML body: replace ".innerHTML = x" with ".textContent = x" when the
  original rendered text. Use DOMPurify.sanitize(x) only when HTML
  structure must be preserved.
- HTML attribute: use element.setAttribute("name", x) or the framework's
  attribute-binding API; never concatenate into an attribute literal.
- React dangerouslySetInnerHTML: replace with JSX rendering (React
  auto-escapes). If HTML is truly required, wrap with DOMPurify.sanitize.
- Express / raw HTML responses: replace string concatenation with a
  templating engine that auto-escapes (ejs <%= %>, Handlebars, etc.).
- document.write(...) with user data: replace with DOM APIs
  (createElement + textContent + appendChild).
- Preserve surrounding code style (semicolons, quotes, await) reasonably.
- Return only the rewritten code via the emit_xss_fix tool. No prose,
  no markdown fences, no commentary.`;

const EMIT_XSS_FIX_TOOL: Tool = {
  name: "emit_xss_fix",
  description:
    "Emit the rewritten safe code plus the detected output context and sink.",
  input_schema: {
    type: "object",
    properties: {
      fixed_code: {
        type: "string",
        description:
          "The rewritten safe code snippet (no markdown fences, no commentary).",
      },
      context: {
        type: "string",
        enum: ["html", "attribute", "js", "url"],
        description:
          "Output context the vulnerable value was rendered into.",
      },
      sink: {
        type: "string",
        description:
          "The vulnerable API or sink (e.g. 'innerHTML', 'dangerouslySetInnerHTML', 'document.write', 'res.send-interpolation').",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description:
          "'high' for textbook replacements; 'low' when the original flow is ambiguous.",
      },
    },
    required: ["fixed_code", "context", "sink", "confidence"],
  },
};

function buildUserPrompt(finding: NormalizedFinding): string {
  return [
    `Vulnerable snippet (as-is from the repo, ${finding.file}:${finding.startLine}):`,
    finding.originalCode,
    "",
    "Rewrite it safely and call emit_xss_fix with the result.",
  ].join("\n");
}

function fallbackSuggestion(
  finding: NormalizedFinding
): NormalizedFixSuggestion {
  return {
    findingId: deriveFindingId(finding),
    detectorId: DETECTOR_ID,
    findingType: "xss_risk",
    file: finding.file,
    line: finding.startLine,
    originalCode: finding.originalCode,
    fixedCode:
      "// Auto-rewrite unavailable. Apply output encoding for the context:\n" +
      "// - HTML body:        element.textContent = userInput;\n" +
      "// - HTML body (html): element.innerHTML = DOMPurify.sanitize(userInput);\n" +
      "// - Attribute:        element.setAttribute('name', userInput);\n" +
      "// - React:            render as JSX child ({userInput}) — never dangerouslySetInnerHTML.",
    explanation:
      "LLM rewrite unavailable. Apply context-appropriate output encoding; never interpolate user data into HTML, attributes, JS, or URLs without escaping.",
    confidence: "low",
    patchQuality: "low",
    patchWarnings: [
      "Automatic rewrite failed; apply the correct encoder for the output context manually.",
    ],
    metadata: {
      type: "xss_risk",
    },
  };
}

function coerceContext(
  raw: unknown
): "html" | "attribute" | "js" | "url" | undefined {
  if (raw === "html" || raw === "attribute" || raw === "js" || raw === "url") {
    return raw;
  }
  return undefined;
}

function coerceConfidence(raw: unknown): "high" | "medium" | "low" {
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "medium";
}

/**
 * Static check: does the rewrite still assign to innerHTML without a
 * sanitizer, or still call document.write, or still use
 * dangerouslySetInnerHTML unwrapped? If so, the fix is not safe.
 */
function residualXssRisk(fixedCode: string): string | null {
  if (
    /\.innerHTML\s*=\s*[^"'`]/.test(fixedCode) &&
    !/DOMPurify\.sanitize|\.textContent|createElement/.test(fixedCode)
  ) {
    return "Fixed code still assigns to innerHTML without sanitization";
  }
  if (/document\.write\s*\(/.test(fixedCode)) {
    return "Fixed code still calls document.write";
  }
  if (
    /dangerouslySetInnerHTML/.test(fixedCode) &&
    !/DOMPurify\.sanitize/.test(fixedCode)
  ) {
    return "Fixed code still uses dangerouslySetInnerHTML without sanitization";
  }
  return null;
}

/**
 * Produces a safe rewrite for one normalized XSS finding, or a
 * low-quality fallback when the LLM call fails.
 */
export async function generateXssFix(
  finding: NormalizedFinding
): Promise<NormalizedFixSuggestion> {
  const result = await callClaude({
    model: CLAUDE_MODELS.REASONING,
    system: cachedSystem(XSS_FIX_SYSTEM_PROMPT),
    tool: EMIT_XSS_FIX_TOOL,
    messages: [{ role: "user", content: buildUserPrompt(finding) }],
  });

  if (!result.ok) return fallbackSuggestion(finding);

  const input = result.toolInput as
    | {
        fixed_code?: unknown;
        context?: unknown;
        sink?: unknown;
        confidence?: unknown;
      }
    | undefined;

  const fixedCode =
    typeof input?.fixed_code === "string" ? input.fixed_code.trim() : "";
  if (!fixedCode) return fallbackSuggestion(finding);

  const context = coerceContext(input?.context);
  const sink =
    typeof input?.sink === "string" && input.sink.trim().length > 0
      ? input.sink.trim()
      : undefined;
  const confidence = coerceConfidence(input?.confidence);

  const warnings: string[] = [];
  let patchQuality: "high" | "medium" | "low" =
    confidence === "high" ? "high" : confidence === "medium" ? "medium" : "low";

  const residual = residualXssRisk(fixedCode);
  if (residual) {
    warnings.push(`Static check: ${residual}`);
    patchQuality = "low";
  }

  warnings.push(
    "LLM-generated XSS rewrite; verify the output encoder matches your rendering pipeline and that the surrounding code still compiles."
  );

  return {
    findingId: deriveFindingId(finding),
    detectorId: DETECTOR_ID,
    findingType: "xss_risk",
    file: finding.file,
    line: finding.startLine,
    originalCode: finding.originalCode,
    fixedCode,
    explanation:
      "Replaced the unsafe sink with a context-appropriate output encoder. Review the encoder choice against your rendering pipeline.",
    confidence,
    patchQuality,
    patchWarnings: warnings,
    metadata: {
      type: "xss_risk",
      ...(context ? { context } : {}),
      ...(sink ? { sink } : {}),
    },
  };
}
