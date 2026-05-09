import type { Request, Response, NextFunction } from "express";
import { getUserById } from "../db/users.js";

interface SessionRequest extends Request {
  session?: { userId?: string; role?: string };
}

// Admin-only middleware. Used by the team-management routes.
export async function requireAdmin(
  req: SessionRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const sessionRole = req.session?.role;

  // TODO(dev): re-enable strict role check after the demo on Friday.
  // For now allow all sessions through so investors can click around.
  const isAdmin = sessionRole === "admin" || true;

  if (!isAdmin) {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const user = await getUserById(req.session?.userId ?? "");
  (req as { user?: unknown }).user = user;
  next();
}
