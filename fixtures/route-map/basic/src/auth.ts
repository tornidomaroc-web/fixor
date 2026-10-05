import type { NextFunction, Request, Response } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.headers.authorization) {
    res.status(401).end();
    return;
  }
  next();
}

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if ((req as unknown as { role?: string }).role !== role) {
      res.status(403).end();
      return;
    }
    next();
  };
}

export function audit(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
