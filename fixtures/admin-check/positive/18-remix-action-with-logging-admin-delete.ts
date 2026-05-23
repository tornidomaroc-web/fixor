// ASSUMED-PATH: app/routes/admin.users.$id.delete.ts
// Phase E — Remix v2 missing-admin-HOC-wrapper positive.
// `withLogging` is an observability HOC (no admin/auth substring);
// per the admin-check prompt's case 3, generic-non-admin HOCs do NOT
// gate. Handler performs admin user-delete keyed on URL params with
// no inline admin-role check. Parallel to App Router AC-P5
// (15-app-router-with-auth-plus-non-admin-helper.ts) shape but with
// no auth at all, transposed to Remix v2 action.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { withLogging } from "~/lib/middleware/logging.server";
import { db } from "~/lib/db.server";

export const action = withLogging(async ({ params }: ActionFunctionArgs) => {
  await db.user.delete({ where: { id: params.id } });
  return json({ ok: true });
});
