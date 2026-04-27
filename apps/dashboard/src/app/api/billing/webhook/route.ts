/**
 * POST /api/billing/webhook — Paddle Billing webhook receiver.
 *
 * This endpoint is unauthenticated (Clerk middleware skips it via the
 * `isPublic` matcher in proxy.ts). Authenticity comes from verifying
 * the `Paddle-Signature` HMAC against PADDLE_WEBHOOK_SECRET — a
 * bad/missing signature returns 401 and Paddle retries with backoff.
 *
 * Event coverage (5D-3 scope):
 *   - transaction.completed       → set tier + paddle ids + cap
 *   - subscription.updated        → update tier + cap
 *   - subscription.canceled       → downgrade to free + email
 *   - transaction.payment_failed  → downgrade to free + email
 *
 * Anything else returns 200 without action — Paddle ships ~30 event
 * types and we don't want to be on the retry list for events we
 * intentionally ignore.
 *
 * Failures during DB writes return 500 so Paddle retries; a 200
 * means we accepted the event (success or no-op-for-this-type).
 */
import { NextResponse } from "next/server";
import { tierFromPaddlePriceId } from "@/lib/tiers";
import { verifyPaddleSignature } from "@/lib/paddle-webhook";
import {
  applyDowngradeToFree,
  applySubscriptionUpdated,
  applyTransactionCompleted,
  findOrgById,
} from "@/lib/billing-events";
import { sendBillingEmail } from "@/lib/resend";

interface PaddleEnvelope {
  event_id?: string;
  event_type?: string;
  data?: PaddleEventData;
}

interface PaddleEventData {
  id?: string;
  customer_id?: string;
  subscription_id?: string | null;
  status?: string;
  custom_data?: { org_id?: unknown } | null;
  items?: Array<{ price?: { id?: string } | null }>;
  customer?: { email?: string } | null;
}

export async function POST(req: Request) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "webhook_secret_not_configured" },
      { status: 500 },
    );
  }

  // Read the raw body BEFORE parsing — the signature is computed over
  // the exact bytes Paddle sent, so re-serialising parsed JSON breaks
  // the HMAC.
  const rawBody = await req.text();

  const verdict = verifyPaddleSignature({
    rawBody,
    signatureHeader: req.headers.get("paddle-signature"),
    secret,
  });
  if (!verdict.ok) {
    return NextResponse.json(
      { error: `signature_${verdict.reason}` },
      { status: 401 },
    );
  }

  let envelope: PaddleEnvelope;
  try {
    envelope = JSON.parse(rawBody) as PaddleEnvelope;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const eventType = envelope.event_type ?? "";
  const eventId = envelope.event_id ?? "unknown";
  const data = envelope.data ?? {};

  // Pull the correlation id we set in 5D-2's checkout.create call.
  // Without it we cannot map the event to a Fixor org — return 200
  // so Paddle stops retrying, but log enough to investigate.
  const orgId = readOrgIdFromCustomData(data.custom_data);

  try {
    switch (eventType) {
      case "transaction.completed": {
        if (!orgId) {
          return NextResponse.json({ ok: true, ignored: "no_org_id" });
        }
        const priceId = readFirstPriceId(data);
        const tier = priceId ? tierFromPaddlePriceId(priceId) : null;
        if (!tier || !data.customer_id) {
          // Either price isn't ours or Paddle hasn't given us a
          // customer yet (rare). Don't write a tier we can't map.
          return NextResponse.json({
            ok: true,
            ignored: tier ? "no_customer_id" : "unknown_price",
          });
        }
        await applyTransactionCompleted({
          orgId,
          paddleCustomerId: data.customer_id,
          paddleSubscriptionId: data.subscription_id ?? null,
          tier,
          eventId,
        });
        return NextResponse.json({ ok: true });
      }

      case "subscription.updated": {
        if (!orgId || !data.id) {
          return NextResponse.json({ ok: true, ignored: "missing_ids" });
        }
        const priceId = readFirstPriceId(data);
        const tier = priceId ? tierFromPaddlePriceId(priceId) : null;
        if (!tier) {
          return NextResponse.json({ ok: true, ignored: "unknown_price" });
        }
        await applySubscriptionUpdated({
          orgId,
          paddleSubscriptionId: data.id,
          tier,
          eventId,
        });
        return NextResponse.json({ ok: true });
      }

      case "subscription.canceled":
      case "transaction.payment_failed": {
        if (!orgId) {
          return NextResponse.json({ ok: true, ignored: "no_org_id" });
        }
        const reason =
          eventType === "subscription.canceled"
            ? "subscription.canceled"
            : "transaction.payment_failed";
        const existing = await findOrgById(orgId);
        if (!existing) {
          return NextResponse.json({ ok: true, ignored: "org_not_found" });
        }
        await applyDowngradeToFree({ orgId, reason, eventId });

        // Email is best-effort — Resend may not be configured yet
        // (5D-6). Don't fail the webhook if the email send errors;
        // we'd rather Paddle stop retrying.
        const subject =
          reason === "subscription.canceled"
            ? "Your Fixor subscription was canceled"
            : "We couldn't process your Fixor payment";
        const text =
          reason === "subscription.canceled"
            ? `Your subscription was canceled. Your org has been moved to the free tier ($5/month Anthropic budget, 5 scans/month). You can re-subscribe any time from the billing page.`
            : `Your latest Fixor payment failed and we've moved your org back to the free tier so scans aren't blocked. Update your payment method via the billing page to restore your previous tier.`;
        await sendBillingEmail({
          to: data.customer?.email ?? null,
          subject,
          text,
        });
        return NextResponse.json({ ok: true });
      }

      default:
        // Acknowledged-but-ignored — Paddle will not retry.
        return NextResponse.json({ ok: true, ignored: eventType });
    }
  } catch (err) {
    // 500 → Paddle retries with backoff. Log to console (Vercel
    // function logs) so the operator can investigate; we don't have
    // structured logging on the dashboard yet.
    console.error(
      `[paddle webhook] handler failed event=${eventType} id=${eventId}`,
      err,
    );
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}

function readOrgIdFromCustomData(
  custom: PaddleEventData["custom_data"],
): string | null {
  if (!custom || typeof custom !== "object") return null;
  const v = (custom as { org_id?: unknown }).org_id;
  return typeof v === "string" && v.length > 0 ? v : null;
}

function readFirstPriceId(data: PaddleEventData): string | null {
  const id = data.items?.[0]?.price?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
