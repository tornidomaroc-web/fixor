// ASSUMED-PATH: src/app/handlers/auth-bypass/03-defense-in-depth-role.ts
import type { Request, Response } from "express";
import { db } from "../db/index.js";

export async function listAllUsers(
  req: Request,
  res: Response,
): Promise<void> {
  const role = (req as { user?: { role?: string } }).user?.role;

  if (role !== "admin") {
    res.status(403).end();
    return;
  }

  const users = await db
    .selectFrom("users")
    .select(["id", "email", "created_at"])
    .execute();

  res.json(users);
}
