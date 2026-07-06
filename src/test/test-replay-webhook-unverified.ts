/**
 * F-004 stage 2b.1 - webhook-unverified deterministic replay round-trip gate
 * (free, keyless). Thin entry point mirroring test-replay-env-exposure.ts:
 * forces replay mode, then delegates to runReplayGate() with the
 * webhook-unverified spec. All 34 model-reaching fixtures rebuild their
 * synthetic diff, run the REAL detector end to end in replay mode, and assert
 * the outcome per id - flagged-vs-expected for most ids, and the MEDIUM/
 * review-queue verdict-lane for the Phase F anchors (negatives 14/15).
 *
 * NOT wired into CI in this step: the recordings dir
 * (fixtures/replay/webhook-unverified-multi/) is empty until the recording
 * step, so running this now FAILS LOUD (missing recordings / ReplayFixtureMissing)
 * with a non-zero exit - it never does anything live and never demands a key.
 * It gets wired into test:ci only once the fixtures are recorded and committed.
 *
 * SCOPE AND LIMITS (F-008 guardrail; enforced in the shared engine):
 *   Verifies detector WIRING, tool-input PARSING, and LANE / confidence-ladder
 *   logic against FROZEN recorded samples only. NOT detection quality or model
 *   behavior. A green run here is NOT "detection verified". Model judgment is
 *   stage 3 (opt-in live), never here.
 *
 * SELF-CONTAINED / KEYLESS:
 *   - Forces FIXOR_REPLAY=1 in-process; clears FIXOR_RECORD so an inherited
 *     record flag can never turn this read-only gate into a spender.
 *   - No network, no DB, and NO API key. Replay short-circuits inside callClaude
 *     BEFORE any Anthropic client is constructed.
 */

// Force replay mode BEFORE importing the detector chain so the whole chain runs
// against recordings. FIXOR_RECORD is cleared so an inherited record flag can
// never turn this read-only gate into a spender.
process.env.FIXOR_REPLAY = "1";
delete process.env.FIXOR_RECORD;

import { runReplayGate } from "./replay-harness";
import { webhookUnverifiedReplaySpec } from "./specs/webhook-unverified.replay-spec";

runReplayGate(webhookUnverifiedReplaySpec).catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
