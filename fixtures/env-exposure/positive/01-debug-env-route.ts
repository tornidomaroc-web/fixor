// ASSUMED-PATH: src/app/handlers/env-exposure/01-debug-env-route.ts
import type { Request, Response } from "express";
import { Router } from "express";

const router = Router();

// GET /api/debug/env
// Returns runtime configuration so the SPA settings page can show what's
// loaded.
router.get("/api/debug/env", (_req: Request, res: Response) => {
  res.json({
    env: process.env,
    nodeVersion: process.version,
    platform: process.platform,
  });
});

export default router;
