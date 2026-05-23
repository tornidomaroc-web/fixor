// ASSUMED-PATH: app/api/profile/route.ts
// Phase C — symmetric session-FOR-AUTH true-negative anchor for A3.
// Wrapper name `withSession` carries the IDENTICAL surface signal as
// the A3 false-negative fixture (withSessionAnalytics): both contain
// "session" as a substring. The body is the only discriminator —
// here the body USES the session for an authorization decision
// (401 on missing session) and for the scope filter (update WHERE
// id = session.user.id). The tightened auth-bypass prompt rule must
// continue to skip this fixture while now correctly flagging the
// A3 positive.
import { NextResponse } from "next/server";
import { withSession } from "@/lib/middleware/session";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const PUT = withSession(async (req: Request) => {
  const session = await getSession();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = await req.json();
  await db.user.update({
    where: { id: session.user.id },
    data: { displayName: body.displayName },
  });
  return NextResponse.json({ ok: true });
});
