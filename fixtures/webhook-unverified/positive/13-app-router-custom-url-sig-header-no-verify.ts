// ASSUMED-PATH: app/api/billing/events/route.ts
// Phase C — SYMMETRIC TP ANCHOR for W1. Webhook handler at a
// non-/webhook/ URL whose webhook-ness is established ONLY by
// signature-header reading. NO path segment signal, NO webhook lib
// import, NO node:crypto HMAC. The header read (`x-webhook-
// signature`) is the only webhook signal — and the verification
// is missing. Tightening the node:crypto signal in WH-N1 must not
// collapse webhook recognition into nothing; this fixture is the
// load-bearing TP that proves recognition still works on the
// header-read pathway after the prompt tightening.
import { NextResponse } from "next/server";

interface BillingEvent {
  type: string;
  payload: unknown;
}

async function processBillingEvent(event: BillingEvent): Promise<void> {
  void event;
}

export async function POST(req: Request) {
  const sig = req.headers.get("x-webhook-signature");
  void sig;
  const event = (await req.json()) as BillingEvent;
  await processBillingEvent(event);
  return NextResponse.json({ ok: true });
}
