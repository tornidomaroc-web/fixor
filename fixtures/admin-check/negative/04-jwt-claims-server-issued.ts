// ASSUMED-PATH: src/app/handlers/admin-check/04-jwt-claims-server-issued.ts
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

type Role = "owner" | "admin" | "member";

interface ClaimSet {
  sub: string;
  role: Role;
  iss: "auth.acme.app";
}

const SECRET = process.env.JWT_SIGNING_KEY!;

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/, "");
  let claims: ClaimSet;
  try {
    claims = jwt.verify(token, SECRET, { issuer: "auth.acme.app" }) as ClaimSet;
  } catch {
    res.status(401).end();
    return;
  }
  if (claims.role !== "admin" && claims.role !== "owner") {
    res.status(403).end();
    return;
  }
  next();
}
