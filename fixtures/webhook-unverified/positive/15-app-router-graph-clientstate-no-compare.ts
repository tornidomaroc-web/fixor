// ASSUMED-PATH: app/api/outlook/webhook/route.ts
// Phase F — App Router webhook positive, class (d) non-HMAC shared-
// secret challenge symmetric POSITIVE anchor to negative/15-app-router-
// graph-clientstate-challenge.ts. Mirrors the inbox-zero outlook/webhook
// FP class: same Microsoft-Graph-style notification body shape, same
// `notification.clientState` field read, but this fixture performs NO
// compare against any expected value. The clientState is read into a
// local and ignored — the handler trusts the request and processes the
// notification directly. Must FLAG HIGH so the Phase F tune that lowers
// the clientState-compare-and-403 pattern to MEDIUM does NOT over-
// generalize to "any route that reads notification.clientState is
// verified." The differ-by-one-feature pairing with negative/15 is the
// symmetric-anchor discipline carried forward from Phase C: the new
// MEDIUM rule keys on compare + unauthorized-on-mismatch, so a
// positive that merely reads the field without comparing must still
// flag HIGH.
import { NextResponse } from "next/server";

interface GraphNotification {
  subscriptionId: string;
  clientState?: string;
  resource: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as { value: GraphNotification[] };
  for (const notification of body.value) {
    const _clientState = notification.clientState;
    // No compare. Notification processed regardless of clientState value.
    await processGraphNotification(notification);
  }
  return NextResponse.json({ ok: true });
}

async function processGraphNotification(_n: GraphNotification): Promise<void> {}
