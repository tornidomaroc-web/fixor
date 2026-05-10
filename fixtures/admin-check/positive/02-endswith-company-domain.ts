// ASSUMED-PATH: src/app/handlers/admin-check/02-endswith-company-domain.ts
import type { Request, Response, NextFunction } from "express";

export function isInternalUser(email: string): boolean {
  return email.endsWith("@acme.app") || email.endsWith("@acme-test.app");
}

export function requireInternal(
  req: Request & { user?: { email?: string } },
  res: Response,
  next: NextFunction,
): void {
  const email = req.user?.email ?? "";
  if (!isInternalUser(email)) {
    res.status(403).json({ error: "internal users only" });
    return;
  }
  next();
}
