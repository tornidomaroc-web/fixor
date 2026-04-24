/**
 * Detection engine: runs Claude against a raw PR diff and returns typed
 * findings.
 *
 * Uses tool_use to force structured output (no JSON-parsing of free-form
 * text) and prompt caching on the system prompt for ~90% read-time savings
 * on warm calls.
 */

import type { AnalysisResult, Finding, FindingType } from "./types";
import { CLAUDE_MODELS } from "../config/models";
import { cachedSystem, callClaude } from "./anthropic-client";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

const SYSTEM_PROMPT = `You are a defensive security analyzer embedded in a code review pipeline.

Goals
1. Detect real vulnerabilities in a unified diff: SQL injection (primary),
   XSS, command injection, and path traversal.
2. Be conservative. Prefer no finding over a speculative one. Only flag
   clear data-flow from a user-controlled source into a dangerous sink.
3. Each finding MUST include the exact vulnerable snippet (as-is from the
   diff) and a safe parameterized replacement.

Output
Call the record_findings tool exactly once. Never emit plain text. If you
find no real vulnerabilities, call the tool with an empty findings array.

Rules
- original_snippet MUST contain the exact vulnerable line(s) from the diff.
- example_fix MUST contain a corrected version using parameterized queries
  (for SQL), safe escaping (for XSS), or hardened API calls.
- Never include exploit payloads or attack instructions in any field.
- Confidence ladder: "high" only for textbook cases with visible taint;
  "medium" when the sink is clear but the source is implicit; "low"
  otherwise. Omit the finding if you would otherwise mark it below "low".`;

const RECORD_FINDINGS_TOOL: Tool = {
  name: "record_findings",
  description:
    "Record structured vulnerability findings from the PR diff. Call exactly once.",
  input_schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: [
                "sql_injection_risk",
                "xss_risk",
                "command_injection_risk",
                "path_traversal_risk",
              ],
            },
            file: { type: "string" },
            line: { type: "integer", minimum: 1 },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            severity: {
              type: "string",
              enum: ["critical", "high", "medium"],
            },
            explanation: { type: "string", maxLength: 500 },
            why_it_matters: { type: "string", maxLength: 500 },
            suggested_fix: { type: "string", maxLength: 500 },
            example_fix: { type: "string", maxLength: 2000 },
            original_snippet: { type: "string", maxLength: 2000 },
          },
          required: [
            "type",
            "file",
            "line",
            "confidence",
            "severity",
            "explanation",
            "why_it_matters",
            "suggested_fix",
            "example_fix",
            "original_snippet",
          ],
        },
      },
    },
    required: ["findings"],
  },
};

const VALID_FINDING_TYPES: readonly FindingType[] = [
  "sql_injection_risk",
  "xss_risk",
  "command_injection_risk",
  "path_traversal_risk",
] as const;

function isConfidence(v: unknown): v is Finding["confidence"] {
  return v === "high" || v === "medium" || v === "low";
}

function isSeverity(v: unknown): v is Finding["severity"] {
  return v === "critical" || v === "high" || v === "medium";
}

function asTrimmedString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function toFinding(raw: Record<string, unknown>): Finding | null {
  const type = raw.type as string;
  if (!VALID_FINDING_TYPES.includes(type as FindingType)) return null;
  if (!asTrimmedString(raw.file)) return null;
  if (typeof raw.line !== "number" || !Number.isFinite(raw.line)) return null;
  if (!isConfidence(raw.confidence)) return null;
  if (!isSeverity(raw.severity)) return null;
  if (!asTrimmedString(raw.explanation)) return null;
  if (!asTrimmedString(raw.why_it_matters)) return null;
  if (!asTrimmedString(raw.suggested_fix)) return null;
  if (!asTrimmedString(raw.example_fix)) return null;
  if (!asTrimmedString(raw.original_snippet)) return null;
  return {
    type: type as FindingType,
    file: asTrimmedString(raw.file),
    line: raw.line,
    confidence: raw.confidence,
    severity: raw.severity,
    explanation: asTrimmedString(raw.explanation),
    why_it_matters: asTrimmedString(raw.why_it_matters),
    suggested_fix: asTrimmedString(raw.suggested_fix),
    example_fix: asTrimmedString(raw.example_fix),
    original_snippet: asTrimmedString(raw.original_snippet),
  };
}

function parseToolInput(input: unknown): AnalysisResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { findings: [] };
  }
  const findingsRaw = (input as { findings?: unknown }).findings;
  if (!Array.isArray(findingsRaw)) return { findings: [] };

  const findings: Finding[] = [];
  for (const item of findingsRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const f = toFinding(item as Record<string, unknown>);
    if (f) findings.push(f);
  }
  return { findings };
}

/**
 * Analyze a raw PR diff for vulnerabilities via Claude.
 * On any failure (missing API key, timeout, HTTP error, bad tool input),
 * returns `{ findings: [] }` so the caller can fall back to heuristics.
 */
export async function analyzeCode(diff: string): Promise<AnalysisResult> {
  const trimmed = typeof diff === "string" ? diff.trim() : "";
  if (!trimmed) return { findings: [] };

  const result = await callClaude({
    model: CLAUDE_MODELS.DETECTION,
    system: cachedSystem(SYSTEM_PROMPT),
    tool: RECORD_FINDINGS_TOOL,
    messages: [
      {
        role: "user",
        content: `Analyze this pull request diff and call record_findings.\n\n${trimmed}`,
      },
    ],
  });

  if (!result.ok) return { findings: [] };
  return parseToolInput(result.toolInput);
}
