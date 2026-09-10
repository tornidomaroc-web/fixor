// ASSUMED-PATH: src/app/handlers/secrets-exposure/13-stripe-publishable-placeholder.ts
// src/lib/stripe-client.template.ts
// Checkout button config template. The publishable key is filled in per environment.
export const STRIPE_PUBLISHABLE_KEY = "pk_live_<from-dashboard>";

export function isLiveMode(): boolean {
  return STRIPE_PUBLISHABLE_KEY.startsWith("pk_live_");
}
