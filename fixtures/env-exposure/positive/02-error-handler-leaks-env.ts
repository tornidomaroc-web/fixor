// ASSUMED-PATH: src/app/handlers/env-exposure/02-error-handler-leaks-env.ts
import type { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  res.status(500).json({
    error: err.message,
    stack: err.stack,
    env: process.env,
    requestedAt: new Date().toISOString(),
  });
}
