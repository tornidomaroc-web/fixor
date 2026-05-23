// ASSUMED-PATH: app/routes/api.subscriptions.$id.cancel.ts
// Phase E — Remix v2 missing-HOC-wrapper positive.
// Bare `export const action` performing a destructive cancel on a
// subscription identified solely by URL params, with NO higher-order
// wrapper and NO inline auth check in the body. Parallel to the App
// Router AB-P1 shape (12-app-router-with-logging-destructive.ts)
// transposed to Remix v2's loader/action route convention.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { db } from "~/lib/db.server";

export const action = async ({ params }: ActionFunctionArgs) => {
  await db.subscription.update({
    where: { id: params.id },
    data: { canceledAt: new Date() },
  });
  return json({ ok: true });
};
