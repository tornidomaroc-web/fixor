// ASSUMED-PATH: app/api/admin/users/promote/route.ts
// Phase C — B1 mandatory App Router missing-admin-gate negative.
// Wrapper name `withAdmin` carries the "admin" substring and is the
// canonical admin-suggesting HOC. The wrapper-name signal alone
// resolves the gating question; no inline check needed.
import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/middleware/admin";
import { db } from "@/lib/db";

export const POST = withAdmin(async (req: Request) => {
  const body = await req.json();
  await db.user.update({
    where: { id: body.userId },
    data: { role: "admin" },
  });
  return NextResponse.json({ ok: true });
});
