/**
 * F-004 stage 2b.4 - idor deterministic replay round-trip gate (free, keyless).
 *
 * Thin entry point mirroring test-replay-admin-check.ts: forces replay mode,
 * then delegates to runReplayGate() with the idor spec. All 26 source fixtures
 * rebuild their synthetic diff (plus sidecars, for the three negatives that have
 * them), run the REAL detector end to end in replay mode, and assert the EXACT
 * finding set per id.
 *
 * WHY THE EXACT SET, NOT "did it flag": idor emits one finding per (source,
 * sink) candidate pair - 48 pairs over the 26 files, up to six in one file. A
 * boolean `findings.length > 0` passes on a multi-pair positive when any single
 * pair flags, so a regression that drops five of six findings would read green.
 *
 * COVERAGE: this gate covers the WHOLE corpus. idor is a pure bucket-(c)
 * detector - all 26 fixtures reach callClaude, there is no Option-G-style
 * deterministic bypass, and nothing is dropped pre-model. So unlike admin-check
 * (42 fixtures split across a replay gate and a free deterministic gate) idor
 * needs no companion prefilter gate.
 *
 * THIS GATE CANNOT PASS YET, ON PURPOSE. Two independent reasons, both loud:
 *   1. `fixtures/replay/idor-multi/` does not exist until the recording step, so
 *      manifest completeness reports all 26 ids as missing.
 *   2. The spec's EXPECTED_SET is empty (the sets are a property of the model's
 *      response and are reconciled FROM the recordings). findingSetOutcome
 *      reports a loud config error per id rather than silently degrading to a
 *      boolean.
 * It never does anything live and never demands a key. It gets wired into
 * `test:ci` only once the fixtures are recorded AND the expected sets are
 * reconciled.
 *
 * SCOPE AND LIMITS (F-008 guardrail; enforced in the shared engine):
 *   Verifies detector WIRING, tool-input PARSING, and the verdict path against
 *   FROZEN recorded samples only. NOT detection quality or model behavior. A
 *   green run here is NOT "detection verified". Model judgment is stage 3
 *   (opt-in live), never here.
 *
 * SELF-CONTAINED / KEYLESS:
 *   - Forces FIXOR_REPLAY=1 in-process; clears FIXOR_RECORD so an inherited
 *     record flag can never turn this read-only gate into a spender.
 *   - No network, no DB, and NO API key. Replay short-circuits inside callClaude
 *     BEFORE any Anthropic client is constructed.
 *   - assertEscalationUnset is enforced inside runReplayGate(): with
 *     FIXOR_ESCALATE_MEDIUM=true, idor's MEDIUM branch would fire a SECOND
 *     callClaude (callerId `escalation:idor-multi`, an illegal Windows fixture
 *     dir). There is no idor-specific opt-in env var, so no second assertion is
 *     needed here.
 */

// Force replay mode BEFORE importing the detector chain so the whole chain runs
// against recordings. FIXOR_RECORD is cleared so an inherited record flag can
// never turn this read-only gate into a spender.
process.env.FIXOR_REPLAY = "1";
delete process.env.FIXOR_RECORD;

import { runReplayGate } from "./replay-harness";
import { idorReplaySpec } from "./specs/idor.replay-spec";

runReplayGate(idorReplaySpec).catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
