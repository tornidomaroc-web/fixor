/**
 * F-004 stage 2b.2 - auth-bypass expressed as a DetectorReplaySpec.
 *
 * The third detector to plug into the shared record/replay engine
 * (replay-harness.ts). Same mechanism as env-exposure and webhook-unverified;
 * the only per-detector differences are the detector chain, the fixture set,
 * and the manifest of MODEL-REACHING fixtures.
 *
 * MANIFEST = 37 MODEL-REACHING fixtures: all 22 positives + 15 of the 23
 * negatives. Eight negatives are EXCLUDED because the auth-bypass detector
 * drops them BEFORE the model (in detect(), so no verdict is ever recorded and
 * they cannot be part of a replay round-trip), exactly as webhook-unverified
 * excludes its path-filtered negative/18:
 *
 *   Zero-prefilter (prefilterRegex returns 0 hits -> analyzeFile short-circuits
 *   before callClaude):
 *     - negative/02 (also a SKIP_PATH_RE path: scripts/dev/)
 *     - negative/03, negative/08, negative/09, negative/10
 *     - negative/19 (Remix utility module outside app/routes/; isRemixRoutePath
 *       drops the REMIX_HANDLER_DEF_RE match inside the prefilter - the direct
 *       analog of webhook-unverified negative/18)
 *
 *   SKIP_PATH_RE (detect() drops on path before the prefilter even runs; these
 *   DO trigger the regex, so a naive prefilter-only count over-includes them -
 *   the reason the recordable count is 37, not 39):
 *     - negative/05 (scripts/seed/seed-uploads.js)
 *     - negative/07 (tests/conftest.py)
 *
 * LANE CONTRACT: none pre-encoded. Unlike webhook-unverified (which shipped
 * positive/10 + negatives 14/15 as designed MEDIUM/review-queue anchors), the
 * auth-bypass corpus is designed so every positive FLAGS at HIGH and every
 * model-reaching negative stays silent - its lane-boundary/deferral anchors
 * live in a SEPARATE corpus (fixtures/real-shape, exercised by
 * test-auth-bypass-lane.ts), not here. So every id defaults to the plain
 * flagged-vs-expected assertion.
 *
 * BUT the detector CAN still land a case off-class at record time in three
 * "vulnerable-but-not-flagged" ways, all observable on lastDiagnostics[0]:
 *   (1) LOW confidence           -> [] silent
 *   (2) MEDIUM/review-queue      -> [] with verdict isVulnerable:true@medium
 *   (3) H7 laneDeferral          -> [] with verdict isVulnerable:true@high
 *                                    (route-def + authPresent:"yes" +
 *                                     operationKind:"admin"; admin-check's lane)
 * Whether any recordable fixture actually lands in (2) or (3) is EMPIRICAL and
 * is a record-time product-calibration decision for the owner - NOT pre-encoded
 * here. See the RECONCILIATION HOOK below: if a case records off-class, adding a
 * single EXPECTED_LANE entry (for a MEDIUM anchor) or a per-id deferral override
 * flips that id from flaggedOutcome to the lane/deferral assertion mechanically,
 * with no structural change.
 */

import {
  AuthBypassDetector,
  SYSTEM_PROMPT_FINGERPRINT,
} from "../../analysis-engine/detectors/auth-bypass.detector";
import {
  flaggedOutcome,
  positiveNegativeLayout,
  verdictLaneOutcome,
  type DetectorReplaySpec,
  type ExpectedLane,
  type HarnessDetector,
  type OutcomeInput,
} from "../replay-harness";

const DETECTOR_ID = "auth-bypass-multi";
const SOURCE_DIR = "fixtures/auth-bypass";
const REPLAY_DIR = "fixtures/replay/auth-bypass-multi";

/**
 * Expected END-TO-END flagged outcome per model-reaching fixture, per the
 * corpus's DESIGNED intent: the 22 positives flag (real auth bypasses), the 15
 * model-reaching negatives do not. The 8 pre-model negatives are absent (see
 * the exclusion note in the header); they never reach the model so they cannot
 * record and are not part of the round-trip.
 */
