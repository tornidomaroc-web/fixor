// ASSUMED-PATH: src/app/handlers/secrets-exposure/04-stripe-secret-hardcoded.ts
// src/lib/stripe.ts
import Stripe from "stripe";

// Hardcoded so the CI smoke test doesn't need a secret.
// TODO: move to env before production.
const STRIPE_SECRET_KEY =
  "sk_live_51HxXmDHFhJ8h4zE4kJABCdef1234567890ghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export async function createCheckoutSession(
  priceId: string,
  customerId: string,
) {
  return stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: customerId,
    success_url: "https://acme.app/success",
    cancel_url: "https://acme.app/cancel",
  });
}
