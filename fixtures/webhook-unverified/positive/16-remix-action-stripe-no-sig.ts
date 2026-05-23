// ASSUMED-PATH: app/routes/webhook.stripe.ts
// Phase E — Remix v2 webhook-unverified positive.
// Remix v2 flat-route file at `app/routes/webhook.stripe.ts` (URL
// path `/webhook/stripe`). Handler is a Stripe webhook target —
// reads request body and `db.subscription.upsert` on the parsed
// payload — with NO signature verification (no
// `stripe.webhooks.constructEvent`, no `timingSafeEqual`, no HMAC).
// File path contains `/webhook/` segment in the URL; file imports
// `stripe` library; no library-based verification.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { db } from "~/lib/db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const event = await request.json();
  if (event.type === "customer.subscription.updated") {
    await db.subscription.upsert({
      where: { stripeId: event.data.object.id },
      create: {
        stripeId: event.data.object.id,
        status: event.data.object.status,
      },
      update: {
        status: event.data.object.status,
      },
    });
  }
  return json({ received: true });
};
