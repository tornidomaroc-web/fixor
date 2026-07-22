/**
 * Per-call ledger for EVERY callClaude outcome.
 *
 * Why this exists, and why it is not llm-coverage. The coverage tally next
 * door answers "was detection degraded?", so it deliberately EXCLUDES
 * auxiliary calls (fix generation, risk explainer, H8 escalation) and carries
 * no cost. That makes it the wrong instrument for "how many calls did this
 * run actually make, and what did they cost". The other candidate,
 * `lastCallCost`, is a single overwritten pointer: after a detect() that made
 * N calls it holds only the last one.
 *
 * So neither existing instrument can count a run. The stability harness
 * previously INFERRED its call count from the absence of a pre-filter reason
 * on the first diagnostic, which is correct only while every fixture happens
 * to make exactly one call, and is structurally blind to the escalation
 * second call (H8 fires resolveMediumVerdict per MEDIUM verdict, and idor
 * does that inside its per-pair loop, so one detect() can issue one detection
 * call plus up to MAX_PAIRS_PER_FILE escalations).
 *
 * This ledger counts at the single chokepoint instead, on every terminal
 * outcome including auxiliary calls, replayed calls and failures.
 *
 * THREE ACCUMULATORS, NO ARRAY. A per-call array would grow without bound in
 * a long-lived process (`server/webhook-server.ts` runs indefinitely), so this
 * keeps O(1) state. Per-fixture attribution comes from snapshotting around the
 * work, exactly as llm-coverage does; the ledger itself never remembers a call.
 *
 * PRICED vs UNPRICED is the mode signal. A replayed call and a failed call
 * produce no `message.usage`, so they increment `calls` but not `pricedCalls`.
 * A consumer therefore learns whether a cost figure is MEASURED or has to be
 * modelled by comparing the two, rather than by probing env vars or guessing
 * from a key. That is an observation of what happened, not a prediction.
 */

/** Opaque marker for "where the ledger stood when my work started". */
export interface LlmCallLedgerSnapshot {
  calls: number;
  pricedCalls: number;
  costUsd: number;
}

export type LlmCallLedgerDelta = LlmCallLedgerSnapshot;

let calls = 0;
let pricedCalls = 0;
let costUsd = 0;

/**
 * One entry per logical callClaude outcome (internal retries are not separate
 * calls, matching the coverage tally's convention). Pass the computed cost on
 * the real-response path and null everywhere else.
 */
export function recordLlmCall(cost: { costUsd: number } | null): void {
  calls++;
  if (cost) {
    pricedCalls++;
    costUsd += cost.costUsd;
  }
}

export function snapshotLlmCalls(): LlmCallLedgerSnapshot {
  return { calls, pricedCalls, costUsd };
}

export function llmCallsSince(
  snap: LlmCallLedgerSnapshot,
): LlmCallLedgerDelta {
  return {
    calls: calls - snap.calls,
    pricedCalls: pricedCalls - snap.pricedCalls,
    costUsd: costUsd - snap.costUsd,
  };
}
