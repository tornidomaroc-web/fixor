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
 * - `recordCost` failures are caller-handled. callClaude catches one,
 *   reports it, and stops the scan's later model calls, because a call
 *   missing from this ledger is spend `checkBudget` never sees. We never
 *   silently swallow here.
 * - `checkBudget` FAILS CLOSED. When the spend or the cap cannot be read,
 *   the answer to "is this installation under its cap?" is unknown, and an
 *   unknown answer must not authorize LLM spend: it returns
 *   `withinBudget: false, reason: "budget_unverifiable"` and the caller
 *   skips the scan. This replaces a fail-open policy ("a transient Postgres
 *   outage should not block legitimate scans") under which a database
 *   outage ran every scan unpriced and uncapped on the operator's key.
 *   - Connection-class failures and the per-attempt timeout get exactly one
 *     retry after a short delay. Query, config and unknown failures are
 *     refused on the first attempt: retrying them cannot change the answer.
 *   - There is no latch. Every call re-reads, so scanning resumes on the
 *     first check after the database answers again.
 *   - Every refusal is logged at error level and sent to Sentry with its
 *     failure kind, and the PR handler posts a skipped-scan notice, so an
 *     outage is never silent.
 * - The one path that stays open when spend cannot be read is the explicit
 *   operator exemption `FIXOR_BUDGET_EXEMPT_INSTALLATIONS`, evaluated from
 *   the environment before any database access. Those installations are
 *   uncapped by the operator's choice, so an unreadable ledger bounds
 *   nothing for them.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { costLedger, installations } from "../db/schema";
import { logger } from "../lib/logger";
import * as Sentry from "@sentry/node";
import {
  provisionOrgForInstallation,
  resolveMonthlyCapForInstallation,
} from "./orgs.service";

function startOfMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
function startOfDayUtc(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

type Database = ReturnType<typeof db>;

/**
 * Upserts the `installations` row that `cost_ledger` and `scan_runs`
 * reference. Also used by the scan-run store, which inserts before any
 * ledger row exists.
 */
export async function ensureInstallation(
  installationId: string,
  database: Database = db(),
): Promise<void> {
  await database
    .insert(installations)
    .values({ id: installationId })
    .onConflictDoUpdate({
      target: installations.id,
      set: { lastSeenAt: sql`now()` },
    });
}

/** What one priced call carries into its ledger row besides the cost. */
export interface CostDetail {
  scanRunId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

/** Inserts one cost_ledger row. Caller is responsible for catching errors. */
export async function recordCost(
  installationId: number | string,
  costUsd: number,
  detail: CostDetail = {},
  database?: Database,
): Promise<void> {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;

  const id = String(installationId);
  const d = database ?? db();
  await ensureInstallation(id, d);
  await d
    .insert(costLedger)
    .values({
      installationId: id,
      scanRunId: detail.scanRunId ?? null,
      costUsd: costUsd.toString(),
      model: detail.model ?? null,
      inputTokens: detail.inputTokens ?? null,
      outputTokens: detail.outputTokens ?? null,
      cacheCreationInputTokens: detail.cacheCreationInputTokens ?? null,
      cacheReadInputTokens: detail.cacheReadInputTokens ?? null,
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

/**
 * Why a budget read failed. Diagnostic only: it decides whether one retry
 * is worth making and it tags logs and Sentry. It never reaches a user, and
 * it never changes the decision — every kind is refused.
 */
export type BudgetReadFailureKind =
  | "connection"
  | "timeout"
  | "query"
  | "config"
  | "unknown";

export interface BudgetCheck {
  withinBudget: boolean;
  reason?:
    | "monthly_exceeded"
    | "daily_exceeded"
    | "exempt"
    | "budget_unverifiable";
  monthlySpend: number;
  dailySpend: number;
  caps: BudgetCaps;
  /** Present only when `reason === "budget_unverifiable"`. */
  failure?: { kind: BudgetReadFailureKind; attempts: number };
}

/** What one budget read returns: the two spend sums and the per-org cap. */
export interface BudgetReads {
  monthlySpend: number;
  dailySpend: number;
  /**
   * `null` when no org row exists. checkBudget then provisions the org
   * (`provisionMissingOrg`) and uses its cap: the published tier's figure,
   * the schema default, never `FIXOR_MONTHLY_CAP_USD`.
   */
  orgMonthlyCapUsd: number | null;
}

/**
 * Injectable pieces of `checkBudget`. Production uses
 * {@link defaultBudgetCheckDeps}; tests replace the reader and shorten the
 * timings so the refusal paths can be witnessed without a database.
 */
export interface BudgetCheckDeps {
  readBudget: (installationId: string) => Promise<BudgetReads>;
  /**
   * Creates the org row for an installation that has none and returns its
   * monthly cap. Production: provisionOrgForInstallation, then a re-read.
   * A throw refuses the scan (budget_unverifiable), never an env fallback.
   */
  provisionMissingOrg: (installationId: string) => Promise<number>;
  /** Per-attempt ceiling on one budget read, in ms. */
  timeoutMs: number;
  /** Delay before the single retry of a transient failure, in ms. */
  retryDelayMs: number;
}

async function provisionMissingOrgInDb(installationId: string): Promise<number> {
  await provisionOrgForInstallation(installationId, "pull_request_scan");
  const cap = await resolveMonthlyCapForInstallation(installationId);
  if (cap === null) {
    throw new Error(
      `org row for installation ${installationId} still missing after provisioning`,
    );
  }
  return cap;
}

async function readBudgetFromDb(installationId: string): Promise<BudgetReads> {
  // Spend reads + per-org cap lookup are independent — issue them in
  // parallel so the DB round-trip cost is one network hop, not three.
  const [monthlySpend, dailySpend, orgMonthlyCapUsd] = await Promise.all([
    getMonthlySpend(installationId),
    getDailySpend(installationId),
    resolveMonthlyCapForInstallation(installationId),
  ]);
  return { monthlySpend, dailySpend, orgMonthlyCapUsd };
}

/**
 * The pg Pool has no connect timeout of its own, so a black-holed database
 * host would otherwise hang a budget read for minutes. Worst case before a
 * refusal: two attempts plus one retry delay, about 10.5 s.
 */
export const defaultBudgetCheckDeps: BudgetCheckDeps = {
  readBudget: readBudgetFromDb,
  provisionMissingOrg: provisionMissingOrgInDb,
  timeoutMs: 5_000,
  retryDelayMs: 500,
};

const MAX_BUDGET_READ_ATTEMPTS = 2;

class BudgetReadTimeout extends Error {
  constructor(ms: number) {
    super(`budget read timed out after ${ms} ms`);
    this.name = "BudgetReadTimeout";
  }
}

const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);
// Postgres SQLSTATEs outside class 08 that still mean "could not talk to
// the server": admin/crash shutdown, cannot connect now, too many
// connections.
const PG_CONNECTION_SQLSTATES = new Set(["57P01", "57P02", "57P03", "53300"]);
const CONNECTION_MESSAGE_RE =
  /connection terminated|timeout exceeded when trying to connect|could not connect|couldn't connect/i;

/**
 * Classify a failed budget read. Walks the `cause` chain (Drizzle wraps
 * driver errors in `DrizzleQueryError`) and the first entry of an
 * `AggregateError` (Node's multi-address connect), at most 5 levels.
 */
export function classifyBudgetReadFailure(err: unknown): BudgetReadFailureKind {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof BudgetReadTimeout) return "timeout";
    const rec = current as {
      code?: unknown;
      message?: unknown;
      severity?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    const code = typeof rec.code === "string" ? rec.code : undefined;
    const message = typeof rec.message === "string" ? rec.message : "";
    if (/DATABASE_URL is not set/.test(message)) return "config";
    if (
      code &&
      (NETWORK_ERROR_CODES.has(code) ||
        code.startsWith("08") ||
        PG_CONNECTION_SQLSTATES.has(code))
    ) {
      return "connection";
    }
    if (CONNECTION_MESSAGE_RE.test(message)) return "connection";
    // A pg DatabaseError carries a SQLSTATE `code` and a `severity`.
    if (code && typeof rec.severity === "string") return "query";
    if (Array.isArray(rec.errors) && rec.errors.length > 0) {
      current = rec.errors[0];
      continue;
    }
    current = rec.cause;
  }
  return "unknown";
}

async function readBudgetOnce(
  deps: BudgetCheckDeps,
  installationId: string,
): Promise<BudgetReads> {
  // The timer is deliberately NOT unref'd: an unref'd timer would let a
  // process whose only pending work is a hung read exit before the timeout
  // fires. It is always cleared once the race settles.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new BudgetReadTimeout(deps.timeoutMs)),
      deps.timeoutMs,
    );
  });
  try {
    return await Promise.race([deps.readBudget(installationId), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * Fail-closed semantics: when the spend or the cap cannot be read, returns
 * `withinBudget: false` with `reason="budget_unverifiable"` and the caller
 * skips the scan. See the error policy at the top of this file.
 */
export async function checkBudget(
  installationId: number | string,
  caps: BudgetCaps = defaultBudgetCaps(),
  deps: Partial<BudgetCheckDeps> = {},
): Promise<BudgetCheck> {
  const d: BudgetCheckDeps = { ...defaultBudgetCheckDeps, ...deps };
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

  let reads: BudgetReads | undefined;
  let lastErr: unknown;
  let kind: BudgetReadFailureKind = "unknown";
  let attempts = 0;
  while (attempts < MAX_BUDGET_READ_ATTEMPTS) {
    attempts++;
    try {
      reads = await readBudgetOnce(d, idStr);
      break;
    } catch (err) {
      lastErr = err;
      kind = classifyBudgetReadFailure(err);
      const transient = kind === "connection" || kind === "timeout";
      if (!transient || attempts >= MAX_BUDGET_READ_ATTEMPTS) break;
      logger.warn(
        { installationId: idStr, kind, attempt: attempts, err },
        "checkBudget: budget read failed; retrying once",
      );
      await sleep(d.retryDelayMs);
    }
  }

  if (reads === undefined) {
    Sentry.captureException(lastErr, {
      tags: { "fixor.phase": "check_budget", "fixor.budget_failure": kind },
      extra: { installationId: idStr, attempts },
    });
    const refusal: BudgetCheck = {
      withinBudget: false,
      reason: "budget_unverifiable",
      monthlySpend: 0,
      dailySpend: 0,
      caps,
      failure: { kind, attempts },
    };
    logger.error(
      { installationId: idStr, decision: refusal, err: lastErr },
      "checkBudget: budget could not be read; failing closed, scan refused",
    );
    return refusal;
  }
  if (attempts > 1) {
    logger.warn(
      { installationId: idStr, attempts },
      "checkBudget: budget read recovered on retry",
    );
  }

  const { monthlySpend, dailySpend } = reads;
  let resolvedMonthlyCap = reads.orgMonthlyCapUsd;
  if (resolvedMonthlyCap === null) {
    // No org row: the `installation` delivery was lost, or the install
    // predates provisioning. Provision it now, so the published tier's cap
    // (the schema default) governs. FIXOR_MONTHLY_CAP_USD used to govern
    // such installations, and it is not the published figure (Railway had
    // it at 3 against a published 5, tracker item 9). A provisioning
    // failure refuses the scan like any other unreadable cap.
    try {
      resolvedMonthlyCap = await d.provisionMissingOrg(idStr);
      logger.warn(
        { installationId: idStr, monthlyCapUsd: resolvedMonthlyCap },
        "checkBudget: no org row for this installation; provisioned it at the tier default cap",
      );
    } catch (err) {
      const provisionKind = classifyBudgetReadFailure(err);
      Sentry.captureException(err, {
        tags: { "fixor.phase": "check_budget", "fixor.budget_failure": provisionKind },
        extra: { installationId: idStr, step: "provision_missing_org" },
      });
      const refusal: BudgetCheck = {
        withinBudget: false,
        reason: "budget_unverifiable",
        monthlySpend,
        dailySpend,
        caps,
        failure: { kind: provisionKind, attempts },
      };
      logger.error(
        { installationId: idStr, decision: refusal, err },
        "checkBudget: no org row and provisioning failed; failing closed, scan refused",
      );
      return refusal;
    }
  }

  // The effective caps reflect what was actually applied — important
  // because the PR comment renders these (5A-10 wording). Daily cap
  // is still env-only; per-org dailies were not in scope for 5B-3.
  const effectiveCaps: BudgetCaps = {
    monthlyCapUsd: resolvedMonthlyCap,
    dailyCapUsd: caps.dailyCapUsd,
  };

  if (monthlySpend >= effectiveCaps.monthlyCapUsd) {
    const decision: BudgetCheck = {
      withinBudget: false,
      reason: "monthly_exceeded",
      monthlySpend,
      dailySpend,
      caps: effectiveCaps,
    };
    logger.info(
      { installationId: idStr, decision },
      "checkBudget: monthly cap exceeded",
    );
    return decision;
  }
  if (dailySpend >= effectiveCaps.dailyCapUsd) {
    const decision: BudgetCheck = {
      withinBudget: false,
      reason: "daily_exceeded",
      monthlySpend,
      dailySpend,
      caps: effectiveCaps,
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
    caps: effectiveCaps,
  };
  logger.info(
    { installationId: idStr, decision },
    "checkBudget: within budget",
  );
  return decision;
}

export interface BudgetRefusalHttp {
  status: 402 | 503;
  body: Record<string, unknown>;
  retryAfterSeconds?: number;
}

/**
 * HTTP response for the public scan API when `checkBudget` refuses, or
 * `null` when the scan may proceed. Kept here, not in webhook-server.ts,
 * because that module starts the server at import and cannot be tested.
 * The 402 body for an exceeded cap is unchanged from before; a budget that
 * cannot be verified is a server-side condition, so it is 503 with a
 * retry hint rather than a 402 that blames the customer's spend.
 */
export function budgetRefusalHttp(budget: BudgetCheck): BudgetRefusalHttp | null {
  if (budget.withinBudget) return null;
  if (budget.reason === "monthly_exceeded" || budget.reason === "daily_exceeded") {
    return {
      status: 402,
      body: {
        error: "monthly_budget_exceeded",
        reason: budget.reason,
        monthlySpend: budget.monthlySpend,
        dailySpend: budget.dailySpend,
        caps: budget.caps,
      },
    };
  }
  return {
    status: 503,
    body: {
      error: "budget_unverifiable",
      message:
        "Fixor could not confirm this org's usage budget, so nothing was scanned. Retry shortly.",
    },
    retryAfterSeconds: 60,
  };
}
