// ASSUMED-PATH: src/app/handlers/env-exposure/04-admin-runtime-no-prod-check.ts
import type { Request, Response } from "express";
import { Router } from "express";

const router = Router();

// /admin/runtime -- designed for dev. There used to be a NODE_ENV check
// here but it was removed when the dev tools moved into the main app.
router.get("/admin/runtime", (_req: Request, res: Response) => {
  res.json({
    env: process.env,
    versions: process.versions,
    uptime: process.uptime(),
  });
});

export default router;
