// ASSUMED-PATH: app/routes/webhook.stripe.ts
// Phase E — Remix v2 webhook-unverified negative.
// Stripe webhook handler at Remix v2 flat-route file using
// `stripe.webhooks.constructEvent` — the library-based verification
// pattern that auto-validates the signature against
// STRIPE_WEBHOOK_SECRET. Gated per webhook prompt's GATED case.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import Stripe from "stripe";

import { db } from "~/lib/db.server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export const action = async ({ request }: ActionFunctionArgs) => {
  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return json({ error: "missing signature" }, { status: 400 });
  }
  const body = await request.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    return json({ error: "invalid signature" }, { status: 400 });
  }
  if (event.type === "customer.subscription.updated") {
    await db.subscription.upsert({
      where: { stripeId: (event.data.object as { id: string }).id },
      create: { stripeId: (event.data.object as { id: string }).id },
      update: {},
    });
  }
  return json({ received: true });
};
