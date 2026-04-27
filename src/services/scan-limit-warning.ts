/**
 * 80%-of-monthly-cap nudge (5E-5).
 *
 * Two surfaces share this module:
 *   1. computeBudgetWarning — pure function that decides whether
 *      a given (spend, cap) pair should trigger the soft warning,
 *      and how to label the % for UIs. Used by the PR comment
 *      and the dashboard banner via the workflow result.
 *   2. maybeSendLimitWarningEmail — DB-backed claim + Resend send,
 *      gated on calendar-month rollover so each month gets at
 *      most one nudge per org.
 *
 * Threshold is hard-coded to 80% — a single number, not an env
 * var. If we ever want it tunable per-tier, this is the only line
 * that changes.
 */
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "../db/client";
import { orgs } from "../db/schema";
import { logger } from "../lib/logger";
import { sendBillingEmail } from "./../lib/resend";

const WARNING_RATIO = 0.8;

export interface BudgetWarning {
  monthlySpend: number;
  monthlyCapUsd: number;
  /** spend / cap, clamped to [0, 1]. */
  ratio: number;
}

/**
 * Returns a BudgetWarning when the spend/cap ratio is in
 * [WARNING_RATIO, 1.0). Returns null below the threshold (no
 * nudge) and ALSO returns null at-or-above the cap (the hard
 * `budget_exceeded` path owns that surface). NaN / non-positive
 * caps return null.
 */
export function computeBudgetWarning(
  monthlySpendUsd: number,
  monthlyCapUsd: number,
): BudgetWarning | null {
  if (!Number.isFinite(monthlySpendUsd) || monthlySpendUsd < 0) return null;
  if (!Number.isFinite(monthlyCapUsd) || monthlyCapUsd <= 0) return null;
  const ratio = monthlySpendUsd / monthlyCapUsd;
  if (ratio < WARNING_RATIO) return null;
  if (ratio >= 1) return null;
  return {
    monthlySpend: monthlySpendUsd,
    monthlyCapUsd,
    ratio,
  };
}

/**
 * UTC year-month key used to compare two timestamps' calendar
 * months. Exported for tests; the email helper uses it via
 * `sameUtcYearMonth`.
 */
export function utcYearMonth(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function sameUtcYearMonth(a: Date, b: Date): boolean {
  return utcYearMonth(a) === utcYearMonth(b);
}

export interface SendLimitWarningInput {
  installationId: string;
  warning: BudgetWarning;
  /** "owner/repo" for context in the email body — references the
   *  scan that JUST tripped the threshold. */
  repoFullName: string;
  pullNumber: number;
  /** Absolute URL to the dashboard's billing page for this org.
   *  Built by the caller from FIXOR_DASHBOARD_URL + orgId, so this
   *  module stays free of env reads beyond the Resend ones. */
  billingUrl: string;
  /** Optional next tier label for the upsell line ("Indie", "Pro").
   *  Caller computes; this module just renders. Null for Team. */
  suggestedUpgradeLabel: string | null;
  suggestedUpgradePriceUsd: number | null;
  suggestedUpgradeScans: number | null;
  /** ISO date string (YYYY-MM-DD) of the next budget reset.
   *  Caller computes (start of next month UTC). */
  resetIsoDate: string;
  /** Wall-clock now — passed in for tests; defaults to new Date(). */
  now?: Date;
}

/**
 * Atomically claim + send the 80% nudge. Idempotent across the
 * calendar month: if `limit_warning_email_sent_at` is set and from
 * the SAME UTC year-month as `now`, skip. Otherwise stamp it and
 * send.
 *
 * Two concurrent scans both pass the in-memory month check, but
 * only one wins the SQL UPDATE — the other's UPDATE matches zero
 * rows.
 *
 * Never throws. Returns a status string for log clarity.
 */
export async function maybeSendLimitWarningEmail(
  input: SendLimitWarningInput,
): Promise<
  | { status: "sent"; provider: "resend" | "stub" }
  | { status: "skipped_same_month" }
  | { status: "skipped_no_email" }
  | { status: "skipped_no_org" }
  | { status: "send_failed"; reason: string }
> {
  const now = input.now ?? new Date();

  // Atomic claim with RETURNING — same pattern as first-scan-email.
  // Condition: limit_warning_email_sent_at is NULL OR strictly less
  // than the start of THIS UTC month. Races resolve cleanly: the
  // loser's UPDATE matches zero rows.
  const startOfThisMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );

  let claimed: { email: string | null; existed: boolean }[];
  try {
    claimed = await db()
      .update(orgs)
      .set({ limitWarningEmailSentAt: now })
      .where(
        and(
          eq(orgs.githubInstallationId, input.installationId),
          or(
            isNull(orgs.limitWarningEmailSentAt),
            lt(orgs.limitWarningEmailSentAt, startOfThisMonth),
          ),
        ),
      )
      .returning({
        email: orgs.installerEmail,
        existed: orgs.id,
      })
      .then((rows) =>
        rows.map((r) => ({ email: r.email, existed: Boolean(r.existed) })),
      );
  } catch (err) {
    logger.warn(
      { installationId: input.installationId, err },
      "limit-warning claim failed",
    );
    return { status: "send_failed", reason: "claim_failed" };
  }

  if (claimed.length === 0) {
    // Either the org doesn't exist OR we've already sent this
    // calendar month. Distinguish with a quick read so the log line
    // is useful — the user-visible behavior (no email) is the same.
    const probe = await db()
      .select({ id: orgs.id })
      .from(orgs)
      .where(eq(orgs.githubInstallationId, input.installationId))
      .limit(1);
    return {
      status: probe.length === 0 ? "skipped_no_org" : "skipped_same_month",
    };
  }

  const claimedEmail = claimed[0]!.email;
  if (!claimedEmail) {
    // We claimed the slot but the org has no installer_email.
    // Roll back so a future scan after the dashboard populates the
    // email can re-fire. Same shape as first-scan-email's rollback.
    try {
      await db()
        .update(orgs)
        .set({ limitWarningEmailSentAt: null })
        .where(eq(orgs.githubInstallationId, input.installationId));
    } catch (err) {
      logger.warn(
        { installationId: input.installationId, err },
        "limit-warning claim rollback failed",
      );
    }
    return { status: "skipped_no_email" };
  }

  const pct = Math.round(input.warning.ratio * 100);
  const subject = `Heads-up: Fixor is at ${pct}% of this month's budget`;
  const upgradeBlock = input.suggestedUpgradeLabel
    ? [
        ``,
        `Need more headroom? Upgrade to ${input.suggestedUpgradeLabel} for $${input.suggestedUpgradePriceUsd?.toFixed(0)}/mo:`,
        `  · ${input.suggestedUpgradeScans?.toLocaleString()} scans / month`,
        `  · Higher Anthropic budget`,
        ``,
        `Upgrade: ${input.billingUrl}`,
      ]
    : [
        ``,
        `You're already on our top tier; if you need more, reply to this email and we'll work something out.`,
      ];
  const text = [
    `Your Fixor org has used ${pct}% of this month's Anthropic budget ($${input.warning.monthlySpend.toFixed(2)} of $${input.warning.monthlyCapUsd.toFixed(2)}).`,
    ``,
    `When the budget hits 100%, new scans pause until the next reset (${input.resetIsoDate}).`,
    ``,
    `Most recent scan: ${input.repoFullName} #${input.pullNumber}`,
    ...upgradeBlock,
    ``,
    `— Fixor`,
  ].join("\n");

  const result = await sendBillingEmail({ to: claimedEmail, subject, text });
  if (!result.ok) {
    logger.warn(
      { installationId: input.installationId, reason: result.reason },
      "limit-warning email send failed",
    );
    return { status: "send_failed", reason: result.reason };
  }
  logger.info(
    {
      installationId: input.installationId,
      provider: result.provider,
      ratio: input.warning.ratio,
    },
    "limit-warning email dispatched",
  );
  return { status: "sent", provider: result.provider };
}

