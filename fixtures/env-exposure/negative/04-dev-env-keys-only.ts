// ASSUMED-PATH: src/app/handlers/env-exposure/04-dev-env-keys-only.ts
import type { Request, Response } from "express";
import { Router } from "express";

const router = Router();

router.get("/__dev/env", (_req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).end();
    return;
  }
  res.type("text/plain").send(Object.keys(process.env).sort().join("\n"));
});

export default router;
