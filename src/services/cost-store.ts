/**
 * Postgres-backed cost ledger keyed by GitHub installation id.
 *
 * Phase 5A-4: replaced the file-backed JSON store with Drizzle queries
 * against `cost_ledger` + `installations`. The function names and
 * semantics are unchanged from the JSON era; signatures are now async
 * because Postgres is async. Caller updates: `await recordCost(...)`,
 * `await checkBudget(...)`.
 *
 * Error policy:
 * - `recordCost` failures are caller-handled (the analysis-engine
 *   wraps it in try/catch + warn). We never silently swallow here.
 * - `checkBudget` is fail-open on DB error: a transient Postgres
 *   outage should not block legitimate scans. Failures are logged and
 *   surfaced via reason="db_unavailable" so downstream / Sentry can
 *   alert on them in 5A-6.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { costLedger, installations } from "../db/schema";
import { logger } from "../lib/logger";
import * as Sentry from "@sentry/node";

function startOfMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
function startOfDayUtc(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

async function ensureInstallation(installationId: string): Promise<void> {
  await db()
    .insert(installations)
    .values({ id: installationId })
    .onConflictDoUpdate({
      target: installations.id,
      set: { lastSeenAt: sql`now()` },
    });
}

/** Inserts one cost_ledger row. Caller is responsible for catching errors. */
export async function recordCost(
  installationId: number | string,
  costUsd: number,
): Promise<void> {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;

  const id = String(installationId);
  await ensureInstallation(id);
  await db()
    .insert(costLedger)
    .values({
      installationId: id,
      costUsd: costUsd.toString(),
    });
  logger.info(
    { installationId: id, costUsd },
    "recordCost: ledger row inserted",
  );
}

async function sumSince(
  installationId: string,
  since: Date,
): Promise<number> {
  const rows = await db()
    .select({
      total: sql<string>`coalesce(sum(${costLedger.costUsd}), 0)`,
    })
    .from(costLedger)
    .where(
      and(
        eq(costLedger.installationId, installationId),
        gte(costLedger.recordedAt, since),
      ),
    );
  const raw = rows[0]?.total ?? "0";
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

export async function getMonthlySpend(
  installationId: number | string,
): Promise<number> {
  return sumSince(String(installationId), startOfMonthUtc());
}

export async function getDailySpend(
  installationId: number | string,
): Promise<number> {
  return sumSince(String(installationId), startOfDayUtc());
}

export interface BudgetCaps {
  monthlyCapUsd: number;
  dailyCapUsd: number;
}

export function defaultBudgetCaps(): BudgetCaps {
  const monthlyCapUsd = Number.parseFloat(
    process.env.FIXOR_MONTHLY_CAP_USD ?? "5",
  );
  const dailyCapUsd = Number.parseFloat(
    process.env.FIXOR_DAILY_CAP_USD ?? "2",
  );
  return {
    monthlyCapUsd: Number.isFinite(monthlyCapUsd) ? monthlyCapUsd : 5,
    dailyCapUsd: Number.isFinite(dailyCapUsd) ? dailyCapUsd : 2,
  };
}

export interface BudgetCheck {
  withinBudget: boolean;
  reason?: "monthly_exceeded" | "daily_exceeded" | "exempt" | "db_unavailable";
  monthlySpend: number;
  dailySpend: number;
  caps: BudgetCaps;
}

function isExempt(installationId: number | string): boolean {
  const raw = process.env.FIXOR_BUDGET_EXEMPT_INSTALLATIONS ?? "";
  if (!raw.trim()) return false;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(String(installationId));
}

/**
 * Pre-flight check before starting an LLM-spending workflow.
 *
 * Fail-open semantics: on DB error, returns `withinBudget: true` with
 * `reason="db_unavailable"`. The handler treats `withinBudget=true` as
 * "proceed", so scans keep running during a Postgres outage.
 */
export async function checkBudget(
  installationId: number | string,
  caps: BudgetCaps = defaultBudgetCaps(),
): Promise<BudgetCheck> {
  const idStr = String(installationId);
  if (isExempt(installationId)) {
    const decision: BudgetCheck = {
      withinBudget: true,
      reason: "exempt",
      monthlySpend: 0,
      dailySpend: 0,
      caps,
    };
    logger.info({ installationId: idStr, decision }, "checkBudget: exempt");
    return decision;
  }

  let monthlySpend = 0;
  let dailySpend = 0;
  try {
    monthlySpend = await getMonthlySpend(installationId);
    dailySpend = await getDailySpend(installationId);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { "fixor.phase": "check_budget" },
      extra: { installationId: idStr },
    });
    logger.warn(
      { installationId: idStr, err },
      "checkBudget failed; failing open",
    );
    return {
      withinBudget: true,
      reason: "db_unavailable",
      monthlySpend: 0,
      dailySpend: 0,
      caps,
    };
  }

  if (monthlySpend >= caps.monthlyCapUsd) {
    const decision: BudgetCheck = {
      withinBudget: false,
      reason: "monthly_exceeded",
      monthlySpend,
      dailySpend,
      caps,
    };
    logger.info(
      { installationId: idStr, decision },
      "checkBudget: monthly cap exceeded",
    );
    return decision;
  }
  if (dailySpend >= caps.dailyCapUsd) {
    const decision: BudgetCheck = {
      withinBudget: false,
      reason: "daily_exceeded",
      monthlySpend,
      dailySpend,
      caps,
    };
    logger.info(
      { installationId: idStr, decision },
      "checkBudget: daily cap exceeded",
    );
    return decision;
  }
  const decision: BudgetCheck = {
    withinBudget: true,
    monthlySpend,
    dailySpend,
    caps,
  };
  logger.info(
    { installationId: idStr, decision },
    "checkBudget: within budget",
  );
  return decision;
}
