import type { Request, Response, NextFunction } from "express";
import { db } from "../db/index.js";

interface AuthRequest extends Request {
  user?: { id: string };
}

export async function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).end();
    return;
  }
  const row = await db
    .selectFrom("user_roles")
    .select("role")
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (row?.role !== "admin") {
    res.status(403).end();
    return;
  }
  next();
}
