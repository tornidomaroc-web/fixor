// ASSUMED-PATH: src/app/handlers/env-exposure/04-admin-runtime-no-prod-check.ts
import type { Request, Response } from "express";
import { Router } from "express";

const router = Router();

router.get("/admin/runtime", (_req: Request, res: Response) => {
  res.json({
    env: process.env,
    versions: process.versions,
    uptime: process.uptime(),
  });
});

export default router;
