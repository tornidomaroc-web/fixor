/**
 * F-004 stage 2b.4 - record idor replay fixtures (owner-local, spends).
 *
 * Thin entry point mirroring record-admin-check-fixtures.ts: establishes record
 * mode, then delegates to recordFixtures() with the idor spec. Same CLI (named
 * selectors + "all"), same class-mismatch / no-fixture-written failures.
 *
 * Records ALL 26 source fixtures across the three corpora (fixtures/idor 18,
 * fixtures/idor-tenant 6, fixtures/idor-multi 2). idor is a PURE bucket-(c)
 * detector: every fixture reaches callClaude, there is no Option-G-style bypass,
 * and nothing is dropped pre-model. So unlike admin-check there is no
 * intentionally-absent subset and no companion free deterministic gate.
 *
 * RECORD ALL 26 IN ONE PROCESS: `node dist/test/record-idor-fixtures.js all`.
 * Each new process re-pays the system-prompt cache-write premium (idor's prompt
 * is 8,092 chars, about 2,023 tokens, so roughly $0.007 per cold process).
 * Batching to enforce a spend ceiling is how 2b.3 wasted ~$0.027. Do not chunk.
 *
 * DO NOT trust the "projected manifest" line the engine prints: it extrapolates
 * the running mean, which early in a run still carries the cold cache-write
 * outlier. On 2b.3 it projected ~$0.3914, then ~$0.2407, against a measured
 * $0.28092. Report the MEASURED total.
 *
 * SIDECARS ARE LOAD-BEARING HERE. Three negatives carry companion files
 * (rls-policy on 03/04, middleware on 07) whose bodies are interpolated into the
 * user message and therefore into the request key. The spec wires `loadSidecars`
 * so they are injected. Recording without them would show the model an unscoped
 * request-derived DB lookup with no ground truth, almost certainly returning
 * isVulnerable:true, and would freeze three FALSE POSITIVES into the manifest.
 *
 * NOT wired into CI. Recording is the ONLY path that spends API budget and is
 * run locally by the owner with their own key; the replay gate is keyless.
 *
 * Safety (guards below + in the engine):
 *   - Requires ANTHROPIC_API_KEY; refuses (loud) without it.
 *   - Requires an explicit fixture selection; refuses with no args.
 *   - Refuses if FIXOR_REPLAY is set (ambiguous with record mode).
 *   - Refuses if FIXOR_ESCALATE_MEDIUM=true: idor's MEDIUM branch calls
 *     resolveMediumVerdict, which would fire a SECOND callClaude with callerId
 *     `escalation:idor-multi` - an illegal Windows fixture dir. Enforced by
 *     assertEscalationUnset inside recordFixtures().
 *   - Exits non-zero on ANY class mismatch or no-fixture-written.
 *
 * There is NO idor-specific opt-in env var (no analog to
 * FIXOR_ADMIN_CHECK_LLM_OPT_IN), so no second detector-specific assertion exists
 * or is needed.
 *
 * Usage (from repo root, after build):
 *   ANTHROPIC_API_KEY=... node dist/test/record-idor-fixtures.js all
 * Named selectors work too, e.g. `idor/negative/03` `idor-multi/A`.
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
import { idorReplaySpec } from "./specs/idor.replay-spec";

recordFixtures(idorReplaySpec, process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
