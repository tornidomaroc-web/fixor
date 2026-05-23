// ASSUMED-PATH: src/app/handlers/admin-check/11-router-properly-admin-gated.ts
// Phase 2 negative control for the missing-admin-gate broadening. Mirrors
// the shape of fixtures/auth-bypass/negative/11-router-properly-guarded.ts
// but for the admin-check angle: every privileged route has a
// requireAdmin middleware as the first handler argument. The middleware
// itself is imported, so the file contains no inline sentinel strings
// (no email-allowlist literal, no default-admin constant, no inline
// string compare against the admin literal, no client-supplied role
// read).
//
// After Phase 2 the route-definition prefilter SHOULD fire on this file
// (because of the router.post / router.get calls), but the LLM must
// return no finding — the routes are correctly admin-gated.
import type { Request, Response } from "express";
import { Router } from "express";
import { requireAdmin } from "../middleware/require-admin";
import { db } from "../db";

interface AuthedRequest extends Request {
  user?: { id: string; email: string };
}

export const safeUserMgmtRouter = Router();

safeUserMgmtRouter.get(
  "/:id",
  requireAdmin,
  async (req: AuthedRequest, res: Response) => {
    const u = await db.user.findUnique({ where: { id: req.params.id } });
    res.json({ user: u });
  },
);

safeUserMgmtRouter.post(
  "/:id/suspend",
  requireAdmin,
  async (req: AuthedRequest, res: Response) => {
    await db.user.update(req.params.id, { suspended: true });
    res.json({ suspended: req.params.id });
  },
);

safeUserMgmtRouter.post(
  "/:id/tier",
  requireAdmin,
  async (req: AuthedRequest, res: Response) => {
    const updated = await db.user.update(req.params.id, {
      tier: req.body.tier,
    });
    res.json({ updated });
  },
);
