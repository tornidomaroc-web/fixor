/**
 * Shared verdict-layer escalation (H8, Phase H Tier 3).
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE FUZZY MIDDLE. A MEDIUM-confidence verdict from any detector is
 * otherwise suppressed to a human review queue and dies there (the
 * audit's "fuzzy middle" — apple/outlook webhooks, the H5 tenant
 * membership case, etc.). When FIXOR_ESCALATE_MEDIUM=true, that MEDIUM
 * is re-asked to a STRONGER second model (Opus 4.8) with WHOLE-FILE
 * context and a structured promote/clear/uncertain question. The
 * detection model stays Sonnet 4.6; this is a bounded, flagged second
 * pass only.
 *
 * DETERMINISTIC HANDLING (not a deterministic model). The model's answer
 * is not run-to-run deterministic (Opus 4.8 has no temperature:0). What
 * is deterministic is the MAPPING from its structured `decision`:
 *   promote_to_high → "emit-high"
 *   clear           → "drop"
 *   still_uncertain → "review-queue"
 * and the TOTAL FAIL-SAFE: any non-clean outcome — still_uncertain,
 * a refusal, no tool_use, timeout, http_error, parse_error, or a missing
 * API key — collapses to "review-queue", i.e. EXACTLY today's behavior.
 * Escalation can only ever MOVE a verdict toward emit-high or drop on an
 * explicit, parsed decision; any doubt leaves the MEDIUM where it sits.
 *
 * FLAG OFF (default). `resolveMediumVerdict` returns "review-queue" on
 * its first line, before any Anthropic client is constructed or any call
 * is made. The off-path is inert: the six detector MEDIUM branches behave
 * byte-identically to pre-H8 (no new call, no cost, no coverage tally —
 * the escalation call is tagged coverage:"auxiliary" anyway).
 *
 * SCOPE (binding). Mechanism-validated on a 4-anchor falsifier (1 promote
 * / 2 clear / 1 stay-uncertain), NOT accuracy-validated. No MEDIUM corpus
 * (≥8–10 cases/lane) exists yet. The flag ships OFF and STAYS OFF for real
 * scans. See docs/detector-capabilities.md (H8 row).
 * ─────────────────────────────────────────────────────────────────────
 */

import type { FindingType } from "./types";
import { CLAUDE_MODELS } from "../config/models";
import { calculateCost } from "../services/cost-tracking.service";
import { callClaude } from "./anthropic-client";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

/** What the detector should do with the MEDIUM verdict. */
export type EscalationDecision = "emit-high" | "drop" | "review-queue";

export interface ResolveMediumParams {
  /** Stable detector id (DETECTOR_ID), for the adjudicator prompt + telemetry. */
  detectorId: string;
  /** Vulnerability family under review. */
  findingType: FindingType;
  /** Scanned file path. */
  filePath: string;
  /** The line the MEDIUM verdict concerns (sink line for IDOR, trigger line otherwise). */
  candidateLine: number;
  /**
   * The first-pass (MEDIUM) verdict's reasoning. Passed as CONTEXT for the
   * adjudicator, NOT as the basis — the adjudicator judges from the whole
   * file. Kept deliberately neutral by callers so it cannot carry the answer.
   */
  originalReasoning: string;
  /** Whole file content; the second model judges primarily from this. */
  wholeFileContent: string;
}

/** Off by default. Only "true" enables escalation. Mirrors FIXOR_ADMIN_CHECK_LLM_OPT_IN. */
export function escalationEnabled(): boolean {
  return process.env.FIXOR_ESCALATE_MEDIUM === "true";
}

/**
 * Diagnostics sink — mirrors the detector `lastDiagnostics` convention so a
 * test/harness can read the raw decision + the call's USD cost without the
 * module taking a dependency on the test. Set ONLY when an escalation call
 * is actually made (flag on). Stays null on the inert off-path, which the
 * off-path acceptance test asserts.
 */
export interface EscalationDiag {
  detectorId: string;
  filePath: string;
  /** The model's decision enum verbatim, or null when no clean answer came back. */
  decisionRaw: string | null;
  /** The mapped decision actually returned to the detector. */
  decision: EscalationDecision;
  /** The adjudicator's one-line reasoning, or null. */
  reasoning: string | null;
  /** Computed USD cost of this one escalation call (0 if no call was priced). */
  usd: number;
  /** callClaude failure reason when the call did not return ok, else null. */
  failure: string | null;
}

export let lastEscalationDiag: EscalationDiag | null = null;
export function resetEscalationDiag(): void {
  lastEscalationDiag = null;
}

const ADJUDICATE_TOOL: Tool = {
  name: "adjudicate_verdict",
  description:
    "Record the second-opinion adjudication of ONE MEDIUM-confidence security verdict. Call exactly once.",
  input_schema: {
    type: "object",
    properties: {
      decision: {
        type: "string",
        enum: ["promote_to_high", "clear", "still_uncertain"],
        description:
          "promote_to_high = the whole file confirms a real vulnerability; clear = the whole file confirms the code is safe; still_uncertain = cannot decide from this file alone (deciding evidence is cross-file or genuinely ambiguous).",
      },
      reasoning: {
        type: "string",
        maxLength: 600,
        description:
          "One or two sentences pointing to the in-file evidence (or its absence) that drove the decision.",
      },
    },
    required: ["decision", "reasoning"],
  },
};

