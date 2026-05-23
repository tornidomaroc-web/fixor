// ASSUMED-PATH: app/api/hooks/lemon/route.ts
// Phase C — App Router webhook positive (DIY-HMAC half-stub). Path
// contains `/hooks/` segment → webhook. Body imports `createHmac`
// from node:crypto and COMPUTES an `expected` signature but never
// reads any incoming signature header and never compares against
// `expected`. The HMAC computation is dead code; the body proceeds
// to process events as if verified. This is the shape a half-
// finished refactor produces — and the shape a customer paying for
// Fixor most wants to see flagged.
import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";

interface LemonEvent {
  meta: { event_name: string };
  data: { id: string };
}

async function processLemonEvent(event: LemonEvent): Promise<void> {
  void event;
}

export async function POST(req: Request) {
  const raw = await req.text();
  const expected = createHmac("sha256", process.env.LEMON_WEBHOOK_SECRET!)
    .update(raw)
    .digest("hex");
  void expected;
  const event = JSON.parse(raw) as LemonEvent;
  await processLemonEvent(event);
  return NextResponse.json({ ok: true });
}
