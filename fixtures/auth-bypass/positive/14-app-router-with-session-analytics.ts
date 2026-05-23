// ASSUMED-PATH: app/api/invoices/route.ts
// Phase C — A3 LOAD-BEARING FALSE-NEGATIVE class.
// withSessionAnalytics is an analytics-tracking HOC. The wrapper name
// contains "session" as a substring (so the current auth-bypass
// prompt's substring-pass rule would let it through as gated), but
// the body proves it does NOT enforce auth: it sets a tracking
// cookie, fires an analytics event, and runs a destructive
// db.invoice.delete with NO session read, NO getServerSession,
// NO auth() call, NO authorization decision keyed on any session
// value. Phase C must tighten the prompt so the body — not the
// wrapper name — decides whether session is gating.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { withSessionAnalytics } from "@/lib/middleware/session-analytics";
import { db } from "@/lib/db";
import { analytics } from "@/lib/analytics";

function generateAnalyticsId(): string {
  return Math.random().toString(36).slice(2);
}

export const POST = withSessionAnalytics(async (req: Request) => {
  const body = await req.json();
  cookies().set("sid", generateAnalyticsId());
  analytics.track("invoice.destroy", body);
  await db.audit.create({
    data: { userId: body.userId, action: "destroy", target: body.invoiceId },
  });
  await db.invoice.delete({ where: { id: body.invoiceId } });
  return NextResponse.json({ ok: true });
});
