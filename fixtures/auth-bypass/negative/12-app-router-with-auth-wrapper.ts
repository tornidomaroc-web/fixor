// ASSUMED-PATH: app/api/notifications/route.ts
// Phase C — App Router missing-HOC-wrapper negative (auth-suggesting
// name + body-level session-scoped op). Wrapper name `withAuth` is
// in the gated-by-name-convention list; body unambiguously uses the
// authenticated session for both the auth gate (401 on no session)
// and the scope filter (deleteMany WHERE userId = session.user.id).
// Two independent gating signals.
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const POST = withAuth(async (_req: Request) => {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }
  await db.notification.deleteMany({ where: { userId: session.user.id } });
  return NextResponse.json({ ok: true });
});
