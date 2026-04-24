import type {
  NormalizedSqlInjectionFinding,
  SqlDialect,
} from "../types/vulnerability.types";
import {
  ANTHROPIC_API_VERSION,
  CLAUDE_MODELS,
  MODEL_DEFAULTS,
} from "../config/models";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = CLAUDE_MODELS.REASONING;
const REQUEST_TIMEOUT_MS = MODEL_DEFAULTS[CLAUDE_MODELS.REASONING].timeoutMs;

export type RiskExplanationOptions = {
  dialect?: SqlDialect;
  includeProof?: boolean;
};

/** @deprecated Use {@link RiskExplanationOptions}. */
export type ExploitOptions = RiskExplanationOptions;

export type SqlInjectionExploit = {
  vulnerability: string;
  payload: string;
  attackDescription: string;
  proofOfConcept: string;
  impact: string;
  severity: "critical" | "high" | "medium";
};

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

function isSeverity(s: unknown): s is SqlInjectionExploit["severity"] {
  return s === "critical" || s === "high" || s === "medium";
}

function staticRiskExplanationFallback(): SqlInjectionExploit {
  return {
    vulnerability: "SQL injection (generic)",
    payload:
      "N/A — use parameterized queries / prepared statements; avoid string-building SQL from user input.",
    attackDescription:
      "User-controlled values appear to be embedded in SQL without binding. This increases risk of unauthorized data access or modification.",
    proofOfConcept:
      "Risk explanation was unavailable. Review the flagged snippet and validate with safe, non-production test data only.",
    impact:
      "May allow reading or modifying database contents depending on DB user privileges and query context.",
    severity: "medium",
  };
}

function asTrimmedString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeRiskExplanationJson(
  raw: Record<string, unknown>,
  includeProof: boolean
): SqlInjectionExploit | null {
  const vulnerability = asTrimmedString(raw.vulnerability);
  const payload = asTrimmedString(raw.payload);
  const attackDescription = asTrimmedString(raw.attackDescription);
  let proofOfConcept = asTrimmedString(raw.proofOfConcept);
  const impact = asTrimmedString(raw.impact);
  const sev = isSeverity(raw.severity) ? raw.severity : "medium";

  if (!includeProof) {
    proofOfConcept =
      proofOfConcept || "Detailed verification steps omitted (includeProof: false).";
  }

  if (
    !vulnerability ||
    !payload ||
    !attackDescription ||
    !proofOfConcept ||
    !impact
  ) {
    return null;
  }

  return {
    vulnerability,
    payload,
    attackDescription,
    proofOfConcept,
    impact,
    severity: sev,
  };
}

function buildRiskExplanationPrompt(
  finding: NormalizedSqlInjectionFinding,
  dialect: SqlDialect,
  includeProof: boolean
): string {
  const proofLine = includeProof
    ? "Include proofOfConcept as safe, defensive verification guidance (no step-by-step attack instructions)."
    : "Set proofOfConcept to a one-line note that detailed verification was omitted.";

  return [
    "You are a senior security analyst producing a defensive risk explanation for SQL injection.",
    "Respond with a single JSON object only. No markdown, no code fences, no text before or after the JSON.",
    "",
    `SQL dialect context: ${dialect}.`,
    "",
    "Relevant code snippet:",
    finding.originalCode,
    "",
    "The JSON object must have exactly these string keys:",
    "vulnerability, payload, attackDescription, proofOfConcept, impact, severity",
    "",
    'severity must be one of: "critical", "high", "medium" (use conservative judgment).',
    "payload must describe the risk pattern at a high level (or say N/A); do not provide weaponized input.",
    proofLine,
    "",
    "Focus on why the pattern is risky and how defenders should remediate.",
  ].join("\n");
}

/**
 * Uses Anthropic Messages API to produce structured SQLi risk context for reports.
 * On any failure returns {@link staticRiskExplanationFallback} (severity "medium").
 */
export async function generateSqlInjectionRiskExplanation(
  finding: NormalizedSqlInjectionFinding,
  options?: RiskExplanationOptions
): Promise<SqlInjectionExploit> {
  const dialect: SqlDialect = options?.dialect ?? "mysql";
  const includeProof = options?.includeProof !== false;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return staticRiskExplanationFallback();
  }

  try {
    const prompt = buildRiskExplanationPrompt(finding, dialect, includeProof);
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
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MODEL_DEFAULTS[CLAUDE_MODELS.REASONING].maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
      signal,
    });

    const rawBody = await res.text();
    let envelope: unknown;
    try {
      envelope = JSON.parse(rawBody) as unknown;
    } catch {
      return staticRiskExplanationFallback();
    }

    if (!res.ok) {
      return staticRiskExplanationFallback();
    }

    const text = extractAssistantText(envelope);
    if (!text?.trim()) {
      return staticRiskExplanationFallback();
    }

    const jsonSlice = stripCodeFences(text.trim());
    let payload: unknown;
    try {
      payload = JSON.parse(jsonSlice) as unknown;
    } catch {
      return staticRiskExplanationFallback();
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return staticRiskExplanationFallback();
    }

    const normalized = normalizeRiskExplanationJson(
      payload as Record<string, unknown>,
      includeProof
    );
    if (!normalized) {
      return staticRiskExplanationFallback();
    }

    return normalized;
  } catch {
    return staticRiskExplanationFallback();
  }
}

/** @deprecated Use {@link generateSqlInjectionRiskExplanation}. */
export const generateSqlInjectionExploit = generateSqlInjectionRiskExplanation;
