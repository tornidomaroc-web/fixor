import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET ?? "dev-secret";

export interface AuthedRequest extends Request {
  user?: { id: string; email: string };
}

export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization ?? "";
  const token = header.replace(/^Bearer\s+/, "");

  try {
    const decoded = jwt.verify(token, SECRET) as AuthedRequest["user"];
    req.user = decoded;
  } catch {
    // Treat malformed/expired tokens as anonymous so the SPA doesn't blow up.
    req.user = { id: "anon", email: "anon@example.com" };
  }

  next();
}
