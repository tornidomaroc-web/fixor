import Link from "next/link";

interface Props {
  orgId: string;
  orgLabel: string;
  monthlySpendUsd: number;
  monthlyCapUsd: number;
}

/**
 * 5E-5 dashboard nudge — server-rendered (no client JS) banner
 * shown above the page content when an org's monthly spend is in
 * the 80–99% range. Mirrors the soft nudge that lands in the PR
 * comment so the customer sees a consistent message in both places.
 *
 * The threshold check (computeBudgetWarning equivalent) lives at
 * the call site so this component just renders what it's told. The
 * upper bound (< 100%) is also enforced upstream — at 100% the
 * scan-paused state in the dashboard takes over.
 */
export function BudgetWarningBanner({
  orgId,
  orgLabel,
  monthlySpendUsd,
  monthlyCapUsd,
}: Props) {
  const pct = Math.round((monthlySpendUsd / monthlyCapUsd) * 100);
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950">
      <p className="font-medium text-amber-900 dark:text-amber-100">
        {orgLabel}: {pct}% of this month&apos;s budget used
      </p>
      <p className="mt-1 text-amber-900/80 dark:text-amber-100/80">
        ${monthlySpendUsd.toFixed(2)} of ${monthlyCapUsd.toFixed(2)}.
        New scans pause when the budget is fully spent until next
        month&apos;s reset.{" "}
        <Link
          href={`/orgs/${orgId}/billing`}
          className="font-medium underline underline-offset-2 hover:opacity-80"
        >
          Upgrade or check billing →
        </Link>
      </p>
    </div>
  );
}

/**
 * Pure helper used by callers to decide whether the banner should
 * render at all. Same threshold as the backend's
 * computeBudgetWarning (80% inclusive, 100% exclusive). Returning
 * null lets the caller short-circuit rendering without computing
 * the percentage twice.
 */
export function shouldShowBudgetWarning(
  monthlySpendUsd: number,
  monthlyCapUsd: number,
): boolean {
  if (!Number.isFinite(monthlySpendUsd) || monthlySpendUsd < 0) return false;
  if (!Number.isFinite(monthlyCapUsd) || monthlyCapUsd <= 0) return false;
  const ratio = monthlySpendUsd / monthlyCapUsd;
  return ratio >= 0.8 && ratio < 1;
}
