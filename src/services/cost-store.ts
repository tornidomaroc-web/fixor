/**
 * File-backed cost ledger keyed by GitHub installation id.
 *
 * Same persistence pattern as fixor-pilot-store: synchronous reads/
 * writes, single-writer assumption (one Railway process). Will move to
 * Postgres in a follow-up phase. Keep the API surface intentionally
 * small so the swap is mechanical.
 */

import * as fs from "fs";
import * as path from "path";

interface InstallationCosts {
  /** "YYYY-MM-DD" -> USD spend that day. */
  daily: Record<string, number>;
  /** "YYYY-MM" -> USD spend that month. */
  monthly: Record<string, number>;
  /** Lifetime USD spend. */
  totalEver: number;
}

interface CostLedger {
  installations: Record<string, InstallationCosts>;
}

const DEFAULT_LEDGER_PATH = "./data/fixor-cost-ledger.json";

function ledgerPath(): string {
  return process.env.FIXOR_COST_LEDGER_PATH?.trim() || DEFAULT_LEDGER_PATH;
}

function readLedger(): CostLedger {
  const p = ledgerPath();
  if (!fs.existsSync(p)) return { installations: {} };
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as CostLedger;
  } catch {
    // Corrupt file: start over rather than crash. The ledger is an
    // operational ledger, not a source of truth - losing it costs us
    // visibility, not money.
    console.error(`[CostStore] Corrupt ledger at ${p}; starting fresh.`);
    return { installations: {} };
  }
}

function writeLedger(ledger: CostLedger): void {
  const p = ledgerPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(ledger, null, 2));
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function thisMonthKey(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

/** Adds `costUsd` to today's + this month's + lifetime totals. */
export function recordCost(
  installationId: number | string,
  costUsd: number
): void {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;

  const ledger = readLedger();
  const id = String(installationId);
  const day = todayKey();
  const month = thisMonthKey();

  const inst: InstallationCosts = ledger.installations[id] ?? {
    daily: {},
    monthly: {},
    totalEver: 0,
  };
  inst.daily[day] = (inst.daily[day] ?? 0) + costUsd;
  inst.monthly[month] = (inst.monthly[month] ?? 0) + costUsd;
  inst.totalEver += costUsd;
  ledger.installations[id] = inst;

  writeLedger(ledger);
}

export function getMonthlySpend(installationId: number | string): number {
  const ledger = readLedger();
  return ledger.installations[String(installationId)]?.monthly?.[thisMonthKey()] ?? 0;
}

export function getDailySpend(installationId: number | string): number {
  const ledger = readLedger();
  return ledger.installations[String(installationId)]?.daily?.[todayKey()] ?? 0;
}

export interface BudgetCaps {
  monthlyCapUsd: number;
  dailyCapUsd: number;
}

export function defaultBudgetCaps(): BudgetCaps {
  const monthlyCapUsd = Number.parseFloat(
    process.env.FIXOR_MONTHLY_CAP_USD ?? "5"
  );
  const dailyCapUsd = Number.parseFloat(
    process.env.FIXOR_DAILY_CAP_USD ?? "2"
  );
  return {
    monthlyCapUsd: Number.isFinite(monthlyCapUsd) ? monthlyCapUsd : 5,
    dailyCapUsd: Number.isFinite(dailyCapUsd) ? dailyCapUsd : 2,
  };
}

export interface BudgetCheck {
  withinBudget: boolean;
  reason?: "monthly_exceeded" | "daily_exceeded" | "exempt";
  monthlySpend: number;
  dailySpend: number;
  caps: BudgetCaps;
}

function isExempt(installationId: number | string): boolean {
  const raw = process.env.FIXOR_BUDGET_EXEMPT_INSTALLATIONS ?? "";
  if (!raw.trim()) return false;
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(String(installationId));
}

/** Pre-flight check before starting an LLM-spending workflow. */
export function checkBudget(
  installationId: number | string,
  caps: BudgetCaps = defaultBudgetCaps()
): BudgetCheck {
  const monthlySpend = getMonthlySpend(installationId);
  const dailySpend = getDailySpend(installationId);

  if (isExempt(installationId)) {
    return { withinBudget: true, reason: "exempt", monthlySpend, dailySpend, caps };
  }
  if (monthlySpend >= caps.monthlyCapUsd) {
    return { withinBudget: false, reason: "monthly_exceeded", monthlySpend, dailySpend, caps };
  }
  if (dailySpend >= caps.dailyCapUsd) {
    return { withinBudget: false, reason: "daily_exceeded", monthlySpend, dailySpend, caps };
  }
  return { withinBudget: true, monthlySpend, dailySpend, caps };
}
