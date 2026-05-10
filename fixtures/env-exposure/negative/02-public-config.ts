// ASSUMED-PATH: src/app/handlers/env-exposure/02-public-config.ts
import type { Request, Response } from "express";
import { Router } from "express";

const router = Router();

interface PublicConfig {
  apiBaseUrl: string;
  region: string;
  appVersion: string;
}

router.get("/api/config", (_req: Request, res: Response) => {
  const config: PublicConfig = {
    apiBaseUrl: process.env.PUBLIC_API_BASE_URL ?? "https://api.acme.app",
    region: process.env.AWS_REGION ?? "us-east-1",
    appVersion: process.env.APP_VERSION ?? "dev",
  };
  res.json(config);
});

export default router;
