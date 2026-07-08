/**
 * F-004 stage 2b.2 - record auth-bypass replay fixtures (owner-local, spends).
 *
 * Thin entry point mirroring record-webhook-unverified-fixtures.ts: establishes
 * record-mode env, then delegates to recordFixtures() with the auth-bypass
 * spec. Same CLI (named selectors + "all"), same class-mismatch /
 * no-fixture-written failures.
 *
 * No lane pins are pre-encoded for auth-bypass (unlike webhook-unverified's
 * negatives 14/15): the corpus is designed so every positive flags at HIGH and
 * every model-reaching negative stays silent. If a fixture records off-class
 * (a MEDIUM/review-queue positive, or an H7 laneDeferral), that is a record-time
 * calibration decision for the owner - see the RECONCILIATION HOOK in
 * specs/auth-bypass.replay-spec.ts.
 *
 * NOT wired into CI. Recording is the ONLY path that spends API budget and is
 * run locally by the owner with their own key; the replay gate is keyless.
 *
 * Safety (guards below + in the engine):
 *   - Requires ANTHROPIC_API_KEY; refuses (loud) without it.
 *   - Requires an explicit fixture selection; refuses with no args.
 *   - Refuses if FIXOR_REPLAY is set (ambiguous with record mode).
 *   - Refuses if FIXOR_ESCALATE_MEDIUM=true (invalid Windows colon-path
 *     callerId "escalation:auth-bypass-multi"); enforced by assertEscalationUnset
 *     in the engine.
 *   - Exits non-zero on ANY class mismatch or no-fixture-written.
 *
 * Usage (from repo root, after build):
 *   ANTHROPIC_API_KEY=... node dist/test/record-auth-bypass-fixtures.js \
 *     positive/01 negative/01
 * Shorthand selectors and "all" (all 37 model-reaching) work too.
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
import { authBypassReplaySpec } from "./specs/auth-bypass.replay-spec";

recordFixtures(authBypassReplaySpec, process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
