/**
 * F-004 stage 2b.3 - admin-check deterministic replay round-trip gate
 * (free, keyless). Thin entry point mirroring test-replay-auth-bypass.ts:
 * forces replay mode, then delegates to runReplayGate() with the admin-check
 * spec. All 30 model-reaching fixtures rebuild their synthetic diff, run the
 * REAL detector end to end in replay mode, and assert the outcome per id -
 * flagged-vs-expected (the only shape used until a case records off-class; see
 * the reconciliation hook in specs/admin-check.replay-spec.ts).
 *
 * This gate covers bucket (c) ONLY: the 30 fixtures that reach callClaude. The
 * 9 Option G bypass positives and the 3 pre-model drops issue no request, so
 * they cannot be replayed; `test:admin-check-prefilter` guards them for free.
 * Together the two gates cover all 42 fixtures, by different means.
 *
 * NOT wired into CI in this step: the recordings dir
 * (fixtures/replay/admin-check-multi/) does not exist until the recording step,
 * so running this now FAILS LOUD (manifest completeness reports all 30 ids as
 * missing) with a non-zero exit - it never does anything live and never demands
 * a key. It gets wired into test:ci only once the fixtures are recorded and
 * committed.
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

import {
  assertEnvFlagUnset,
  OPT_IN_GUARD,
  runReplayGate,
} from "./replay-harness";
import { adminCheckReplaySpec } from "./specs/admin-check.replay-spec";

// Detector-specific precondition. assertEscalationUnset() is enforced inside
// runReplayGate(); the opt-in flag is admin-check's own and the shared engine
// knows nothing about it, so it is asserted here, before any detector is built.
// With the flag on, the 9 bucket-(b) bypass fixtures would take the model path,
// silently invalidating this 30-id manifest instead of failing it.
try {
  assertEnvFlagUnset(...OPT_IN_GUARD.ADMIN_CHECK);
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
}

runReplayGate(adminCheckReplaySpec).catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
