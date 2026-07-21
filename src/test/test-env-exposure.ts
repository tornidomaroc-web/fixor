/**
 * Env-exposure detector stability harness.
 *
 * Run via: npm run test:env-exposure  (opt-in live LLM; spends only when run)
 *
 * Uses the shared stability-harness lib. See docs/detector-test-rules.md.
 *
 * F-004 stage 3 step 1: this test previously called detect() ONCE per fixture
 * and gated on absolute thresholds. Three problems, all fixed here.
 *
 * 1. NO REPEATED SAMPLING. A single LLM sample is not a verdict (the F-008
 *    lesson, and a standing convention in the tracker's `How we work`). Under
 *    workflow_dispatch a single-shot live run would look green while proving
 *    nothing about stability. It now samples n=5 per fixture.
 * 2. DECAYED THRESHOLDS. The old gate was POSITIVES_MIN 7, NEGATIVES_MIN 9,
 *    COMBINED_MIN 16, calibrated when this corpus was 10 and 10. It is now 11
 *    positives and 9 negatives. Aggregates are corpus-relative and all-passing.
 * 3. MISREPORTED DENOMINATORS. The old summary printed a HARDCODED "/10" and
 *    "/20" while scanning the real directory, so with 11 positives it could
 *    print "Positives caught: 11/10". The harness prints real denominators.
 *
 * Thresholds: positives flagged >= 4/5 runs, negatives correctly skipped 5/5
 * (zero false-positive tolerance; false positives are what made F-001
 * ship-blocking). Aggregate: every fixture must clear its per-fixture bar.
 *
 * NOTE, and this is the strictest cell in the matrix: this corpus has only 9
 * negatives, and negativesMinPassing is all 9 at 5/5 each. A single flaky
 * false positive on any one negative fails the whole detector. That is
 * deliberate and was adopted with eyes open. If this is the first thing to
 * fail on a live run, read it as a THRESHOLD result first, not automatically
 * as a detector regression, and re-sample before concluding either way.
 *
 * SCOPE: this is a detection-quality gate, the only kind in this repo. It is
 * the opposite of the deterministic replay and prefilter gates, which verify
 * wiring and parsing and explicitly do NOT verify model judgment.
 */

import {
  EnvExposureDetector,
  SYSTEM_PROMPT_FINGERPRINT,
} from "../analysis-engine/detectors/env-exposure.detector";
import { runStabilityHarness } from "./lib/stability-harness";

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stdout.write(
      "SKIPPED: ANTHROPIC_API_KEY not set (opt-in live-LLM test). Set the key to run it live.\n",
    );
    return;
  }

  const detector = new EnvExposureDetector();
  const report = await runStabilityHarness({
    detectorName: "env-exposure",
    fixturesDir: "fixtures/env-exposure",
    detector: detector as Parameters<typeof runStabilityHarness>[0]["detector"],
    nRuns: 5,
    perPositiveThreshold: 4,
    perNegativeThreshold: 5,
    positivesMinPassing: 11,
    negativesMinPassing: 9,
    combinedMinPassing: 20,
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
