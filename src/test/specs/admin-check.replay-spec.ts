/**
 * F-004 stage 2b.3 - admin-check expressed as a DetectorReplaySpec.
 *
 * The fourth detector to plug into the shared record/replay engine
 * (replay-harness.ts). Same mechanism as env-exposure, webhook-unverified, and
 * auth-bypass; the per-detector differences are the detector chain, the fixture
 * set, and the manifest of MODEL-REACHING fixtures.
 *
 * admin-check is the first MIXED detector: unlike the previous three, part of
 * its shipped behavior never reaches the model at all. Measured over the whole
 * 45-file corpus by driving the real detector keylessly (FIXOR_REPLAY=1 against
 * an empty fixture root, so any callClaude throws ReplayFixtureMissing before a
 * client is constructed), every fixture takes exactly one terminal path:
 *
 *   (a)  3 negatives dropped pre-model by a detect() gate or a zero-trigger
 *        prefilter                                     -> not recordable
 *   (b) 12 positives decided by the Option G per-pattern bypass: the first
 *        trigger is a literal-tier pattern with a hand-authored explanation, so
 *        the finding is emitted from the regex match and callClaude is NEVER
 *        invoked                                       -> not recordable
 *   (c) 30 fixtures reach callClaude (judgment tier)   -> RECORDABLE, this spec
 *
 * The corpus grew from 42 to 45 when positives 22-24 were added for prefilter
 * coverage. All three land in bucket (b), so bucket (c) and therefore this
 * MANIFEST are UNCHANGED at 30. No recording was added, moved or re-recorded.
 *
 * MANIFEST = the 30 bucket-(c) ids: 12 positives + 18 negatives.
 *
 * WHY BUCKET (b) CANNOT LIVE IN THIS MANIFEST:
 * A replay fixture is a recorded RESPONSE keyed by a hash of the REQUEST. Bucket
 * (b) issues no callClaude request at all, so there is no key to record under and
 * nothing to replay. `runReplayGate` asserts recordings cover the manifest
 * EXACTLY (both `missing` and `extra` fail), so listing a bucket-(b) id here
 * would fail forever as `missing`. Buckets (a) and (b) are instead guarded, for
 * free, by `test:admin-check-prefilter` (src/test/test-admin-check-prefilter.ts,
 * merged in PR #90), which pins the emitted ruleId per fixture. The two gates are
 * complementary and deliberately separate: this one dies when the prompt moves,
 * that one dies when the regex bypass moves.
 *
 * WHY THE MANIFEST CANNOT BE RE-DERIVED BY GREPPING (the load-bearing subtlety):
 * Bucket membership is decided by `triggers[0]`'s TIER, and `prefilterRegex`
 * keeps the EARLIEST match by character index (`m.index`) across all patterns,
 * returning at most one hit. So membership depends on WHERE a pattern matches in
 * the file, not on WHICH patterns the file contains. A file holding a literal-tier
 * pattern still reaches the model whenever a judgment-tier pattern matches earlier.
 * This already happens in this corpus:
 *   - positive/06-client-supplied-role.js is NAMED for the literal-tier
 *     `body_role_check`, yet it lands in bucket (c) because `express_route_def`
 *     matches earlier in the file. It is in this manifest, not the prefilter gate.
 *   - positive/08-flask-endswith-domain.py fires the generic `email_endswith_at`,
 *     not the Python-specific `py_email_endswith_at`.
 * Anyone regenerating this manifest by searching for pattern names WILL get it
 * wrong. Re-derive it by executing the detector, as above.
 *
 * SIDECARS - A DELIBERATE FREEZE OF THE UN-GUARDED BRANCH:
 * 26 of the 30 recordable fixtures fire a route-def trigger, and on a route-def
 * trigger admin-check reads the `route-guard` sidecar
 * (`sidecars?.[SIDECAR_KINDS.ROUTE_GUARD]`). `fixtures/admin-check/` contains NO
 * sidecar files, so this spec uses `positiveNegativeLayout` with NO `loadSidecars`
 * hook and every one of those 26 records with `routeGuard === undefined`. That is
 * deterministic and reproducible, but it FREEZES ONLY THE UN-GUARDED BRANCH: the
 * cross-file parent-layout admin-guard path (F-001) is NOT exercised here. That
 * path has its own corpus, `fixtures/f001-layout-guard/`, exercised by
 * `test:route-guard-webhook` and `test:f001-parity`, and is out of scope for 2b.3.
 * Adding guarded-route sidecar coverage to admin-check is separate, later work;
 * it would move the request and require re-recording these 26 fixtures.
 *
 * LANE CONTRACT: none pre-encoded. Every positive is expected to FLAG and every
 * model-reaching negative to stay silent, so every id defaults to
 * `flaggedOutcome`. admin-check has TWO not-flagged-but-vulnerable lanes on the
 * model path - LOW confidence (silent) and MEDIUM (routed through
 * `resolveMediumVerdict`, which returns "review-queue" and stays silent while
 * FIXOR_ESCALATE_MEDIUM is unset). Whether any fixture lands in one is EMPIRICAL
 * and is a record-time calibration decision for the owner, NOT pre-encoded here.
 *
 * OPEN FOUNDER QUESTION (H7), to be answered from recorded evidence, not guessed:
 * auth-bypass DEFERS to admin-check on a route-def trigger when its verdict has
 * authPresent === "yes" && operationKind === "admin", logging
 * "missing admin gate is admin-check's lane" and emitting nothing. admin-check is
 * therefore the RECEIVING side of that lane, but carries no `laneDeferral` field
 * of its own and nothing asserts it actually catches those cases. If admin-check
 * records LOW or MEDIUM/review-queue on such a route, BOTH detectors go silent and
 * the finding is lost. The 26 route-def fixtures here are exactly where that can
 * happen. Do not assume EXPECTED_LANE will stay empty; decide it from the
 * recordings.
 */

