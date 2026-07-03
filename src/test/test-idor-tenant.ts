/**
 * IDOR tenant-scoping stability harness (H5, Phase H Tier 1).
 *
 * Measures whether the shipping IDOR detector handles TENANT-scoping
 * (orgId / tenantId across users) — distinct from the object-ownership
 * (userId) IDOR it already claims. Corpus: fixtures/idor-tenant/
 * (3 positives = unscoped cross-tenant reads, 3 negatives = correctly
 * scoped via query-filter / membership-table / post-fetch guard). See
 * fixtures/idor-tenant/META.md for the per-fixture expected verdicts and
 * the in-scope/out-of-scope boundary.
 *
 * Coverage-gated: the shared harness fails on any LLM error
 * (totalLlmErrors !== 0), so a degraded run cannot be read as a result.
 *
 * COST: 6 fixtures x n=5 = ~30 Sonnet 4.6 calls ~= $0.30 per run (all 6
 * fixtures clear the prefilter and reach the LLM — verified zero-API in
 * Phase 1). Not in test:ci (it spends). Run: npm run test:idor-tenant
 * (needs ANTHROPIC_API_KEY).
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
    detectorName: "IDOR-tenant",
    fixturesDir: "fixtures/idor-tenant",
    detector: detector as Parameters<typeof runStabilityHarness>[0]["detector"],
    nRuns: 5,
    perPositiveThreshold: 4, // >=4/5 flag
    perNegativeThreshold: 5, // 5/5 clear (zero FP tolerance)
    positivesMinPassing: 3, // all 3 positives
    negativesMinPassing: 3, // all 3 negatives
    combinedMinPassing: 6,
    systemPromptFingerprint: SYSTEM_PROMPT_FINGERPRINT,
  });

  process.stdout.write(`\n${report.passed ? "PASS" : "FAIL"}.\n`);
  if (!report.passed) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
