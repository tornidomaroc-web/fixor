/**
 * Offline tests for cost calculation.
 *
 * Phase 5A-4 moved the ledger from a JSON file to Postgres, so the
 * recordCost / getDailySpend / getMonthlySpend / checkBudget tests are
 * now integration tests that need DATABASE_URL. They will be re-added
 * in 5A-9 (Anthropic retry tests) alongside a proper test-DB harness.
 *
 * What this file still covers: the pure pricing math in
 * `cost-tracking.service.ts`. That function has no I/O and stays unit-
 * testable.
 *
 * What's no longer covered automatically: budget cap behaviour and
 * ledger writes. Verify those manually after deploy via
 *   - npm run db:studio   (inspect cost_ledger)
 *   - or a forced over-cap installation in production
 */

import { calculateCost, MODEL_PRICING } from "../services/cost-tracking.service";
import { defaultBudgetCaps } from "../services/cost-store";

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    failures++;
  }
}
function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

function run(): void {
  // calculateCost — base input rate
  assert(
    approx(
      calculateCost({
        model: "claude-sonnet-4-6",
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
      MODEL_PRICING["claude-sonnet-4-6"].input,
    ),
    "Sonnet 1M input tokens = $3",
  );

  // calculateCost — output rate
  assert(
    approx(
      calculateCost({
        model: "claude-opus-4-7",
        inputTokens: 0,
        outputTokens: 1_000_000,
      }),
      MODEL_PRICING["claude-opus-4-7"].output,
    ),
    "Opus 1M output tokens = $75",
  );

  // calculateCost — cache read at 10%
  assert(
    approx(
      calculateCost({
        model: "claude-sonnet-4-6",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 1_000_000,
      }),
      MODEL_PRICING["claude-sonnet-4-6"].input * 0.10,
    ),
    "Cache read priced at 10% of input rate",
  );

  // calculateCost — cache write at 125%
  assert(
    approx(
      calculateCost({
        model: "claude-sonnet-4-6",
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 1_000_000,
      }),
      MODEL_PRICING["claude-sonnet-4-6"].input * 1.25,
    ),
    "Cache write priced at 125% of input rate",
  );

  // defaultBudgetCaps — env reading (no DB touched)
  process.env.FIXOR_MONTHLY_CAP_USD = "5";
  process.env.FIXOR_DAILY_CAP_USD = "2";
  const caps = defaultBudgetCaps();
  assert(caps.monthlyCapUsd === 5, "monthly cap from env = 5");
  assert(caps.dailyCapUsd === 2, "daily cap from env = 2");

  if (failures === 0) {
    console.log("[PASS] cost-tracking unit tests");
  } else {
    console.error(`[FAIL] ${failures} cost-tracking unit test(s) failed`);
    process.exit(1);
  }
}

run();
