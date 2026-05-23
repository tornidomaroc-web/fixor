// ASSUMED-PATH: app/api/accounts/route.ts
// Phase C — App Router missing-HOC-wrapper positive.
// Deceptive generic-named HOC (withRoute) hides nothing visible in
// this file; per the documented limitation, generic-named wrappers
// are treated as ungated by default. Body performs a destructive
// db.account.deactivate with no inline auth signal. The handler is
// authored as an inline arrow function so the route-def trigger sits
// at file character index ~0.
import { NextResponse } from "next/server";
import { withRoute } from "@/lib/middleware/route";
import { db } from "@/lib/db";

export const DELETE = withRoute(async (req: Request) => {
  const body = await req.json();
  await db.account.deactivate({ where: { id: body.accountId } });
  return NextResponse.json({ ok: true });
});
