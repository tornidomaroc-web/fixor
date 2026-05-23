// ASSUMED-PATH: app/routes/api.users.$id.delete.ts
// Phase E — Remix v2 missing-HOC-wrapper positive.
// `export const action` wrapped in `withLogging` (observability HOC,
// no auth/admin/session substring in name) performing db.user.delete
// keyed on URL params, no inline auth check in the body. Generic-non-
// auth HOCs do not count as gating per the auth-bypass prompt's case 3
// (Missing-HOC-wrapper on file-system-routed frameworks).
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { withLogging } from "~/lib/middleware/logging.server";
import { db } from "~/lib/db.server";

export const action = withLogging(async ({ params }: ActionFunctionArgs) => {
  await db.user.delete({ where: { id: params.id } });
  return json({ ok: true });
});
