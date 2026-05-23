// ASSUMED-PATH: app/routes/account.profile.ts
// Phase E — Remix v2 missing-HOC-wrapper negative.
// `requireUser` from remix-auth is the conventional auth-suggesting
// pattern in the Remix ecosystem (Next.js's `requireAuth` /
// `getServerSession` equivalent). The wrapper-by-name discipline must
// recognize it: identifier name contains "require" + "user" suggesting
// auth enforcement, and the body uses the returned user identity for
// the scoped read. Two independent gating signals.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { requireUser } from "~/services/auth.server";
import { db } from "~/lib/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const profile = await db.profile.findUnique({ where: { userId: user.id } });
  return json({ profile });
};
