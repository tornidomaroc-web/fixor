// ASSUMED-PATH: src/app/handlers/auth-bypass/11-router-properly-guarded.ts
// Negative control for the Phase 1 missing-middleware fix.
// EVERY destructive route on this router has requireAuth as the
// first handler argument. After we broaden the prefilter with
// route-definition sentinels, this file SHOULD still trigger the
// prefilter (because router.post/.get appear) but the LLM must
// return no finding — the routes are correctly guarded.
import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { db } from "../db";

export const teamRouter = Router();

teamRouter.get("/teams", requireAuth, async (_req: AuthedRequest, res) => {
  res.json({ teams: ["team_1", "team_2"] });
});

teamRouter.post(
  "/teams/:id/rename",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const renamed = await db.team.update(req.params.id, {
      name: req.body.name,
    });
    res.json({ renamed });
  },
);

teamRouter.post(
  "/teams/:id/delete",
  requireAuth,
  async (req: AuthedRequest, res) => {
    await db.team.delete(req.params.id);
    res.json({ deleted: req.params.id });
  },
);
