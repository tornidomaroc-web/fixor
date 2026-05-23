// ASSUMED-PATH: app/api/stripe/webhook/route.ts
// Phase C — App Router webhook positive (path-signal class). File
// path contains `/webhook/` segment → unambiguous webhook handler.
// Body reads the request body and processes events with NO
// signature verification: no constructEvent, no timingSafeEqual,
// no signature-header read. Classic missing-verification shape on
// a Next.js App Router route.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const event = await req.json();
  await db.stripeEvent.create({ data: event });
  return NextResponse.json({ ok: true });
}
