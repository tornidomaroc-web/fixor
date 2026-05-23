// ASSUMED-PATH: app/api/stripe/webhook/route.ts
// Phase C — App Router webhook negative (library verify proper).
// Same path-signal as WH-P1, but body uses `stripe.webhooks.
// constructEvent(body, sig, secret)` correctly — try/catch returns
// 400 on invalid signature, then handles the verified event.
import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET!);

async function handleStripeEvent(_event: Stripe.Event): Promise<void> {}

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return new Response("Missing signature", { status: 400 });
  }
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  await handleStripeEvent(event);
  return NextResponse.json({ ok: true });
}
