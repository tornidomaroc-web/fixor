import type { AnalysisResult, Finding, FindingType } from "./types";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const REQUEST_TIMEOUT_MS = 45_000;
const SYSTEM_PROMPT = `You are a defensive security analyzer. Detect SQL injection risks only.

Return ONLY valid JSON matching this schema:
{
  "findings": [
    {
      "type": "sql_injection_risk",
      "file": "path/to/file",
      "line": 42,
      "confidence": "high" | "medium" | "low",
      "severity": "critical" | "high" | "medium",
      "explanation": "Brief explanation of the issue",
      "why_it_matters": "Why this is a security concern",
      "suggested_fix": "Short description of the fix",
      "example_fix": "const safe = 'SELECT * FROM users WHERE id = ?';",
      "original_snippet": "const unsafe = \`SELECT * FROM users WHERE id = \${userId}\`;"
    }
  ]
}

Rules:
- original_snippet MUST contain the exact vulnerable line(s) from the diff, as-is
- example_fix MUST contain the corrected safe version
- Never include exploits, payloads, or attack instructions
- If no SQL injection risks found, return {"findings": []}`;

function extractAssistantText(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const content = (parsed as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object") {
      const o = block as { type?: unknown; text?: unknown };
      if (o.type === "text" && typeof o.text === "string") {
        parts.push(o.text);
      }
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function stripCodeFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    const lines = t.split("\n");
    if (lines.length >= 2) {
      lines.shift();
      if (lines.length && lines[lines.length - 1].trim().startsWith("```")) {
        lines.pop();
      }
      t = lines.join("\n").trim();
    }
  }
  return t;
}

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
  const VALID_TYPES = ["sql_injection_risk", "xss_risk", "command_injection_risk", "path_traversal_risk"];
  if (!VALID_TYPES.includes(raw.type as string)) return null;
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
    type: raw.type as FindingType,
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

function parseAnalysisResult(payload: unknown): AnalysisResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { findings: [] };
  }
  const findingsRaw = (payload as { findings?: unknown }).findings;
  if (!Array.isArray(findingsRaw)) {
    return { findings: [] };
  }
  const findings: Finding[] = [];
  for (const item of findingsRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const f = toFinding(rec);
    if (f) findings.push(f);
  }
  return { findings };
}

/**
 * Analyze a raw PR diff for SQL injection risks via Claude.
 * On missing API key, HTTP errors, timeouts, or invalid JSON → `{ findings: [] }`.
 */
export async function analyzeCode(diff: string): Promise<AnalysisResult> {
  const trimmed = typeof diff === "string" ? diff.trim() : "";
  if (!trimmed) return { findings: [] };

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { findings: [] };

  try {
    const signal =
      typeof AbortSignal !== "undefined" &&
      typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        : undefined;

    const res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Analyze this pull request diff and respond with JSON only.\n\n${trimmed}`,
          },
        ],
      }),
      signal,
    });

    const rawBody = await res.text();
    let envelope: unknown;
    try {
      envelope = JSON.parse(rawBody) as unknown;
    } catch {
      return { findings: [] };
    }

    if (!res.ok) return { findings: [] };

    const text = extractAssistantText(envelope);
    if (!text?.trim()) return { findings: [] };

    const jsonSlice = stripCodeFences(text.trim());
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonSlice) as unknown;
    } catch {
      return { findings: [] };
    }

    return parseAnalysisResult(parsed);
  } catch {
    return { findings: [] };
  }
}
