// ASSUMED-PATH: src/app/handlers/admin-check/11-missing-admin-gate-role-change.ts
// Phase 2 missing-admin-gate fixture: a router file where sibling routes
// gate privileged actions behind an imported admin middleware, but the
// role-change route was added later and the admin gate was forgotten.
// The handler reads the new role from the request body and writes it
// directly to the database, giving any authenticated user the ability to
// promote themselves.
//
// Before Phase 2 this file fired ZERO admin-check prefilter sentinels:
// no hardcoded-admin keyword, no email-allowlist, no default-admin
// constant, no nullish-coalescing fallback, no client-role property
// matching the body_role_check regex (the field is `newRole`, not
// `role` / `userRole` / `adminRole`), no inline string compare against
// the admin literal. The whole file was silently dropped by the regex
// prefilter. Phase 2 closes the gap by adding the same route-definition
// sentinel auth-bypass got in Phase 1, so admin-check reaches the LLM
// with the full file and the LLM can compare the unguarded route
// against its guarded siblings.
import type { Request, Response } from "express";
import { Router } from "express";
import { requireAdmin } from "../middleware/require-admin";
import { db } from "../db";

interface AuthedRequest extends Request {
  user?: { id: string; email: string };
}

export const userMgmtRouter = Router();

// Get a user — admins only (sibling, properly gated).
userMgmtRouter.get(
  "/:id",
  requireAdmin,
  async (req: AuthedRequest, res: Response) => {
    const u = await db.user.findUnique({ where: { id: req.params.id } });
    res.json({ user: u });
  },
);

// Suspend a user — admins only (sibling, properly gated).
userMgmtRouter.post(
  "/:id/suspend",
  requireAdmin,
  async (req: AuthedRequest, res: Response) => {
    await db.user.update(req.params.id, { suspended: true });
    res.json({ suspended: req.params.id });
  },
);

// Change a user's tier (member / pro / admin).
// BUG: forgot the requireAdmin middleware AND there is no admin check in
// the handler body. Any authenticated caller can promote arbitrary users
// to the admin tier by POSTing a body with the admin tier name in the
// tier field.
userMgmtRouter.post(
  "/:id/tier",
  async (req: AuthedRequest, res: Response) => {
    const updated = await db.user.update(req.params.id, {
      tier: req.body.tier,
    });
    res.json({ updated });
  },
);
