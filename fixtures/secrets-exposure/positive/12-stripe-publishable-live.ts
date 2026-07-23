// ASSUMED-PATH: src/app/handlers/secrets-exposure/12-stripe-publishable-live.ts
// src/lib/stripe-client.ts is imported by the checkout button in the client bundle.
export const STRIPE_PUBLISHABLE_KEY =
  "pk_live_51ExampleFAKEpublishableKEYfixtureONLY00";

export function isLiveMode(): boolean {
  return STRIPE_PUBLISHABLE_KEY.startsWith("pk_live_");
}
