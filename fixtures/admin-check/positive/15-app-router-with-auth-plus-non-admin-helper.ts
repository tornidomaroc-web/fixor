// ASSUMED-PATH: app/api/admin/seats/route.ts
// Phase C — AC-P4 symmetric anchor to negative/15 (AC-N4). Same
// structural shape as AC-N4 except the helper call is a non-auth
// observability helper (logAccess), not the admin-suggesting
// requireAdminRole. The handler still performs an admin-tier op
// (assigning a role) with no inline role check. The admin-check
// helper-call rule requires the helper NAME to suggest admin
// enforcement; a non-admin helper invoked before the privileged
// op does NOT count as gating. This fixture must FLAG.
//
// Without this anchor, AC-N4's "admin-suggesting helper gates"
// behavior has no opposite TP guard — a future model regression
// that collapsed the helper-call rule back to "any helper call
// gates" would let AC-N4 keep skipping for the wrong reason and
// the test suite would not catch it. AC-P4 closes that asymmetry,
// same shape as AB-P3/AB-N2 (session-substring) and WH-N1/WH-P3
// (signature-vs-cache-hash).
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/auth";
import { logAccess } from "@/lib/logging";
import { db } from "@/lib/db";

export const PUT = withAuth(async (req: Request) => {
  await logAccess(req);
  const body = await req.json();
  await db.user.update({
    where: { id: body.userId },
    data: { role: "admin" },
  });
  return NextResponse.json({ ok: true });
});
