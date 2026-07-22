/**
 * Auth-bypass detector stability harness.
 *
 * Run via: npm run test:auth-bypass  (opt-in live LLM; spends only when run)
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
 *    COMBINED_MIN 16, calibrated when this corpus was 10 positives and 10
 *    negatives. The corpus has since grown to 22 and 23, so "7 positives" had
 *    silently decayed to a 32 percent bar: the test could pass while 15 of 22
 *    positives went missed. The old header still described "the 20 fixtures".
 *    Aggregates are now corpus-relative and all-passing.
 *
 * Thresholds: positives flagged >= 4/5 runs, negatives correctly skipped 5/5
 * (zero false-positive tolerance; false positives are what made F-001
 * ship-blocking). Aggregate: every fixture must clear its per-fixture bar.
 *
 * SCOPE: this is a detection-quality gate, the only kind in this repo. It is
 * the opposite of the deterministic replay and prefilter gates, which verify
 * wiring and parsing and explicitly do NOT verify model judgment.
 */

import {
  AuthBypassDetector,
  SYSTEM_PROMPT_FINGERPRINT,
} from "../analysis-engine/detectors/auth-bypass.detector";
import { runStabilityHarness } from "./lib/stability-harness";

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stdout.write(
      "SKIPPED: ANTHROPIC_API_KEY not set (opt-in live-LLM test). Set the key to run it live.\n",
    );
    return;
  }

  const detector = new AuthBypassDetector();
  const report = await runStabilityHarness({
    detectorName: "auth-bypass",
    fixturesDir: "fixtures/auth-bypass",
    detector: detector as Parameters<typeof runStabilityHarness>[0]["detector"],
    nRuns: 5,
    perPositiveThreshold: 4,
    perNegativeThreshold: 5,
    positivesMinPassing: 22,
    negativesMinPassing: 23,
    combinedMinPassing: 45,
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
