// ASSUMED-PATH: app/routes/admin.audit-log._index.ts
// Phase E — Remix v2 missing-admin-HOC-wrapper negative.
// No HOC wrapper, but body has explicit DB-backed RBAC: looks up
// user.role from user_roles table after session auth, returns 403 on
// non-admin. The role comes from an authoritative store, not from a
// hardcoded string match or client-supplied value.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { requireUser } from "~/services/auth.server";
import { db } from "~/lib/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const role = await db.userRole.findUnique({ where: { userId: user.id } });
  if (role?.role !== "admin") {
    return json({ error: "Forbidden" }, { status: 403 });
  }
  const events = await db.auditEvent.findMany({ orderBy: { ts: "desc" }, take: 100 });
  return json({ events });
};
