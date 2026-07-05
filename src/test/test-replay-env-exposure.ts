/**
 * F-004 stage 2a-2 - dedicated deterministic replay round-trip gate (free, in CI).
 *
 * As of stage 2b.0 the mechanism lives in the shared, parameterized engine
 * (replay-harness.ts): this file is now a thin entry point that forces replay
 * mode, then delegates to runReplayGate() with the env-exposure spec. Behavior
 * is unchanged from 2a - all 17 LLM-reaching fixtures rebuild their synthetic
 * diff, run the REAL detector end to end in replay mode, and assert the
 * flagged outcome === the fixture's meta.expectedFlagged.
 *
 * SCOPE AND LIMITS (F-008 guardrail; enforced in the shared engine):
 *   Verifies detector WIRING, tool-input PARSING, and LANE / confidence-ladder
 *   logic against FROZEN recorded samples only. NOT detection quality or model
 *   behavior. A green run here is NOT "detection verified". Model judgment is
 *   stage 3 (opt-in live), never here.
 *
 * SELF-CONTAINED FOR CI:
 *   - Forces FIXOR_REPLAY=1 in-process; no env prefix needed to run it.
 *   - No network, no DB, and NO API key. Replay short-circuits inside callClaude
 *     BEFORE any Anthropic client is constructed, so a keyless run is the real
 *     CI condition and MUST still pass.
 *
 * FAIL LOUD, NEVER SKIP GREEN (in the shared engine):
 *   - A missing / key-drifted recording throws ReplayFixtureMissing, caught and
 *     marked FAIL for that fixture; it never passes silently.
 *   - A completeness manifest of all 17 source fixtures is enforced: a deleted
 *     or renamed recording is a loud FAIL, not silently reduced coverage.
 *   - A prompt-fingerprint drift or an escalation-flag footgun fails loud too.
 */

// Force replay mode BEFORE importing the detector chain so the whole chain runs
// against recordings. resolveReplayMode reads process.env per call, but setting
// it up top is unambiguous and defensive. FIXOR_RECORD is cleared so an
// inherited record flag can never turn this read-only gate into a spender.
process.env.FIXOR_REPLAY = "1";
delete process.env.FIXOR_RECORD;

import { runReplayGate } from "./replay-harness";
import { envExposureReplaySpec } from "./specs/env-exposure.replay-spec";

runReplayGate(envExposureReplaySpec).catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
