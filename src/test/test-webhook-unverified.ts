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
 * MEDIUM/review-queue lane anchors (negatives 14 and 15), which the replay
 * spec pins via a verdict-lane assertion. The stability harness classifies on
 * `flagged` alone and has no lane concept, so a negative that lands MEDIUM and
 * is routed to review-queue counts here as correctly-skipped. This gate
 * therefore does NOT protect the lane contract; `test:replay-webhook-unverified`
 * does. Do not read a green run here as lane coverage.
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
