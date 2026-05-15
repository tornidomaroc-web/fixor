// ASSUMED-PATH: src/app/handlers/env-exposure/01-admin-env-gated.ts
import type { Request, Response } from "express";
import { Router } from "express";
import { requireAdmin } from "../middleware/require-admin.js";

const router = Router();

router.get("/admin/env", requireAdmin, (_req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).end();
    return;
  }
  const safeKeys = ["NODE_ENV", "PORT", "LOG_LEVEL"];
  const subset = Object.fromEntries(
    safeKeys
      .filter((k) => process.env[k] !== undefined)
      .map((k) => [k, process.env[k]]),
  );
  res.json(subset);
});

export default router;
