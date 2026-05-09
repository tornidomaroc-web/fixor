// ASSUMED-PATH: fixtures/mock-stripe-keys.test.ts
// fixtures/mock-stripe-keys.test.ts
import Stripe from "stripe";

// Stripe-published test keys. These are publicly documented and only
// authorize the test mode environment. Used by Vitest only.
const TEST_PUBLISHABLE_KEY = "pk_test_TYooMQauvdEDq54NiTphI7jx";
const TEST_SECRET_KEY = "sk_test_4eC39HqLyjWDarjtT1zdp7dc";

export function makeStripeForTests(): Stripe {
  return new Stripe(TEST_SECRET_KEY, { apiVersion: "2024-06-20" });
}

export const STRIPE_KEYS_FOR_TESTS = {
  publishable: TEST_PUBLISHABLE_KEY,
  secret: TEST_SECRET_KEY,
} as const;
