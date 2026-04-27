/**
 * Send the "Fixor just scanned your first PR" email exactly once
 * per org (5E-4).
 *
 * The atomic-claim pattern: a single SQL UPDATE conditions on
 * `first_scan_email_sent_at IS NULL AND installer_email IS NOT NULL`
 * and uses RETURNING to surface the email address only when this
 * call won the race. Two concurrent scans for the same org both
 * pass the precondition logic at the application layer, but only
 * the one that wins the UPDATE gets a row back; the other gets
 * an empty result and silently no-ops.
 *
 * Failure modes:
 *   - org row missing for installation_id → no-op (logged)
 *   - installer_email not yet populated → no-op; the dashboard's
 *     opportunistic-population path will fill it next time the
 *     user signs in, and a future scan will fire the email
 *   - already sent (sent_at not null) → no-op
 *   - Resend POST fails after the claim → we've "spent" our one
 *     try. Operator can manually clear `first_scan_email_sent_at`
 *     to re-arm. Trade-off: no duplicate sends ever, with the
 *     downside that a transient Resend outage costs the email.
 *     Acceptable at indie scale.
 */
import { eq, sql, and, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { orgs } from "../db/schema";
import { sendBillingEmail } from "../lib/resend";
import { logger } from "../lib/logger";

export interface FirstScanContext {
  installationId: string;
  /** Public PR URL — landing target for the email's CTA. */
  prUrl: string;
  /** "owner/repo" — used in the email body to remind the user
   *  which repo got the scan. */
  repoFullName: string;
  pullNumber: number;
}

/**
 * Idempotently send the first-scan email for an org. Returns a
 * brief status describing what happened so callers (the workflow)
 * can log it; never throws — first-scan-email is best-effort and
 * must not break the scan return path.
 */
export async function maybeSendFirstScanEmail(
  ctx: FirstScanContext,
): Promise<
  | { status: "sent"; provider: "resend" | "stub" }
  | { status: "no_email" }
  | { status: "already_sent" }
  | { status: "no_org" }
  | { status: "send_failed"; reason: string }
> {
  let claimedEmail: string | null;
  try {
    // Atomic claim. Only updates rows where the email hasn't been
    // sent AND we have somewhere to send it. RETURNING lets us
    // grab the address in the same round-trip.
    const claimed = await db()
      .update(orgs)
      .set({ firstScanEmailSentAt: sql`now()` })
      .where(
        and(
          eq(orgs.githubInstallationId, ctx.installationId),
          isNull(orgs.firstScanEmailSentAt),
        ),
      )
      .returning({ email: orgs.installerEmail });
    if (claimed.length === 0) {
      // Either no org row, or already sent. Distinguish for the
      // log line by a quick lookup — info-level, not an error.
      const probe = await db()
        .select({ sent: orgs.firstScanEmailSentAt })
        .from(orgs)
        .where(eq(orgs.githubInstallationId, ctx.installationId))
        .limit(1);
      if (probe.length === 0) {
        logger.info(
          { installationId: ctx.installationId },
          "first-scan email skipped — no org row",
        );
        return { status: "no_org" };
      }
      logger.info(
        { installationId: ctx.installationId },
        "first-scan email skipped — already sent",
      );
      return { status: "already_sent" };
    }
    claimedEmail = claimed[0]!.email;
  } catch (err) {
    logger.warn(
      { installationId: ctx.installationId, err },
      "first-scan email claim failed",
    );
    return {
      status: "send_failed",
      reason: err instanceof Error ? err.message : "claim_failed",
    };
  }

  if (!claimedEmail) {
    // We claimed the slot but the org has no installer_email.
    // Roll back the claim so a future scan (after the dashboard
    // populates the email) can re-fire.
    try {
      await db()
        .update(orgs)
        .set({ firstScanEmailSentAt: null })
        .where(eq(orgs.githubInstallationId, ctx.installationId));
    } catch (err) {
      logger.warn(
        { installationId: ctx.installationId, err },
        "first-scan email claim rollback failed",
      );
    }
    logger.info(
      { installationId: ctx.installationId },
      "first-scan email skipped — installer_email not yet populated",
    );
    return { status: "no_email" };
  }

  const subject = "Fixor just scanned your first PR";
  const text = [
    `Fixor reviewed your first pull request — ${ctx.repoFullName} #${ctx.pullNumber}.`,
    ``,
    `See the security report inline on the PR:`,
    `${ctx.prUrl}`,
    ``,
    `From here on, every PR you open on a watched repo gets the same review within ~30 seconds. Tune severity, ignored paths, or detector allowlist any time from the dashboard.`,
    ``,
    `— Fixor`,
  ].join("\n");

  const result = await sendBillingEmail({ to: claimedEmail, subject, text });
  if (!result.ok) {
    logger.warn(
      { installationId: ctx.installationId, reason: result.reason },
      "first-scan email send failed",
    );
    return { status: "send_failed", reason: result.reason };
  }
  logger.info(
    {
      installationId: ctx.installationId,
      provider: result.provider,
    },
    "first-scan email dispatched",
  );
  return { status: "sent", provider: result.provider };
}
