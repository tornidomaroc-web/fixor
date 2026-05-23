// ASSUMED-PATH: app/api/users/route.ts
// Phase C — App Router missing-HOC-wrapper positive.
// withLogging is an observability wrapper (no auth/admin/session
// substring in name); per the auth-bypass prompt, generic-non-auth
// HOCs do NOT count as gating. The handler performs a destructive
// db.user.delete and contains no session read, no inline auth check,
// no role check. The route-def trigger is the only prefilter hit.
import { NextResponse } from "next/server";
import { withLogging } from "@/lib/middleware/logging";
import { db } from "@/lib/db";

export const POST = withLogging(async (req: Request) => {
  const body = await req.json();
  await db.user.delete({ where: { id: body.userId } });
  return NextResponse.json({ ok: true });
});
