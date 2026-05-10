// ASSUMED-PATH: src/app/handlers/secrets-exposure/04-stripe-in-getserverside.tsx
// src/pages/billing/checkout.tsx
import type { GetServerSideProps } from "next";
import Stripe from "stripe";

// getServerSideProps runs on the server only -- the function body and any
// imports it uses are stripped from the client bundle by Next.js.
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2024-06-20",
  });
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: ctx.query.price as string, quantity: 1 }],
    success_url: "https://acme.app/billing/done",
    cancel_url: "https://acme.app/billing",
  });
  return { redirect: { destination: session.url!, permanent: false } };
};

export default function CheckoutRedirect() {
  return <p>Redirecting to Stripe...</p>;
}
