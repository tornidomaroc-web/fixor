// ASSUMED-PATH: app/routes/admin.users.$id.promote.ts
// Phase E — Remix v2 missing-admin-HOC-wrapper positive.
// `withAuth` enforces authentication but is NOT sufficient for admin
// authorization — admin gating requires a stricter check. Handler
// performs an admin user-promotion (role change to "admin") with NO
// admin-suggesting HOC and NO inline admin-role check in the body.
// Parallel to App Router AC-P3 (13-app-router-with-auth-only-admin-action.ts)
// transposed to Remix v2 action shape.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { withAuth } from "~/services/auth.server";
import { db } from "~/lib/db.server";

export const action = withAuth(async ({ params }: ActionFunctionArgs) => {
  await db.user.update({
    where: { id: params.id },
    data: { role: "admin" },
  });
  return json({ ok: true });
});
