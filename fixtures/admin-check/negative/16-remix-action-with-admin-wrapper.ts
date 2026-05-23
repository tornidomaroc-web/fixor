// ASSUMED-PATH: app/routes/admin.tenants.$id.settings.ts
// Phase E — Remix v2 missing-admin-HOC-wrapper negative.
// `withAdmin` identifier name contains "admin" as a substring, which
// qualifies as auto-gating by name convention per the admin-check
// prompt's case 3. Handler performs an admin tenant-settings update.
// Auth-suggesting HOC by name; no further admin check needed in the
// body.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { withAdmin } from "~/services/auth.server";
import { db } from "~/lib/db.server";

export const action = withAdmin(async ({ params, request }: ActionFunctionArgs) => {
  const body = await request.json();
  await db.tenant.update({
    where: { id: params.id },
    data: { settings: body.settings },
  });
  return json({ ok: true });
});
