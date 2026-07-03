/**
 * IDOR detector stability harness.
 *
 * Run via: npm run test:idor
 *
 * Uses the shared stability-harness lib. See docs/detector-test-rules.md.
 *
 * NOTE: IDOR fixture set as of audit day 1 contains heavy leakage on
 * 7 of 8 negatives. Surgery scheduled for Day 3. Stability numbers
 * collected before surgery are not load-bearing.
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
    positivesMinPassing: 6,
    negativesMinPassing: 6,
    combinedMinPassing: 12,
    systemPromptFingerprint: SYSTEM_PROMPT_FINGERPRINT,
  });

  process.stdout.write(`\n${report.passed ? "PASS" : "FAIL"}.\n`);
  if (!report.passed) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