const EXPECTED_FLAGGED: Record<string, boolean> = {
  // --- positives (real auth bypasses): all FLAG at HIGH ---
  "positive/01-anon-bypass-delete.ts": true,
  "positive/02-role-or-true.ts": true,
  "positive/03-jwt-verify-swallowed.ts": true,
  "positive/04-role-fallback-admin.ts": true,
  "positive/05-missing-middleware.js": true,
  "positive/06-default-user-fallback.js": true,
  "positive/07-flask-anon-skip.py": true,
  "positive/08-jwt-verify-false.py": true,
  "positive/09-go-anon-delete.go": true,
  "positive/10-rb-admin-fallback.rb": true,
  "positive/11-admin-router-mixed-guards.ts": true,
  "positive/12-app-router-with-logging-destructive.ts": true,
  "positive/13-app-router-with-route-deceptive-generic.ts": true,
  "positive/14-app-router-with-session-analytics.ts": true,
  "positive/15-app-router-with-account-api-key-no-enforce.ts": true,
  "positive/16-app-router-with-stats-api-key-no-enforce.ts": true,
  "positive/17-remix-bare-action-destructive.ts": true,
  "positive/18-remix-loader-with-logging-destructive.ts": true,
  "positive/19-remix-action-with-session-analytics.ts": true,
  "positive/20-fastapi-bare-delete-getdb.py": true,
  "positive/21-fastapi-noauth-tier-change.py": true,
  "positive/22-flask-bare-route-no-auth.py": true,
  // --- negatives (look similar, actually safe): none FLAG ---
  "negative/01-anon-public-data.ts": false,
  "negative/04-jwt-verify-rethrows.js": false,
  "negative/06-flask-anon-static.py": false,
  "negative/11-router-properly-guarded.ts": false,
  "negative/12-app-router-with-auth-wrapper.ts": false,
  "negative/13-app-router-with-session-for-auth.ts": false,
  "negative/14-app-router-bare-public-readonly.ts": false,
  "negative/15-app-router-with-account-api-key-enforces.ts": false,
  "negative/16-app-router-with-stats-api-key-enforces.ts": false,
  "negative/17-remix-loader-require-user-from-remix-auth.ts": false,
  "negative/18-remix-action-inline-session-auth.ts": false,
  "negative/20-fastapi-depends-current-user.py": false,
  "negative/21-fastapi-security-current-user.py": false,
  "negative/22-flask-login-required.py": false,
  "negative/23-flask-shorthand-login-required.py": false,
  // --- EXCLUDED (pre-model; never reach callClaude, so never record) ---
  // Zero-prefilter (prefilterRegex -> 0, analyzeFile short-circuits):
  //   negative/02-internal-dev-tool.ts   (0 hits; also SKIP_PATH_RE scripts/dev/)
  //   negative/03-defense-in-depth-role.ts
  //   negative/08-go-anon-healthcheck.go
  //   negative/09-rb-admin-migration.rb
  //   negative/10-token-public-readonly.ts
  //   negative/19-remix-loader-factory-utility-module.ts (isRemixRoutePath drop)
  // SKIP_PATH_RE at detect() (trigger the regex but dropped on path first):
  //   negative/05-default-id-in-seed.js  (scripts/seed/seed-uploads.js)
  //   negative/07-jwt-verify-false-tests.py (tests/conftest.py)
};

/**
 * RECONCILIATION HOOK (record-time calibration): declared verdict-lane per id.
 * EMPTY by design - no MEDIUM/review-queue anchor is known in this corpus yet.
 *
 * If, at record time, a fixture stably records off its designed class:
 *   - MEDIUM/review-queue positive (isVulnerable:true@medium -> []): add an
 *     entry here { isVulnerable: true, confidence: "medium" } and set its
 *     EXPECTED_FLAGGED to false. assertOutcome then routes it to the lane
 *     assertion automatically (exactly as webhook-unverified positive/10).
 *   - H7 laneDeferral (route-def + authPresent:"yes" + operationKind:"admin"
 *     -> [] at HIGH): this is NOT a verdict-confidence lane, so it needs a
 *     small deferral outcome (assert lastDiagnostics[0].laneDeferral is set)
 *     rather than an EXPECTED_LANE entry. The shared harness has no deferral
 *     factory yet; add `verdictDeferralOutcome` to replay-harness.ts (or an
 *     inline assertOutcome branch here - OutcomeInput exposes `detector`, so
 *     detector.lastDiagnostics[0].laneDeferral is readable) at that point.
 * None of this is pre-encoded: the founder decides per observed recording.
 */
const EXPECTED_LANE: Record<string, ExpectedLane> = {};

/**
 * Completeness manifest: the 37 model-reaching source fixtures that MUST each
 * have a recording. The 8 pre-model negatives are intentionally absent. The
 * expectedFlagged VALUE is read from each recording's meta at replay time; this
 * list only guarantees all 37 are present.
 */
const SOURCE_MANIFEST: readonly string[] = Object.keys(EXPECTED_FLAGGED);

// The two outcome shapes, dispatched per id: the verdict-lane assertion for ids
// with a declared lane (none yet - see the reconciliation hook), the plain
// flagged-vs-expected assertion for everything else.
const laneAssertion = verdictLaneOutcome((id) => EXPECTED_LANE[id]);
const flagAssertion = flaggedOutcome();

export const authBypassReplaySpec: DetectorReplaySpec = {
  detectorId: DETECTOR_ID,
  systemPromptFingerprint: SYSTEM_PROMPT_FINGERPRINT,
  sourceDir: SOURCE_DIR,
  replayDir: REPLAY_DIR,
  manifest: SOURCE_MANIFEST,
  layout: positiveNegativeLayout({ dir: SOURCE_DIR }), // no sidecars
  makeDetector: (): HarnessDetector => new AuthBypassDetector(),
  expectedFlagged: (id: string): boolean => {
    const v = EXPECTED_FLAGGED[id];
    if (typeof v !== "boolean") {
      throw new Error(`auth-bypass: no expectedFlagged for id ${id}`);
    }
    return v;
  },
  expectedLane: (id: string): ExpectedLane | undefined => EXPECTED_LANE[id],
  assertOutcome: (o: OutcomeInput) =>
    EXPECTED_LANE[o.id] ? laneAssertion(o) : flagAssertion(o),
};
