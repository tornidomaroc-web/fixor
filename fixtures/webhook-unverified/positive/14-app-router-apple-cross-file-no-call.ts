// ASSUMED-PATH: app/api/apple/webhook/route.ts
// Phase F — App Router webhook positive, class (c) cross-file-verifier
// symmetric POSITIVE anchor to negative/14-app-router-apple-cross-file-
// verifier-helper.ts. Mirrors the inbox-zero apple/webhook FP class:
// same path-segment, same import shape, but this fixture performs NO
// verification at all — no helper call, no inline timingSafeEqual, no
// signature-header read, no compare. The handler reads the body and
// dispatches downstream work directly. Must FLAG HIGH so the Phase F
// tune that lowers cross-file-helper calls to MEDIUM does NOT over-
// generalize to "skip everything in /apple/webhook/". The differ-by-
// one-feature pairing with negative/14 is the symmetric-anchor
// discipline carried forward from Phase C.
import { NextResponse } from "next/server";
import { processAppleNotification } from "@/lib/apple/notifications";

export async function POST(req: Request) {
  const payload = await req.json();
  await processAppleNotification(payload);
  return NextResponse.json({ ok: true });
}