/**
 * High-level orchestrator used by the webhook handler. Resolves
 * the org id, billing URL, and suggested upgrade based on the
 * current plan tier, then delegates to maybeSendLimitWarningEmail.
 *
 * No-op when:
 *   - workflow has no budgetWarning (below 80% or already over cap)
 *   - org row not found
 */
const TIER_UPSELL: Record<
  string,
  { label: string; priceUsd: number; scans: number } | null
> = {
  free: { label: "Indie", priceUsd: 29, scans: 100 },
  indie: { label: "Pro", priceUsd: 79, scans: 500 },
  pro: { label: "Team", priceUsd: 199, scans: 2000 },
  team: null,
};

export interface TriggerLimitWarningInput {
  installationId: string;
  warning: BudgetWarning;
  repoFullName: string;
  pullNumber: number;
  /** Wall-clock now — for tests; defaults to new Date() inside
   *  maybeSendLimitWarningEmail. */
  now?: Date;
}

export async function triggerLimitWarningEmailIfNeeded(
  input: TriggerLimitWarningInput,
): Promise<void> {
  let row: { id: string; planTier: string } | null;
  try {
    const rows = await db()
      .select({ id: orgs.id, planTier: orgs.planTier })
      .from(orgs)
      .where(eq(orgs.githubInstallationId, input.installationId))
      .limit(1);
    row = rows[0] ?? null;
  } catch (err) {
    logger.warn(
      { installationId: input.installationId, err },
      "triggerLimitWarning org lookup failed",
    );
    return;
  }
  if (!row) return;

  const dashboardBase =
    process.env.FIXOR_DASHBOARD_URL?.trim().replace(/\/+$/, "") ??
    "https://app.fixor.dev";
  const billingUrl = `${dashboardBase}/orgs/${row.id}/billing`;

  const upsell = TIER_UPSELL[row.planTier] ?? null;
  const now = input.now ?? new Date();

  const result = await maybeSendLimitWarningEmail({
    installationId: input.installationId,
    warning: input.warning,
    repoFullName: input.repoFullName,
    pullNumber: input.pullNumber,
    billingUrl,
    suggestedUpgradeLabel: upsell?.label ?? null,
    suggestedUpgradePriceUsd: upsell?.priceUsd ?? null,
    suggestedUpgradeScans: upsell?.scans ?? null,
    resetIsoDate: startOfNextMonthIso(now),
    now,
  });
  // result is logged inside maybeSendLimitWarningEmail; nothing
  // more to do here. Returning void keeps the call site fire-and-
  // forget-friendly.
  void result;
}

/**
 * Returns the ISO YYYY-MM-DD of the first day of the NEXT UTC
 * month from `now`. Used for the "budget resets on …" line in the
 * email.
 */
export function startOfNextMonthIso(now: Date = new Date()): string {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
