// ASSUMED-PATH: src/app/handlers/auth-bypass/04-role-fallback-admin.ts
import type { Request, Response } from "express";
import { db } from "../db/index.js";

interface AuthRequest extends Request {
  user?: { id: string; role?: "admin" | "member" | "guest" };
}

/**
 * GET /api/team/audit-log
 * Returns the full audit log. Restricted to admins.
 */
export async function getAuditLog(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const role = req.user?.role || "admin";
  if (role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const rows = await db
    .selectFrom("audit_log")
    .selectAll()
    .orderBy("created_at", "desc")
    .limit(500)
    .execute();

  res.json(rows);
}
