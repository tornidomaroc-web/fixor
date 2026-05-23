// ASSUMED-PATH: app/api/apple/webhook/route.ts
// Phase F — App Router webhook negative, class (c) cross-file-verifier
// helper symmetric NEGATIVE anchor to positive/14-app-router-apple-
// cross-file-no-call.ts. Mirrors the inbox-zero apple/webhook FP class
// the Phase D council surfaced: the handler imports a verification-
// suggesting helper from a sibling module and awaits it on the signed
// payload before processing. The verifier cannot be confirmed cross-
// file (its implementation lives in `@/lib/apple/verify`), but the
// import + await + verify*Payload name-convention is enough signal
// that HIGH is over-confident — Fixor cannot KNOW the helper enforces
// verification without cross-file analysis, but it also cannot honestly
// flag this as missing verification. Phase F tune routes this to
// MEDIUM/review-queue: vulnerability shape (isVulnerable=true) at
// medium confidence, surfaced in the review queue rather than as a
// HIGH PR comment. NOT skip (we genuinely cannot confirm); NOT HIGH
// (the verify*Payload signal is strong).
import { NextResponse } from "next/server";
import { verifyApplePayload } from "@/lib/apple/verify";
import { processAppleNotification } from "@/lib/apple/notifications";

export async function POST(req: Request) {
  const payload = await req.json();
  const verified = await verifyApplePayload(payload.signedPayload);
  if (!verified) {
    return new Response("Invalid signature", { status: 401 });
  }
  await processAppleNotification(payload);
  return NextResponse.json({ ok: true });
}
