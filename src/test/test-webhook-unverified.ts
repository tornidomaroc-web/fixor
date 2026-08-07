/**
 * Webhook-unverified detector stability harness.
 *
 * Run via: npm run test:webhook-unverified  (opt-in live LLM; spends only when run)
 *
 * Uses the shared stability-harness lib. See docs/detector-test-rules.md.
 *
 * F-004 stage 3 step 1: this test previously called detect() ONCE per fixture
 * and gated on absolute thresholds. Two problems, both fixed here.
 *
 * 1. NO REPEATED SAMPLING. A single LLM sample is not a verdict (the F-008
 *    lesson, and a standing convention in the tracker's `How we work`). Under
 *    workflow_dispatch a single-shot live run would look green while proving
 *    nothing about stability. It now samples n=5 per fixture.
 * 2. DECAYED THRESHOLDS. The old gate was POSITIVES_MIN 7, NEGATIVES_MIN 9,
 *    COMBINED_MIN 16, calibrated when this corpus was 10 and 10. It is now 17
 *    positives and 18 negatives, so "7 positives" had decayed to a 41 percent
 *    bar. The old header still described "all 20 fixtures". Aggregates are now
 *    corpus-relative and all-passing.
 *
 * Thresholds: positives flagged >= 4/5 runs, negatives correctly skipped 5/5
 * (zero false-positive tolerance; false positives are what made F-001
 * ship-blocking). Aggregate: every fixture must clear its per-fixture bar.
 *
 * KNOWN TENSION worth watching on the first live run: this detector owns the
 * MEDIUM lane anchors (negatives 14 and 15), which the replay spec pins via a
 * verdict-lane assertion. The stability harness has no lane concept, so this
 * gate does NOT protect the lane contract; `test:replay-webhook-unverified`
 * does. Do not read a green run here as lane coverage.
 *
 * UPDATED 2026-08-07. The old wording said a negative landing MEDIUM "is
 * routed to review-queue" and "counts here as correctly-skipped". Both halves
 * are now wrong. A MEDIUM EMITS, so 14/15 produce findings; and negatives are
 * scored on ASSERTION, not emission, so they count clean only because they are
 * the two DECLARED exceptions. An UNDECLARED negative that asserts vulnerable
 * now fails whether or not it emits - which is the whole point of the
 * assertion-based scorer.
 *
 * SCOPE: this is a detection-quality gate, the only kind in this repo. It is
 * the opposite of the deterministic replay and prefilter gates, which verify
 * wiring and parsing and explicitly do NOT verify model judgment.
 */

import {
  WebhookUnverifiedDetector,
  SYSTEM_PROMPT_FINGERPRINT,
} from "../analysis-engine/detectors/webhook-unverified.detector";
import { runStabilityHarness } from "./lib/stability-harness";

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stdout.write(
      "SKIPPED: ANTHROPIC_API_KEY not set (opt-in live-LLM test). Set the key to run it live.\n",
    );
    return;
  }

  const detector = new WebhookUnverifiedDetector();
  const report = await runStabilityHarness({
    detectorName: "webhook-unverified",
    fixturesDir: "fixtures/webhook-unverified",
    detector: detector as Parameters<typeof runStabilityHarness>[0]["detector"],
    nRuns: 5,
    perPositiveThreshold: 4,
    perNegativeThreshold: 5,
    // The ONLY two declared exceptions in the repo, and both are evidenced.
    // fixtures/webhook-unverified/META.md step 3 specifies these negatives land
    // at MEDIUM with isVulnerable true, and docs/detector-capabilities.md gives
    // the reason: class (c)'s verifier implementation and class (d)'s env value
    // both live cross-file and cannot be confirmed from the scanned file, so
    // MEDIUM is the CORRECT epistemic state rather than an error. The recorded
    // corpus confirms both against the shipping prompt fingerprint
    // (test:recorded-medium-census). Every other negative in this repo stays at
    // the default: the model must not assert isVulnerable at all.
    negativeExpectations: {
      "14-app-router-apple-cross-file-verifier-helper.ts": ["vuln/medium"],
      "15-app-router-graph-clientstate-challenge.ts": ["vuln/medium"],
    },
    positivesMinPassing: 17,
    negativesMinPassing: 18,
    combinedMinPassing: 35,
    costPerLlmCallUsd: 0.00828,
    systemPromptFingerprint: SYSTEM_PROMPT_FINGERPRINT,
  });

  process.stdout.write(`\n${report.passed ? "PASS" : "FAIL"}.\n`);
  if (!report.passed) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
