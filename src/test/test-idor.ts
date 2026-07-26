/**
 * IDOR detector stability harness.
 *
 * Run via: npm run test:idor
 *
 * Uses the shared stability-harness lib. See docs/detector-test-rules.md.
 *
 * DECAYED THRESHOLDS, fixed here. The gate was positivesMinPassing 6,
 * negativesMinPassing 6, combinedMinPassing 12, set in 07fe2d3 (#52) when this
 * corpus was 8 and 8. ff3c364 added a ninth positive and a ninth negative, so
 * both bars decayed to 6 of 9 (a 67 percent bar): the test could pass with
 * three positives missed AND three negatives leaking. Aggregates are now
 * corpus-relative and all-passing, matching the other five harness callers.
 *
 * THE PRE-SURGERY LEAKAGE NOTE IS REMOVED, NOT KEPT. It read "heavy leakage on
 * 7 of 8 negatives. Surgery scheduled for Day 3. Stability numbers collected
 * before surgery are not load-bearing." It describes a corpus that no longer
 * exists: the surgery landed, negatives 03/04/07 carry RLS/middleware sidecars,
 * and the reconciled sets in specs/idor.replay-spec.ts pin all 9 negatives
 * silent and all 9 positives non-empty on the frozen sample. It is removed
 * rather than retained because its last sentence licenses dismissing a red gate.
 *
 * THE NEW BAR IS UNVERIFIED AT THIS HEIGHT. Raising the aggregates is a POLICY
 * change, not a measurement. No live n=5 run of this corpus has been taken at
 * 9/9/18. The frozen replay sample is n=1 and establishes no stability.
 */

import {
  IdorDetector,
  SYSTEM_PROMPT_FINGERPRINT,
} from "../analysis-engine/detectors/idor.detector";
import { runStabilityHarness } from "./lib/stability-harness";

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stdout.write("SKIPPED: ANTHROPIC_API_KEY not set (opt-in live-LLM test). Set the key to run it live.\n");
    return;
  }
  const detector = new IdorDetector();
  const report = await runStabilityHarness({
    detectorName: "IDOR",
    fixturesDir: "fixtures/idor",
    detector: detector as Parameters<typeof runStabilityHarness>[0]["detector"],
    nRuns: 5,
    perPositiveThreshold: 4,
    perNegativeThreshold: 5,
    positivesMinPassing: 9,
    negativesMinPassing: 9,
    combinedMinPassing: 18,
    systemPromptFingerprint: SYSTEM_PROMPT_FINGERPRINT,
  });

  process.stdout.write(`\n${report.passed ? "PASS" : "FAIL"}.\n`);
  if (!report.passed) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