import {
  AdminCheckDetector,
  SYSTEM_PROMPT_FINGERPRINT,
} from "../../analysis-engine/detectors/admin-check.detector";
import {
  flaggedOutcome,
  positiveNegativeLayout,
  verdictLaneOutcome,
  type DetectorReplaySpec,
  type ExpectedLane,
  type HarnessDetector,
  type OutcomeInput,
} from "../replay-harness";

// The detector's own callerId, which becomes the replay fixture DIRECTORY name.
// It must contain no colon: a colon is an illegal Windows path segment (the same
// footgun assertEscalationUnset guards, where the escalation callerId is
// `escalation:admin-check-multi`). Verified: "admin-check-multi" is colon-free.
const DETECTOR_ID = "admin-check-multi";
const SOURCE_DIR = "fixtures/admin-check";
const REPLAY_DIR = "fixtures/replay/admin-check-multi";

/**
 * Expected END-TO-END flagged outcome per model-reaching fixture, per the
 * corpus's DESIGNED intent: the 12 recordable positives flag (real missing
 * admin gates), the 18 model-reaching negatives do not. The 15 pre-model
 * fixtures are absent (see the exclusion block below); they never reach the
 * model so they cannot record and are not part of the round-trip.
 */
const EXPECTED_FLAGGED: Record<string, boolean> = {
  // --- positives (real missing admin gates): all expected to FLAG ---
  // positive/06 is a route-def trigger despite its literal-tier name; see the
  // earliest-match note in the header.
  "positive/06-client-supplied-role.js": true,
  "positive/11-missing-admin-gate-role-change.ts": true,
  "positive/12-app-router-bare-role-change.ts": true,
  "positive/13-app-router-with-auth-only-admin-action.ts": true,
  "positive/14-app-router-with-route-on-admin-action.ts": true,
  "positive/15-app-router-with-auth-plus-non-admin-helper.ts": true,
  "positive/16-remix-action-with-auth-only-admin-op.ts": true,
  "positive/17-remix-loader-admin-data-no-gate.ts": true,
  "positive/18-remix-action-with-logging-admin-delete.ts": true,
  "positive/19-fastapi-auth-only-admin-delete.py": true,
  "positive/20-fastapi-admin-stats-no-gate.py": true,
  "positive/21-flask-login-only-admin-op.py": true,
  // --- negatives (look similar, actually admin-gated or non-admin): none FLAG ---
  // negatives 01, 02, 04, 10 trigger `role_string_compare` (judgment tier, no
  // sidecar read); the other 14 are route-def triggers.
  "negative/01-db-role-lookup.ts": false,
  "negative/02-org-membership-rbac.ts": false,
  "negative/04-jwt-claims-server-issued.ts": false,
  "negative/05-db-role-on-delete.js": false,
  "negative/06-claims-middleware.js": false,
  "negative/08-flask-db-role.py": false,
  "negative/09-fastapi-rbac-dep.py": false,
  "negative/10-go-rbac-from-db.go": false,
  "negative/11-router-properly-admin-gated.ts": false,
  "negative/12-app-router-with-admin-wrapper.ts": false,
  "negative/13-app-router-with-auth-plus-inline-role-check.ts": false,
  "negative/14-app-router-bare-non-admin-read.ts": false,
  "negative/15-app-router-with-auth-plus-helper-admin-check.ts": false,
  "negative/16-remix-action-with-admin-wrapper.ts": false,
  "negative/17-remix-loader-db-role-check.ts": false,
  "negative/19-fastapi-require-admin.py": false,
  "negative/20-fastapi-superuser-inline.py": false,
  "negative/21-flask-admin-required.py": false,

  // ======================================================================
  // EXCLUDED (pre-model; never reach callClaude, so never record).
  // All 15 are guarded for free by `test:admin-check-prefilter` instead.
  // ======================================================================
  //
  // Bucket (b) - Option G deterministic bypass. The first trigger is a
  // literal-tier pattern with a hand-authored explanation, so analyzeFile emits
  // the finding straight from the regex match and returns before callClaude.
  // Listed with the patternId that actually fires (pinned by the prefilter gate):
  //   positive/01-hardcoded-admin-email.ts     admin_email_const
  //   positive/02-endswith-company-domain.ts   email_endswith_at
  //   positive/03-email-includes-admin.ts      email_includes_admin
  //   positive/04-default-admin-id-fallback.ts default_admin_id
  //   positive/05-admin-emails-array.js        admin_emails_array
  //   positive/07-default-admin-id-helper.js   default_admin_id
  //   positive/08-flask-endswith-domain.py     email_endswith_at
  //                                            (NOT py_email_endswith_at: shadowed)
  //   positive/09-flask-default-admin-email.py default_admin_email
  //   positive/10-go-admin-domain-suffix.go    strings_hassuffix_email
  //   positive/22-hardcoded-admin-email-equality.js  email_eq_literal
  //   positive/23-role-nullish-fallback-admin.js     role_fallback_admin
  //   positive/24-client-supplied-role-no-route-def.js  body_role_check
  //                                            (defines no route, so
  //                                             express_route_def cannot
  //                                             pre-empt it as it does in
  //                                             positive/06)
  //
  // Bucket (a) - dropped pre-model, with the exact preFilterReason recorded:
  //   negative/03-email-match-invite-only.ts          "no regex match"
  //   negative/07-bootstrap-admins-script.js          "path filter"
  //                                            (SKIP_PATH_RE: scripts/bootstrap-admins.js)
  //   negative/18-remix-action-factory-utility-module.ts  "no regex match"
  //                                            (app/utils/*.server.ts is outside
  //                                             app/routes/, so isRemixRoutePath
  //                                             drops the REMIX_HANDLER_DEF_RE
  //                                             match inside the prefilter - the
  //                                             direct analog of auth-bypass
  //                                             negative/19)
};

