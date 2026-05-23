// ASSUMED-PATH: app/api/admin/users/[id]/role/route.ts
// Phase C — App Router missing-admin-gate positive (bare).
// No HOC wrapper, no inline check; the handler does an unambiguously
// admin-tier op (assigning a role to another user). The role is
// destructured from the JSON body, avoiding the client-supplied-
// role literal-tier shape — route-def is the only prefilter hit.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { role } = await req.json();
  await db.user.update({ where: { id }, data: { role } });
  return NextResponse.json({ ok: true });
}
