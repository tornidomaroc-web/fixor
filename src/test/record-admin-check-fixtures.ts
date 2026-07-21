/**
 * F-004 stage 2b.3 - record admin-check replay fixtures (owner-local, spends).
 *
 * Thin entry point mirroring record-auth-bypass-fixtures.ts: establishes
 * record-mode env, then delegates to recordFixtures() with the admin-check
 * spec. Same CLI (named selectors + "all"), same class-mismatch /
 * no-fixture-written failures.
 *
 * Records the 30 MODEL-REACHING (bucket-c) fixtures ONLY. The other 12 fixtures
 * never call the model - 9 take the Option G literal-tier bypass and 3 are
 * dropped pre-model - so they have no request to key a recording on. They are
 * guarded for free by `test:admin-check-prefilter`. Selecting one of them here
 * would write no fixture and fail loud rather than silently record nothing.
 *
 * No lane pins are pre-encoded for admin-check (unlike webhook-unverified's
 * negatives 14/15): the corpus is designed so every positive flags and every
 * model-reaching negative stays silent. If a fixture records off-class (a
 * MEDIUM/review-queue or LOW positive), that is a record-time calibration
 * decision for the owner - see the RECONCILIATION HOOK in
 * specs/admin-check.replay-spec.ts. Note especially the H7 lane question in that
 * header: admin-check is the RECEIVING side of auth-bypass's deferral, so a
 * silent route-def positive here is a potential recall hole, not a test-shape
 * detail. Escalate it.
 *
 * NOT wired into CI. Recording is the ONLY path that spends API budget and is
 * run locally by the owner with their own key; the replay gate is keyless.
 *
 * Safety (guards below + in the engine):
 *   - Requires ANTHROPIC_API_KEY; refuses (loud) without it.
 *   - Requires an explicit fixture selection; refuses with no args.
 *   - Refuses if FIXOR_REPLAY is set (ambiguous with record mode).
 *   - Refuses if FIXOR_ADMIN_CHECK_LLM_OPT_IN=true: it routes the 9 bucket-(b)
 *     bypass fixtures onto the model path, which would silently invalidate this
 *     30-id manifest (they would become recordable and `extra` recordings could
 *     appear) rather than fail it.
 *   - Refuses if FIXOR_ESCALATE_MEDIUM=true (invalid Windows colon-path callerId
 *     "escalation:admin-check-multi"); enforced by assertEscalationUnset in the
 *     engine.
 *   - Exits non-zero on ANY class mismatch or no-fixture-written.
 *
 * Usage (from repo root, after build):
 *   ANTHROPIC_API_KEY=... node dist/test/record-admin-check-fixtures.js \
 *     positive/06 negative/01
 * Shorthand selectors and "all" (all 30 model-reaching) work too.
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
import {
  assertEnvFlagUnset,
  OPT_IN_GUARD,
  recordFixtures,
} from "./replay-harness";
import { adminCheckReplaySpec } from "./specs/admin-check.replay-spec";

// Detector-specific precondition. assertEscalationUnset() is enforced inside
// recordFixtures(); the opt-in flag is admin-check's own and the shared engine
// knows nothing about it, so it is asserted here, before any detector is built.
try {
  assertEnvFlagUnset(...OPT_IN_GUARD.ADMIN_CHECK);
} catch (err) {
  out.write(`REFUSING: ${(err as Error).message}\n`);
  process.exit(1);
}

recordFixtures(adminCheckReplaySpec, process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
