// ASSUMED-PATH: app/api/admin/users/[id]/route.ts
// Phase C — App Router missing-admin-gate positive (generic HOC).
// Wrapper name `withRoute` carries no admin substring; the
// documented limitation treats generic-named wrappers as ungated
// by default. Body performs an admin-tier user deletion. No inline
// admin check.
import { NextResponse } from "next/server";
import { withRoute } from "@/lib/middleware/route";
import { db } from "@/lib/db";

export const DELETE = withRoute(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await db.user.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
);