const SYSTEM_PROMPT = `You are a senior application-security reviewer acting as a SECOND OPINION inside a DEFENSIVE code-review pipeline that scans a team's own code. A fast first-pass model flagged a possible vulnerability at MEDIUM confidence — it saw a real vulnerability SHAPE but could not commit to HIGH. MEDIUM findings are otherwise suppressed to a human review queue. Adjudicate that single MEDIUM verdict from the WHOLE FILE you are given and return one structured decision.

Decide exactly one:
- "promote_to_high": the WHOLE FILE clearly confirms a real, exploitable vulnerability of the stated type at/around the cited line — the protective control is genuinely ABSENT or ineffective, and you can point to that in THIS file.
- "clear": the WHOLE FILE clearly confirms the code is SAFE for the stated type — a correct, effective protective control is present and VISIBLE IN THIS FILE (an in-file verification/comparison/authorization/ownership/membership check that gates the cited sink).
- "still_uncertain": you cannot reach either conclusion from this file alone — the deciding evidence lives in ANOTHER file (an imported helper whose body you cannot see, a value defined elsewhere), or the case is genuinely ambiguous.

Rules (fail-safe):
- Judge ONLY from the provided file content plus general security knowledge.
- Do NOT assume an imported helper enforces protection because its NAME suggests it. If the helper's implementation is not in this file, that is "still_uncertain", not "clear".
- An in-file control DOES count for "clear" even if one value it compares against is defined elsewhere, as long as the CONTROL SHAPE (read + compare + reject-on-mismatch, or an authorization/ownership/membership check that gates the sink) is fully visible here.
- When promote and clear are BOTH plausible, choose "still_uncertain". A wrong promote is a false alarm; a wrong clear hides a real bug; both are worse than leaving it for human review.
- This is defensive review of first-party code. Never output exploit instructions — only the structured decision and a one-line reasoning.

Call adjudicate_verdict exactly once. Never emit plain text.`;

function buildUserMessage(p: ResolveMediumParams): string {
  return `Detector: ${p.detectorId}
Vulnerability type under review: ${p.findingType}
File: ${p.filePath}
Cited line (the MEDIUM verdict concerns code at/around here): ${p.candidateLine}
First-pass (MEDIUM) reasoning: ${p.originalReasoning}

WHOLE FILE:
\`\`\`
${p.wholeFileContent}
\`\`\`

Adjudicate per your instructions and call adjudicate_verdict exactly once.`;
}

function mapDecision(decision: string | null): EscalationDecision {
  if (decision === "promote_to_high") return "emit-high";
  if (decision === "clear") return "drop";
  // still_uncertain — and every non-clean outcome — is fail-safe review-queue.
  return "review-queue";
}

function parseAdjudication(
  input: unknown,
): { decision: string | null; reasoning: string | null } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { decision: null, reasoning: null };
  }
  const obj = input as { decision?: unknown; reasoning?: unknown };
  const decision =
    obj.decision === "promote_to_high" ||
    obj.decision === "clear" ||
    obj.decision === "still_uncertain"
      ? obj.decision
      : null;
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : null;
  return { decision, reasoning };
}

/**
 * The shared verdict-layer hook. Returns what the detector should do with a
 * MEDIUM-confidence verdict. With the flag OFF this is a synchronous,
 * side-effect-free "review-queue" — no client, no call, no cost, and
 * `lastEscalationDiag` is left untouched (null).
 */
export async function resolveMediumVerdict(
  params: ResolveMediumParams,
): Promise<EscalationDecision> {
  // FLAG OFF (default): inert early return. Nothing below this line runs.
  if (!escalationEnabled()) {
    return "review-queue";
  }

  const result = await callClaude({
    callerId: `escalation:${params.detectorId}`,
    model: CLAUDE_MODELS.ESCALATION,
    // Auxiliary: an escalation failure must NEVER degrade scan coverage.
    // Primary Sonnet detection already succeeded; the fail-safe is the
    // review queue (today's behavior).
    coverage: "auxiliary",
    // Single-shot, rare call — no prompt caching (a 25% write premium for
    // reuse that won't happen within the cache TTL).
    system: SYSTEM_PROMPT,
    tool: ADJUDICATE_TOOL,
    messages: [{ role: "user", content: buildUserMessage(params) }],
  });

  let decisionRaw: string | null = null;
  let reasoning: string | null = null;
  let usd = 0;
  let failure: string | null = null;

  if (result.ok) {
    const parsed = parseAdjudication(result.toolInput);
    decisionRaw = parsed.decision;
    reasoning = parsed.reasoning;
    const usage = result.message.usage as
      | (typeof result.message.usage & {
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        })
      | undefined;
    if (usage) {
      usd = calculateCost({
        model: CLAUDE_MODELS.ESCALATION,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      });
    }
  } else {
    // no_api_key | timeout | http_error | parse_error → fail-safe review-queue.
    failure = result.reason;
  }

  const decision = mapDecision(decisionRaw);

  lastEscalationDiag = {
    detectorId: params.detectorId,
    filePath: params.filePath,
    decisionRaw,
    decision,
    reasoning,
    usd,
    failure,
  };

  return decision;
}
