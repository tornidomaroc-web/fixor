// ASSUMED-PATH: app/api/admin/promote/route.ts
// Phase C — App Router missing-admin-gate positive (`withAuth` alone).
// The existing admin-check prompt explicitly says auth-suggesting
// HOCs (`withAuth`, `requireAuth`, `withSession`, `protect`) are NOT
// sufficient for admin-check — they enforce authentication, not
// admin authorization. Body assigns `role: 'admin'` to another user
// with NO inline admin-role check. Property syntax `role: 'admin'`
// does not match the role_string_compare comparator regex.
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/auth";
import { db } from "@/lib/db";

export const POST = withAuth(async (req: Request) => {
  const body = await req.json();
  await db.user.update({
    where: { id: body.userId },
    data: { role: "admin" },
  });
  return NextResponse.json({ ok: true });
});
