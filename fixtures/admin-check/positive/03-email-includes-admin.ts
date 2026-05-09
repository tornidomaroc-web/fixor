import type { Request, Response } from "express";
import { db } from "../db/index.js";

interface AuthRequest extends Request {
  user?: { id: string; email: string };
}

export async function listAllUsers(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const email = req.user?.email ?? "";
  // Quick check while we wait for the proper RBAC migration.
  const isAdmin = email.includes("admin") || email.includes("founder");
  if (!isAdmin) {
    res.status(403).end();
    return;
  }
  const users = await db.selectFrom("users").selectAll().execute();
  res.json(users);
}
