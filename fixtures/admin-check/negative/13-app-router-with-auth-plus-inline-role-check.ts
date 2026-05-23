// ASSUMED-PATH: app/api/admin/billing/route.ts
// Phase C — inline-admin-check negative (auth-suggesting wrapper +
// visible inline role check). The wrapper authenticates but does
// not authorize as admin; the body adds an explicit role check
// BEFORE the destructive op. Existing admin-check prompt: inline
// admin checks in the handler body count as gating.
//
// Pre-emption note: the body's inline role comparison matches a
// judgment-tier prefilter, but because the handler is authored as
// an inline arrow function inside the wrapper, the route-def export
// sits at file character index ~0 and the inline match sits deeper
// in the body; admin-check's earliest-by-index prefilter resolves
// to route-def. Do NOT refactor the handler into a named const
// above the export — that would push route-def below the inline
// comparison.
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const PUT = withAuth(async (req: Request) => {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }
  const body = await req.json();
  await db.organizationBilling.update({
    where: { orgId: body.orgId },
    data: { plan: body.plan },
  });
  return NextResponse.json({ ok: true });
});
