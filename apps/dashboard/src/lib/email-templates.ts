/**
 * Plain-text email templates for the Paddle billing flow (5D-6).
 *
 * Each `render*` returns `{ subject, text }` from typed inputs so
 * call sites can't accidentally interpolate the wrong field. Pure
 * functions — no DB access, no env reads — so they're trivially
 * testable when the dashboard finally gets a test runner (5C close-
 * out follow-up).
 *
 * The locked decisions table calls out "React Email templates" as
 * the eventual polish layer. We're shipping plain text first because
 * (a) the call sites need bodies today and (b) Paddle's checkout +
 * portal URLs already carry the brand, so the email body itself
 * doesn't need rich layout to feel professional. Swapping to React
 * Email later is a per-template change that doesn't touch any
 * caller — a Phase-6 follow-up.
 *
 * Trigger coverage:
 *   - welcome / payment-failed / cancellation: wired by the Paddle
 *     webhook in 5D-3 (PR #38 plumbs them through here).
 *   - scan-limit-80 / monthly-digest: templates ready, but their
 *     triggers live on the cost-store (backend) or a cron we don't
 *     have yet — see Phase 5D close-out follow-up.
 */

import type { Tier } from "@/lib/tiers";

export interface RenderedEmail {
  subject: string;
  text: string;
}

export interface WelcomeInput {
  tier: Tier;
  /** Absolute URL of the billing page for this org. Used in the
   *  call-to-action so the user can confirm the upgrade landed. */
  billingUrl: string;
}

export function renderWelcomeEmail(input: WelcomeInput): RenderedEmail {
  const { tier, billingUrl } = input;
  return {
    subject: `Welcome to Fixor ${tier.label}`,
    text: [
      `Thanks for upgrading — your Fixor org is now on the ${tier.label} plan.`,
      ``,
      `What's included:`,
      ...tier.features.map((f) => `  · ${f}`),
      ``,
      `Anthropic budget: $${tier.monthlyCapUsd.toFixed(2)}/month (Fixor's analysis budget for your org).`,
      ``,
      `Open the next PR on a repo Fixor watches and the new tier kicks in immediately.`,
      ``,
      `Manage billing: ${billingUrl}`,
      ``,
      `— Fixor`,
    ].join("\n"),
  };
}

export interface CancellationInput {
  /** Tier the org WAS on before cancellation — referenced in the
   *  body so the user remembers what they had if they want to come
   *  back. Optional because some Paddle events don't include it. */
  previousTier?: Tier | null;
  billingUrl: string;
}

export function renderCancellationEmail(
  input: CancellationInput,
): RenderedEmail {
  const { previousTier, billingUrl } = input;
  const fromLine = previousTier
    ? `Your ${previousTier.label} ($${previousTier.priceUsd}/mo) subscription was canceled.`
    : `Your Fixor subscription was canceled.`;
  return {
    subject: `Your Fixor subscription was canceled`,
    text: [
      fromLine,
      ``,
      `Your org has been moved to the free tier:`,
      `  · 5 scans / month`,
      `  · Public repos only`,
      `  · $5/month Anthropic budget`,
      ``,
      `If you'd like to come back, you can re-subscribe any time:`,
      `${billingUrl}`,
      ``,
      `— Fixor`,
    ].join("\n"),
  };
}

export interface PaymentFailedInput {
  billingUrl: string;
}

export function renderPaymentFailedEmail(
  input: PaymentFailedInput,
): RenderedEmail {
  const { billingUrl } = input;
  return {
    subject: `We couldn't process your Fixor payment`,
    text: [
      `Your latest Fixor payment failed and we've moved your org back to the free tier so scans aren't blocked while you sort it out.`,
      ``,
      `To restore your previous tier, update the card on file:`,
      `${billingUrl}`,
      ``,
      `Once Paddle accepts the new payment, the webhook will lift your tier within ~30 seconds.`,
      ``,
      `— Fixor`,
    ].join("\n"),
  };
}

export interface ScanLimitWarningInput {
  /** Currently spent in USD this month (from cost_ledger). */
  spendUsd: number;
  /** Resolved org cap in USD (orgs.monthly_cap_usd). */
  capUsd: number;
  /** The tier we'd suggest upgrading to — null when the org is
   *  already on Team (the highest paid tier). */
  suggestedUpgrade: Tier | null;
  billingUrl: string;
  /** ISO date for the first day of next month, used to tell the
   *  user when the budget resets. Caller computes this; keeping it
   *  outside the renderer makes timezone handling explicit. */
  resetIsoDate: string;
}

export function renderScanLimitWarningEmail(
  input: ScanLimitWarningInput,
): RenderedEmail {
  const { spendUsd, capUsd, suggestedUpgrade, billingUrl, resetIsoDate } =
    input;
  const pctSpent = capUsd > 0 ? Math.round((spendUsd / capUsd) * 100) : 0;
  const lines = [
    `Your Fixor org has used ${pctSpent}% of this month's Anthropic budget ($${spendUsd.toFixed(2)} of $${capUsd.toFixed(2)}).`,
    ``,
    `When the budget hits 100%, new scans are paused until the next reset (${resetIsoDate}).`,
    ``,
  ];
  if (suggestedUpgrade) {
    lines.push(
      `Need more headroom? Upgrade to ${suggestedUpgrade.label} for $${suggestedUpgrade.priceUsd}/mo:`,
      `  · ${suggestedUpgrade.scansPerMonth.toLocaleString()} scans / month`,
      `  · $${suggestedUpgrade.monthlyCapUsd.toFixed(2)} Anthropic budget`,
      ``,
      `Upgrade: ${billingUrl}`,
    );
  } else {
    lines.push(
      `You're already on our top tier; if you need more, reply to this email and we'll work something out.`,
    );
  }
  lines.push(``, `— Fixor`);
  return {
    subject: `Heads-up: Fixor is at ${pctSpent}% of this month's budget`,
    text: lines.join("\n"),
  };
}

export interface MonthlyDigestInput {
  monthLabel: string;
  scans: number;
  findings: number;
  fixesGenerated: number;
  costUsd: number;
  /** Up to four entries; renderer truncates beyond that to keep the
   *  email scannable. */
  topDetectorFamilies: ReadonlyArray<{ label: string; count: number }>;
  dashboardUrl: string;
}

export function renderMonthlyDigestEmail(
  input: MonthlyDigestInput,
): RenderedEmail {
  const {
    monthLabel,
    scans,
    findings,
    fixesGenerated,
    costUsd,
    topDetectorFamilies,
    dashboardUrl,
  } = input;
  const top = topDetectorFamilies.slice(0, 4);
  const lines = [
    `Your Fixor month in review — ${monthLabel}.`,
    ``,
    `  · ${scans.toLocaleString()} scans`,
    `  · ${findings.toLocaleString()} findings`,
    `  · ${fixesGenerated.toLocaleString()} suggested fixes`,
    `  · $${costUsd.toFixed(2)} Anthropic spend`,
    ``,
  ];
  if (top.length > 0) {
    lines.push(`Top detector families:`);
    for (const t of top) {
      lines.push(`  · ${t.label}: ${t.count.toLocaleString()}`);
    }
    lines.push(``);
  }
  lines.push(
    `Full history: ${dashboardUrl}`,
    ``,
    `— Fixor`,
  );
  return {
    subject: `Fixor — ${monthLabel} digest`,
    text: lines.join("\n"),
  };
}
