import type {
  NormalizedSqlInjectionFinding,
  SqlDialect,
} from "../types/vulnerability.types";
import { CLAUDE_MODELS } from "../config/models";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { cachedSystem, callClaude } from "../analysis-engine/anthropic-client";

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

const RISK_SYSTEM_PROMPT = `You are a senior defensive security analyst.
Produce a short, structured risk write-up that helps the engineer fix
a SQL injection finding — not exploit it.

Never emit weaponized payloads. "payload" must describe the risk shape
at a high level (or "N/A"). "proofOfConcept" must describe safe,
defensive verification — never step-by-step attack instructions.

Call the emit_risk_explanation tool exactly once.`;

const EMIT_RISK_TOOL: Tool = {
  name: "emit_risk_explanation",
  description: "Emit a structured, defensive risk explanation.",
  input_schema: {
    type: "object",
    properties: {
      vulnerability: { type: "string" },
      payload: { type: "string" },
      attackDescription: { type: "string" },
      proofOfConcept: { type: "string" },
      impact: { type: "string" },
      severity: { type: "string", enum: ["critical", "high", "medium"] },
    },
    required: [
      "vulnerability",
      "payload",
      "attackDescription",
      "proofOfConcept",
      "impact",
      "severity",
    ],
  },
};

function isSeverity(s: unknown): s is SqlInjectionExploit["severity"] {
  return s === "critical" || s === "high" || s === "medium";
}

function asTrimmedString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
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

function normalizeFromToolInput(
  raw: unknown,
  includeProof: boolean
): SqlInjectionExploit | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const vulnerability = asTrimmedString(r.vulnerability);
  const payload = asTrimmedString(r.payload);
  const attackDescription = asTrimmedString(r.attackDescription);
  let proofOfConcept = asTrimmedString(r.proofOfConcept);
  const impact = asTrimmedString(r.impact);
  const sev = isSeverity(r.severity) ? r.severity : "medium";

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

function buildUserPrompt(
  finding: NormalizedSqlInjectionFinding,
  dialect: SqlDialect,
  includeProof: boolean
): string {
  const proofLine = includeProof
    ? 'Include proofOfConcept as safe, defensive verification guidance (no step-by-step attack instructions).'
    : 'Set proofOfConcept to a one-line note that detailed verification was omitted.';

  return [
    `SQL dialect context: ${dialect}.`,
    "",
    "Relevant code snippet:",
    finding.originalCode,
    "",
    proofLine,
    "",
    "Call emit_risk_explanation with the structured result.",
  ].join("\n");
}

/**
 * Produce structured SQLi risk context for reports using the
 * emit_risk_explanation tool. Falls back to a static generic explanation
 * on any error.
 */
export async function generateSqlInjectionRiskExplanation(
  finding: NormalizedSqlInjectionFinding,
  options?: RiskExplanationOptions
): Promise<SqlInjectionExploit> {
  const dialect: SqlDialect = options?.dialect ?? "mysql";
  const includeProof = options?.includeProof !== false;

  const result = await callClaude({
    model: CLAUDE_MODELS.REASONING,
    system: cachedSystem(RISK_SYSTEM_PROMPT),
    tool: EMIT_RISK_TOOL,
    messages: [
      {
        role: "user",
        content: buildUserPrompt(finding, dialect, includeProof),
      },
    ],
  });

  if (!result.ok) return staticRiskExplanationFallback();
  const normalized = normalizeFromToolInput(result.toolInput, includeProof);
  return normalized ?? staticRiskExplanationFallback();
}

/** @deprecated Use {@link generateSqlInjectionRiskExplanation}. */
export const generateSqlInjectionExploit = generateSqlInjectionRiskExplanation;
