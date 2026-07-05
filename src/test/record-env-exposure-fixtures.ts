/**
 * F-004 stage 2a-2 - record env-exposure replay fixtures (owner-local, spends).
 *
 * THE ONLY PATH THAT SPENDS API BUDGET in the replay work. Run locally by the
 * owner with their own key. Never in CI, never automatic.
 *
 * As of stage 2b.0 the mechanism lives in the shared, parameterized engine
 * (replay-harness.ts): this file is now a thin entry point that establishes the
 * record-mode env, then delegates to recordFixtures() with the env-exposure
 * spec. Behavior is unchanged from 2a - same CLI, same selectors ("positive/04"
 * shorthand and "all"), same class-mismatch / no-fixture-written failures.
 *
 * What it does, per named fixture (in the shared engine):
 *   1. Builds the same synthetic diff the replay gate uses (byte-frozen).
 *   2. Runs the REAL detector end to end with FIXOR_RECORD=1, so a successful
 *      LLM call is frozen to fixtures/replay/env-exposure-multi/<sha>.json.
 *   3. Reads the MEASURED per-call USD from lastCallCost (message.usage, no DB).
 *   4. Augments the just-written file's meta with provenance (sourceFixture,
 *      expectedFlagged, note).
 *   5. Asserts the detector's END-TO-END flagged outcome matches the fixture's
 *      expected class. A MEDIUM-ceiling positive can legitimately record
 *      isVulnerable:true@medium yet expectedFlagged:false (ladder suppression).
 *
 * Safety (guards below + in the engine):
 *   - Requires ANTHROPIC_API_KEY; refuses (loud) without it.
 *   - Requires an explicit fixture selection; refuses with no args.
 *   - Refuses if FIXOR_REPLAY is set (ambiguous with record mode).
 *   - Refuses if FIXOR_ESCALATE_MEDIUM=true (would fire a second, colon-path
 *     callerId call that is an invalid Windows fixture dir).
 *   - Exits non-zero on ANY class mismatch or any selected fixture that
 *     produced no fixture file (pre-filter SKIP).
 *
 * Usage (from repo root, after build):
 *   ANTHROPIC_API_KEY=... node dist/test/record-env-exposure-fixtures.js \
 *     positive/01-debug-env-route.ts positive/02-error-handler-leaks-env.ts
 * Shorthand selectors ("positive/04") and "all" (all 17 LLM-reaching) work too.
 */

const out = process.stdout;

// --- Guards BEFORE importing the detector chain (which reads the mode) --------
if (process.env.FIXOR_REPLAY) {
  out.write(
    "REFUSING: FIXOR_REPLAY is set. This is the RECORD harness; unset FIXOR_REPLAY.\n",
  );
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY?.trim()) {
  out.write(
    "REFUSING: ANTHROPIC_API_KEY is not set. Recording spends real budget and\n" +
      "needs your key. Set it and re-run. (Nothing was recorded.)\n",
  );
  process.exit(1);
}
process.env.FIXOR_RECORD = "1";

// Imported after the guards so the record mode is active for the whole chain.
import { recordFixtures } from "./replay-harness";
import { envExposureReplaySpec } from "./specs/env-exposure.replay-spec";

recordFixtures(envExposureReplaySpec, process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
