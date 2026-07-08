/**
 * F-004 stage 2b.1 - webhook-unverified expressed as a DetectorReplaySpec.
 *
 * The second detector to plug into the shared record/replay engine
 * (replay-harness.ts). Same mechanism as env-exposure; the only per-detector
 * differences are the detector chain, the fixture set, and - NEW for this
 * detector - a MEDIUM/review-queue verdict-lane assertion for the two Phase F
 * locked anchors (negatives 14 and 15).
 *
 * MANIFEST = 34 MODEL-REACHING fixtures: all 17 positives + negatives 01..17.
 * negative/18 (the Remix utility-module over-match anchor) is EXCLUDED: the
 * Phase E path-aware prefilter drops it BEFORE the model, so it never records a
 * verdict and cannot be part of a replay round-trip. (Category A / location in
 * fixtures/webhook-unverified/META.md; every model-reaching fixture there is
 * Category B / context.)
 *
 * LANE CONTRACT (fixtures/webhook-unverified/META.md, Phase F locked merge gate):
 * THREE ids must land at MEDIUM/review-queue - verdict.isVulnerable === true AND
 * verdict.confidence === "medium" - NOT skip (LOW / not-vulnerable, which would
 * be a silencing regression) and NOT HIGH (which would re-create the false
 * positive). Negatives 14 and 15 are the Phase F locked anchors. positive/10
 * joins them for a DIFFERENT reason: it verifies the HMAC but compares it with a
 * non-constant-time equality (a timing side-channel the model stably rates
 * MEDIUM, unlike the no-verification positives that flag HIGH). With escalation
 * off (the record/replay mode), that MEDIUM routes to "review-queue" and the
 * detector returns [], so all three are expectedFlagged:false; the lane is
 * asserted separately on the diagnostic verdict via verdictLaneOutcome. The two
 * positive anchors (14/15) must FLAG.
 */

import {
  WebhookUnverifiedDetector,
  SYSTEM_PROMPT_FINGERPRINT,
} from "../../analysis-engine/detectors/webhook-unverified.detector";
import {
  flaggedOutcome,
  positiveNegativeLayout,
  verdictLaneOutcome,
  type DetectorReplaySpec,
  type ExpectedLane,
  type HarnessDetector,
  type OutcomeInput,
} from "../replay-harness";

const DETECTOR_ID = "webhook-unverified-multi";
const SOURCE_DIR = "fixtures/webhook-unverified";
const REPLAY_DIR = "fixtures/replay/webhook-unverified-multi";

/**
 * Expected END-TO-END flagged outcome per model-reaching fixture. Positives
 * flag (incl. the 14/15 HIGH anchors); negatives do not. Negatives 14/15 are
 * flagged:false because their MEDIUM verdict routes to review-queue (returns [])
 * with escalation off - their lane is pinned separately below.
 */
const EXPECTED_FLAGGED: Record<string, boolean> = {
  // --- positives (real vulnerabilities): all FLAG ---
  "positive/01-stripe-no-sig.ts": true,
  "positive/02-github-no-sig.ts": true,
  "positive/03-custom-no-hmac.ts": true,
  "positive/04-stripe-verify-toggle.js": true,
  "positive/05-lemon-no-sig.js": true,
  "positive/06-twilio-no-sig.js": true,
  "positive/07-flask-stripe-no-sig.py": true,
  "positive/08-flask-github-no-sig.py": true,
  "positive/09-go-stripe-no-hmac.go": true,
  // MEDIUM/review-queue -> [] (verifies HMAC but non-constant-time compare;
  // lane pinned in EXPECTED_LANE below), so flagged:false is its correct class.
  "positive/10-go-github-eq-compare.go": false,
  "positive/11-app-router-stripe-no-sig.ts": true,
  "positive/12-app-router-lemon-diy-hmac-stub.ts": true,
  "positive/13-app-router-custom-url-sig-header-no-verify.ts": true,
  "positive/14-app-router-apple-cross-file-no-call.ts": true, // Phase F HIGH anchor
  "positive/15-app-router-graph-clientstate-no-compare.ts": true, // Phase F HIGH anchor
  "positive/16-remix-action-stripe-no-sig.ts": true,
  "positive/17-remix-action-github-no-hmac.ts": true,
  // --- negatives (look similar, actually safe): none FLAG ---
  "negative/01-stripe-construct-event.ts": false,
  "negative/02-github-timing-safe-equal.ts": false,
  "negative/03-custom-strict-hmac.ts": false,
  "negative/04-stripe-verify-middleware.js": false,
  "negative/05-github-octokit-webhooks.js": false,
  "negative/06-twilio-validate-request.js": false,
  "negative/07-flask-stripe-construct-event.py": false,
  "negative/08-flask-github-compare-digest.py": false,
  "negative/09-go-subtle-constant-time.go": false,
  "negative/10-go-slack-hmac-equal.go": false,
  "negative/11-app-router-cache-key-hashing.ts": false,
  "negative/12-app-router-stripe-construct-event-proper.ts": false,
  "negative/13-app-router-content-addressed-storage.ts": false,
  "negative/14-app-router-apple-cross-file-verifier-helper.ts": false, // MEDIUM/review-queue -> []
  "negative/15-app-router-graph-clientstate-challenge.ts": false, // MEDIUM/review-queue -> []
  "negative/16-remix-action-stripe-construct-event.ts": false,
  "negative/17-remix-action-github-timing-safe-equal.ts": false,
};

