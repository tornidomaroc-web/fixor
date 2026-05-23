// ASSUMED-PATH: src/app/handlers/auth-bypass/11-admin-router-mixed-guards.ts
// Mirrors the shape of fixor-demo/src/routes/admin.ts at commit 4270a02:
// two requireAuth-guarded routes plus one destructive route whose
// middleware argument was forgotten. The third route silently runs
// unauthenticated.
import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { db } from "../db";

export const adminRouter = Router();

// List all users.
adminRouter.get("/users", requireAuth, async (_req: AuthedRequest, res) => {
  res.json({ users: ["usr_1", "usr_2"] });
});

// Update a user's email address.
adminRouter.post(
  "/users/:id/email",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const updated = await db.user.update(req.params.id, {
      email: req.body.email,
    });
    res.json({ updated });
  }
);

// Permanently delete a user account.
// BUG: forgot to add requireAuth — anyone can wipe accounts.
adminRouter.post("/users/delete", async (req, res) => {
  const userId = req.body.userId;
  await db.user.delete(userId);
  res.json({ deleted: userId });
});
