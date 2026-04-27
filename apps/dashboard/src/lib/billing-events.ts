/**
 * Server-only mutation layer for the Paddle webhook (5D-3).
 *
 * Each `apply*` function corresponds to one event type the webhook
 * handler dispatches on. Updates are written through Drizzle to the
 * same Neon DB the rest of the dashboard uses.
 *
 * Idempotency posture: the underlying writes are UPSERT-shaped at
 * the value level (setting `plan_tier="indie"` twice is a no-op),
 * so duplicate Paddle deliveries don't corrupt state. Audit-log
 * rows may accumulate a small number of duplicates from rare
 * retries — accepted noise for now; event-id deduplication can be
 * a follow-up if it becomes a problem.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, orgs } from "@/db/schema";
import type { Tier } from "@/lib/tiers";

export interface ApplyTransactionCompletedInput {
  orgId: string;
  paddleCustomerId: string;
  paddleSubscriptionId: string | null;
  tier: Tier;
  /** Paddle event id — recorded in audit_log metadata so the trail
   *  shows which webhook delivery moved this org. */
  eventId: string;
}

export async function applyTransactionCompleted(
  input: ApplyTransactionCompletedInput,
): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .update(orgs)
      .set({
        planTier: input.tier.id,
        paddleCustomerId: input.paddleCustomerId,
        paddleSubscriptionId: input.paddleSubscriptionId,
        // Lift the Anthropic budget cap to match the new tier so
        // checkBudget on the next scan doesn't immediately reject
        // with the previous (lower) tier's cap. Numeric is stored
        // as a 2-decimal string in postgres.
        monthlyCapUsd: input.tier.monthlyCapUsd.toFixed(2),
      })
      .where(eq(orgs.id, input.orgId));

    await tx.insert(auditLog).values({
      orgId: input.orgId,
      actorType: "paddle_webhook",
      actorId: input.eventId,
      action: "plan_changed",
      target: `org/${input.orgId}`,
      metadata: {
        event: "transaction.completed",
        tier: input.tier.id,
        priceUsd: input.tier.priceUsd,
        monthlyCapUsd: input.tier.monthlyCapUsd,
        paddleSubscriptionId: input.paddleSubscriptionId,
      },
    });
  });
}

export interface ApplySubscriptionUpdatedInput {
  orgId: string;
  paddleSubscriptionId: string;
  tier: Tier;
  eventId: string;
}

export async function applySubscriptionUpdated(
  input: ApplySubscriptionUpdatedInput,
): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .update(orgs)
      .set({
        planTier: input.tier.id,
        paddleSubscriptionId: input.paddleSubscriptionId,
        monthlyCapUsd: input.tier.monthlyCapUsd.toFixed(2),
      })
      .where(eq(orgs.id, input.orgId));

    await tx.insert(auditLog).values({
      orgId: input.orgId,
      actorType: "paddle_webhook",
      actorId: input.eventId,
      action: "plan_changed",
      target: `org/${input.orgId}`,
      metadata: {
        event: "subscription.updated",
        tier: input.tier.id,
        monthlyCapUsd: input.tier.monthlyCapUsd,
      },
    });
  });
}

export interface ApplyDowngradeInput {
  orgId: string;
  /** Either "subscription.canceled" or "transaction.payment_failed";
   *  recorded verbatim in the audit log so the trail distinguishes
   *  voluntary cancel from involuntary lapse. */
  reason: "subscription.canceled" | "transaction.payment_failed";
  eventId: string;
}

const FREE_CAP_USD = 5;

/**
 * Drop an org back to the free tier. Used by the cancel + payment-
 * failed paths. Keeps `paddle_customer_id` (so a re-upgrade can reuse
 * the customer record) but clears `paddle_subscription_id` so the UI
 * doesn't claim there's an active sub.
 */
export async function applyDowngradeToFree(
  input: ApplyDowngradeInput,
): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .update(orgs)
      .set({
        planTier: "free",
        paddleSubscriptionId: null,
        monthlyCapUsd: FREE_CAP_USD.toFixed(2),
      })
      .where(eq(orgs.id, input.orgId));

    await tx.insert(auditLog).values({
      orgId: input.orgId,
      actorType: "paddle_webhook",
      actorId: input.eventId,
      action: "plan_changed",
      target: `org/${input.orgId}`,
      metadata: {
        event: input.reason,
        tier: "free",
        monthlyCapUsd: FREE_CAP_USD,
      },
    });
  });
}

/**
 * Look up the user-visible identity of an org so the webhook can
 * decide whether to send an email, what to address it to, and what
 * org name to mention in the body. Returns null when the org doesn't
 * exist (event for a stale custom_data.org_id).
 */
export async function findOrgById(
  orgId: string,
): Promise<{ id: string; planTier: string } | null> {
  const rows = await db()
    .select({ id: orgs.id, planTier: orgs.planTier })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  return rows[0] ?? null;
}
