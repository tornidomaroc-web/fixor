/**
 * Unit tests for the pure functions in scan-limit-warning.ts (5E-5).
 *
 * The DB-backed claim/send path (maybeSendLimitWarningEmail,
 * triggerLimitWarningEmailIfNeeded) requires Postgres + Resend and
 * lives outside this suite.
 */
import {
  computeBudgetWarning,
  sameUtcYearMonth,
  startOfNextMonthIso,
  TIER_UPSELL,
  utcYearMonth,
} from "../services/scan-limit-warning";

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    failures++;
  }
}

function run(): void {
  // -- computeBudgetWarning: below threshold ------------------------
  {
    assert(
      computeBudgetWarning(0, 5) === null,
      "$0 spend → no warning",
    );
    assert(
      computeBudgetWarning(3.99, 5) === null,
      "spend=$3.99 of $5 (79.8%) → below threshold",
    );
  }

  // -- computeBudgetWarning: in warning band ------------------------
  {
    const w = computeBudgetWarning(4.0, 5);
    assert(w !== null, "spend=$4 of $5 (80%) → warn");
    assert(w?.ratio === 0.8, "ratio is exactly 0.8");
    assert(w?.monthlySpend === 4, "monthlySpend echoed");
    assert(w?.monthlyCapUsd === 5, "monthlyCapUsd echoed");

    const mid = computeBudgetWarning(4.5, 5);
    assert(mid !== null, "spend=$4.50 of $5 (90%) → warn");
    assert(
      mid?.ratio === 0.9,
      `ratio for 4.50/5 expected 0.9, got ${mid?.ratio}`,
    );
  }

  // -- computeBudgetWarning: at-or-over cap is NOT a warning --------
  // The hard "budget_exceeded" surface owns that case in the
  // workflow result; computeBudgetWarning intentionally returns
  // null at-or-above 1.0 so the soft notice doesn't double up.
  {
    assert(
      computeBudgetWarning(5, 5) === null,
      "spend === cap → no soft warning (hard exceeded path owns it)",
    );
    assert(
      computeBudgetWarning(6.5, 5) === null,
      "spend > cap → no soft warning",
    );
  }

  // -- computeBudgetWarning: pathological inputs --------------------
  {
    assert(
      computeBudgetWarning(NaN, 5) === null,
      "NaN spend → null",
    );
    assert(
      computeBudgetWarning(4, 0) === null,
      "zero cap → null (no division)",
    );
    assert(
      computeBudgetWarning(4, -1) === null,
      "negative cap → null",
    );
    assert(
      computeBudgetWarning(-0.01, 5) === null,
      "negative spend → null",
    );
  }

  // -- utcYearMonth / sameUtcYearMonth ------------------------------
  {
    const jan = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
    const janLate = new Date(Date.UTC(2026, 0, 31, 23, 59, 59));
    const feb = new Date(Date.UTC(2026, 1, 1, 0, 0, 0));
    assert(utcYearMonth(jan) === "2026-01", "jan formatted as 2026-01");
    assert(
      sameUtcYearMonth(jan, janLate),
      "jan 15 and jan 31 same month",
    );
    assert(
      !sameUtcYearMonth(janLate, feb),
      "jan 31 and feb 1 different months",
    );
    // Year boundary
    const decLate = new Date(Date.UTC(2025, 11, 31, 23, 0, 0));
    const janFirst = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    assert(
      !sameUtcYearMonth(decLate, janFirst),
      "dec → jan year boundary distinguished",
    );
  }

  // -- startOfNextMonthIso ------------------------------------------
  {
    assert(
      startOfNextMonthIso(new Date(Date.UTC(2026, 0, 15))) === "2026-02-01",
      "mid-January → next reset 2026-02-01",
    );
    assert(
      startOfNextMonthIso(new Date(Date.UTC(2026, 0, 31, 23, 59))) === "2026-02-01",
      "Jan 31 23:59 UTC → next reset 2026-02-01",
    );
    assert(
      startOfNextMonthIso(new Date(Date.UTC(2026, 11, 1))) === "2027-01-01",
      "Dec 1 → next reset 2027-01-01 (year rollover)",
    );
    assert(
      startOfNextMonthIso(new Date(Date.UTC(2026, 11, 31))) === "2027-01-01",
      "Dec 31 → 2027-01-01",
    );
  }

  // -- TIER_UPSELL: no phantom Pro rung; Indie upsells to Team -------
  // Regression: the prior ladder pointed Indie at a "Pro $79" tier
  // with no Paddle checkout (absent from tiers.ts), routing a paying
  // customer to a dead end. Indie must upsell to Team, the only
  // purchasable tier above it.
  {
    assert(
      TIER_UPSELL.indie?.label === "Team",
      `indie upsell label should be Team, got ${TIER_UPSELL.indie?.label}`,
    );
    assert(
      TIER_UPSELL.indie?.priceUsd === 199,
      `indie upsell price should be 199, got ${TIER_UPSELL.indie?.priceUsd}`,
    );
    assert(
      !("pro" in TIER_UPSELL),
      "no phantom 'pro' rung should remain in TIER_UPSELL",
    );
    assert(
      TIER_UPSELL.free?.label === "Indie",
      "free still upsells to Indie",
    );
    assert(
      TIER_UPSELL.team === null,
      "team is the top tier (no upsell)",
    );
  }

  if (failures > 0) {
    console.error(`[FAIL] ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("[PASS] scan-limit-warning unit tests");
}

run();