/**
 * MEDIUM/review-queue lane anchors: these ids must record a MEDIUM verdict
 * (isVulnerable:true, confidence:"medium") - the review-queue lane - not LOW and
 * not HIGH. Read by BOTH the record-time lane check and replay-time
 * verdictLaneOutcome, so the two gates share one source of truth. Negatives
 * 14/15 are the Phase F locked anchors; positive/10 joins them (see its note).
 */
const EXPECTED_LANE: Record<string, ExpectedLane> = {
  // Filed under positive/ but its recorded verdict is MEDIUM, not HIGH: unlike
  // the no-verification positives, 10-go-github-eq-compare.go DOES verify the
  // HMAC and only compares it with a non-constant-time `!=` (a timing side-
  // channel), which the model stably rates MEDIUM -> review-queue -> [] (never
  // HIGH). So it is pinned to the review-queue lane, same contract as 14/15,
  // rather than expected to flag.
  "positive/10-go-github-eq-compare.go": {
    isVulnerable: true,
    confidence: "medium",
  },
  "negative/14-app-router-apple-cross-file-verifier-helper.ts": {
    isVulnerable: true,
    confidence: "medium",
  },
  "negative/15-app-router-graph-clientstate-challenge.ts": {
    isVulnerable: true,
    confidence: "medium",
  },
};

/**
 * Completeness manifest: the 34 model-reaching source fixtures that MUST each
 * have a recording. negative/18 is intentionally absent (path-filtered before
 * the model). The expectedFlagged VALUE is read from each recording's meta at
 * replay time; this list only guarantees all 34 are present.
 */
const SOURCE_MANIFEST: readonly string[] = Object.keys(EXPECTED_FLAGGED);

// The two outcome shapes, dispatched per id: the MEDIUM/review-queue lane
// assertion for ids with a declared lane (negatives 14/15), the plain
// flagged-vs-expected assertion for everything else.
const laneAssertion = verdictLaneOutcome((id) => EXPECTED_LANE[id]);
const flagAssertion = flaggedOutcome();

export const webhookUnverifiedReplaySpec: DetectorReplaySpec = {
  detectorId: DETECTOR_ID,
  systemPromptFingerprint: SYSTEM_PROMPT_FINGERPRINT,
  sourceDir: SOURCE_DIR,
  replayDir: REPLAY_DIR,
  manifest: SOURCE_MANIFEST,
  layout: positiveNegativeLayout({ dir: SOURCE_DIR }), // no sidecars
  makeDetector: (): HarnessDetector => new WebhookUnverifiedDetector(),
  expectedFlagged: (id: string): boolean => {
    const v = EXPECTED_FLAGGED[id];
    if (typeof v !== "boolean") {
      throw new Error(`webhook-unverified: no expectedFlagged for id ${id}`);
    }
    return v;
  },
  expectedLane: (id: string): ExpectedLane | undefined => EXPECTED_LANE[id],
  assertOutcome: (o: OutcomeInput) =>
    EXPECTED_LANE[o.id] ? laneAssertion(o) : flagAssertion(o),
};