/**
 * RECONCILIATION HOOK (record-time calibration): declared verdict-lane per id.
 * EMPTY by design - no MEDIUM/review-queue or LOW anchor is known in this corpus
 * yet, and none is guessed here.
 *
 * If, at record time, a fixture stably records off its designed class:
 *   - MEDIUM/review-queue positive (isVulnerable:true@medium -> []): add an entry
 *     here { isVulnerable: true, confidence: "medium" } and set its
 *     EXPECTED_FLAGGED to false. assertOutcome then routes it to the lane
 *     assertion automatically (exactly as webhook-unverified positive/10).
 *   - LOW-confidence positive (isVulnerable:true@low -> []): same shape, with
 *     confidence "low".
 *   - An H7-style deferral: admin-check has NO laneDeferral field (it is the
 *     RECEIVING side of auth-bypass's deferral, not a deferrer), so there is
 *     nothing to assert on here. If a route-def positive records silent, that is
 *     the recall hole flagged in the header, and it is a PRODUCT decision, not a
 *     test-shape decision. Escalate it; do not paper over it with an entry here.
 * None of this is pre-encoded: the founder decides per observed recording.
 */
const EXPECTED_LANE: Record<string, ExpectedLane> = {};

/**
 * Completeness manifest: the 30 model-reaching source fixtures that MUST each
 * have a recording. The 12 pre-model fixtures are intentionally absent. The
 * expectedFlagged VALUE is read from each recording's meta at replay time; this
 * list only guarantees all 30 are present.
 */
const SOURCE_MANIFEST: readonly string[] = Object.keys(EXPECTED_FLAGGED);

// The two outcome shapes, dispatched per id: the verdict-lane assertion for ids
// with a declared lane (none yet - see the reconciliation hook), the plain
// flagged-vs-expected assertion for everything else.
const laneAssertion = verdictLaneOutcome((id) => EXPECTED_LANE[id]);
const flagAssertion = flaggedOutcome();

export const adminCheckReplaySpec: DetectorReplaySpec = {
  detectorId: DETECTOR_ID,
  systemPromptFingerprint: SYSTEM_PROMPT_FINGERPRINT,
  sourceDir: SOURCE_DIR,
  replayDir: REPLAY_DIR,
  manifest: SOURCE_MANIFEST,
  layout: positiveNegativeLayout({ dir: SOURCE_DIR }), // no sidecars: see header
  makeDetector: (): HarnessDetector => new AdminCheckDetector(),
  expectedFlagged: (id: string): boolean => {
    const v = EXPECTED_FLAGGED[id];
    if (typeof v !== "boolean") {
      throw new Error(`admin-check: no expectedFlagged for id ${id}`);
    }
    return v;
  },
  expectedLane: (id: string): ExpectedLane | undefined => EXPECTED_LANE[id],
  assertOutcome: (o: OutcomeInput) =>
    EXPECTED_LANE[o.id] ? laneAssertion(o) : flagAssertion(o),
};
