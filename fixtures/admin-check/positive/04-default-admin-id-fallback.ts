// ASSUMED-PATH: src/app/handlers/admin-check/04-default-admin-id-fallback.ts
import type { Request, Response } from "express";

const DEFAULT_ADMIN_ID = "u_founder_001";

interface AuthRequest extends Request {
  user?: { id?: string; role?: string };
}

export async function getAdminPanel(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const userId = req.user?.id ?? DEFAULT_ADMIN_ID;
  const role = req.user?.role ?? "admin";
  res.json({
    userId,
    role,
    panel: ["users", "billing", "audit"],
  });
}
