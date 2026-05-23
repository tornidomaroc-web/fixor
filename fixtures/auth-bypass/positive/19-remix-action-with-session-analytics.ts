// ASSUMED-PATH: app/routes/api.invoices.$id.destroy.ts
// Phase E — Remix v2 missing-HOC-wrapper positive (session-substring
// HOC that does NOT enforce auth — the A3 false-negative class).
// `withSessionAnalytics` contains "session" as a substring but the
// body only sets a tracking cookie and fires an analytics event; it
// makes NO authorization decision (no 401 on missing session, no
// ownership filter keyed on session.user.id in the destructive
// query). Parallel to the App Router AB-P3
// (14-app-router-with-session-analytics.ts) transposed to Remix.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { withSessionAnalytics } from "~/lib/middleware/session-analytics.server";
import { db } from "~/lib/db.server";

export const action = withSessionAnalytics(
  async ({ params }: ActionFunctionArgs) => {
    await db.invoice.delete({ where: { id: params.id } });
    return json({ ok: true });
  },
);
