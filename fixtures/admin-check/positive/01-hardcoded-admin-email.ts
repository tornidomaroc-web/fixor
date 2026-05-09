import type { Request, Response, NextFunction } from "express";

const ADMIN_EMAIL = "founder@acme.app";

interface AuthRequest extends Request {
  user?: { id: string; email: string };
}

export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const email = req.user?.email ?? "";
  if (email === ADMIN_EMAIL || email === "engineering@acme.app") {
    next();
    return;
  }
  res.status(403).json({ error: "forbidden" });
}
