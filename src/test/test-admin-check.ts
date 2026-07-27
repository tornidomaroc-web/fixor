/**
 * Admin-check detector stability harness.
 *
 * Run via: npm run test:admin-check  (opt-in live LLM; spends only when run)
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
 * 2. DECAYED THRESHOLDS. The old gate was POSITIVES_MIN 11, NEGATIVES_MIN 11,
 *    COMBINED_MIN 22, calibrated against a smaller corpus. The corpus is now
 *    24 positives and 21 negatives, so "11 positives" had decayed to a 52
 *    percent bar. Aggregates are now corpus-relative and all-passing.
 *    Kept corpus-relative since: the three positives added for prefilter
 *    coverage (22, 23, 24) moved the bar to 24/21/45 in the same commit,
 *    because landing them without the bump would have re-decayed positives
 *    to 21-of-24 and reintroduced exactly the defect this note describes.
 *
 * Thresholds: positives flagged >= 4/5 runs, negatives correctly skipped 5/5
 * (zero false-positive tolerance; false positives are what made F-001
 * ship-blocking). Aggregate: every fixture must clear its per-fixture bar.
 *
 * NOTE on cost shape: 15 of this corpus's 45 fixtures terminate BEFORE the
 * model (3 pre-model drops and 12 Option G literal-tier bypasses, measured in
 * F-004 sub-step 2b.3). Those cost nothing here and are covered for free by
 * `test:admin-check-prefilter`. Only the 30 model-reaching fixtures spend —
 * unchanged by positives 22-24, which are all Option G bypasses, so this
 * corpus grew by three fixtures at no additional cost per run.
 *
 * SCOPE: this is a detection-quality gate, the only kind in this repo. It is
 * the opposite of the deterministic replay and prefilter gates, which verify
 * wiring and parsing and explicitly do NOT verify model judgment.
 */

import {
  AdminCheckDetector,
  SYSTEM_PROMPT_FINGERPRINT,
} from "../analysis-engine/detectors/admin-check.detector";
import { runStabilityHarness } from "./lib/stability-harness";

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stdout.write(
      "SKIPPED: ANTHROPIC_API_KEY not set (opt-in live-LLM test). Set the key to run it live.\n",
    );
    return;
  }

  const detector = new AdminCheckDetector();
  const report = await runStabilityHarness({
    detectorName: "admin-check",
    fixturesDir: "fixtures/admin-check",
    detector: detector as Parameters<typeof runStabilityHarness>[0]["detector"],
    nRuns: 5,
    perPositiveThreshold: 4,
    perNegativeThreshold: 5,
    positivesMinPassing: 24,
    negativesMinPassing: 21,
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
