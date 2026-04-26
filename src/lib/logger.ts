/**
 * Structured logger for Fixor.
 *
 * - JSON output in production (Railway logs are searchable / parseable
 *   in this format; Sentry breadcrumbs in 5A-6 will lift them too).
 * - pino-pretty colorized output in development.
 * - Redaction of known-sensitive env values + auth headers; if you add
 *   a new secret env, also add it to `sensitivePaths` below.
 *
 * Usage:
 *   import { logger } from "../lib/logger";
 *   logger.info({ installationId, repo }, "scan started");
 *   logger.warn({ err }, "recordCost failed");
 *
 * Pino convention: the OBJECT comes first (context), then the message
 * string. This is the reverse of `console.log`.
 */
import pino, { type Logger as PinoLogger } from "pino";

const isProd = process.env.NODE_ENV === "production";

const sensitivePaths = [
  // Top-level keys (defensive — should never be logged directly).
  "ANTHROPIC_API_KEY",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_TOKEN",
  "GITHUB_WEBHOOK_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_API_KEY",
  "DATABASE_URL",
  // Same keys nested one level deep — common when logging an
  // env / config object.
  "*.ANTHROPIC_API_KEY",
  "*.GITHUB_APP_PRIVATE_KEY",
  "*.GITHUB_TOKEN",
  "*.GITHUB_WEBHOOK_SECRET",
  "*.STRIPE_SECRET_KEY",
  "*.STRIPE_WEBHOOK_SECRET",
  "*.STRIPE_API_KEY",
  "*.DATABASE_URL",
  // Auth-bearing headers when we log a request object.
  "headers.authorization",
  "*.headers.authorization",
  "headers['x-hub-signature-256']",
  "*.headers['x-hub-signature-256']",
];

export const logger: PinoLogger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
  redact: { paths: sensitivePaths, censor: "[REDACTED]" },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }),
});

/** Bind a context (installation, repo, scan id) to a child logger. */
export function childLogger(
  context: Record<string, unknown>,
): PinoLogger {
  return logger.child(context);
}
