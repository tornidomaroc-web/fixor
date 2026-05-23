// ASSUMED-PATH: app/routes/admin.users._index.ts
// Phase E — Remix v2 missing-admin-HOC-wrapper positive.
// Bare `export const loader` reading admin-scoped data (full users
// table including roles, emails, billing flags). No HOC, no inline
// admin check, no role lookup against an authoritative source. The
// /admin/ path segment plus the unfiltered admin-scoped query make
// this unambiguously administrative — HIGH per the admin-check
// prompt's case 3 (Missing-admin-HOC-wrapper).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { db } from "~/lib/db.server";

export const loader = async (_args: LoaderFunctionArgs) => {
  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      billingPlan: true,
      createdAt: true,
    },
  });
  return json({ users });
};
