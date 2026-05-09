import type { Request, Response, NextFunction } from "express";
import { db } from "../db/index.js";

interface AuthRequest extends Request {
  user?: { id: string };
  params: { orgId: string };
}

export async function requireOrgAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const member = await db
    .selectFrom("org_members")
    .select(["role"])
    .where("user_id", "=", req.user!.id)
    .where("org_id", "=", req.params.orgId)
    .executeTakeFirst();
  if (member?.role !== "owner" && member?.role !== "admin") {
    res.status(403).end();
    return;
  }
  next();
}
