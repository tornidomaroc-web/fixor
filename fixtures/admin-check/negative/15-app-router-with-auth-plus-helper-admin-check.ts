// ASSUMED-PATH: app/api/admin/seats/route.ts
// Phase C — helper-call admin-check negative (AC-N4). Symmetric to
// negative/13 (inline-check anchor); together they cover the two
// shapes admin-tier-with-gating takes in real codebases. Here the
// admin authorization is pulled into a shared utility, leaving the
// handler body with only `await requireAdminRole()` — no visible
// `session.user.role` read, no `'admin'` string literal, no
// comparison. The LLM has nothing analogous to read; it must
// recognize the helper name `requireAdminRole` as gating by name
// convention (the prompt-tuning target for this fixture).
//
// Pre-emption note: no role-string-compare, no body-role-check, no
// email patterns. Route-def is the first and only prefilter hit.
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/auth";
import { requireAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";

export const PUT = withAuth(async (req: Request) => {
  await requireAdminRole();
  const body = await req.json();
  await db.organizationSeat.update({
    where: { id: body.seatId },
    data: { capacity: body.capacity },
  });
  return NextResponse.json({ ok: true });
});
