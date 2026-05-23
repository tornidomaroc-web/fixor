// ASSUMED-PATH: app/api/outlook/webhook/route.ts
// Phase F — App Router webhook negative, class (d) non-HMAC shared-
// secret challenge symmetric NEGATIVE anchor to positive/15-app-router-
// graph-clientstate-no-compare.ts. Mirrors the inbox-zero outlook/
// webhook FP class the Phase D council surfaced: a Microsoft-Graph-
// style notification handler that reads `notification.clientState`,
// compares it against `process.env.GRAPH_CLIENT_STATE` (the shared-
// secret Microsoft Graph stores at subscription-create time), and
// returns 403 on mismatch. The mechanism is not HMAC but it IS
// verification — the shared-secret challenge is the documented
// Microsoft Graph subscription-validation pattern. Fixor cannot
// confirm cross-file what env.GRAPH_CLIENT_STATE actually is, but
// the body-field-compare-against-env-and-403-on-mismatch shape is
// strong enough signal that HIGH would be a false positive. Phase F
// tune routes this to MEDIUM/review-queue: vulnerability shape
// (isVulnerable=true) at medium confidence, surfaced in the review
// queue rather than as a HIGH PR comment. NOT skip (cross-file env
// value unconfirmed); NOT HIGH (the compare-and-403 shape is
// verification).
import { NextResponse } from "next/server";

interface GraphNotification {
  subscriptionId: string;
  clientState?: string;
  resource: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as { value: GraphNotification[] };
  for (const notification of body.value) {
    if (notification.clientState !== process.env.GRAPH_CLIENT_STATE) {
      return new Response("Invalid clientState", { status: 403 });
    }
    await processGraphNotification(notification);
  }
  return NextResponse.json({ ok: true });
}

async function processGraphNotification(_n: GraphNotification): Promise<void> {}
