/**
 * Sentry initialization — MUST be imported before anything else.
 *
 * Sentry's auto-instrumentation hooks Node's http/https/postgres modules
 * at init time. Anything imported BEFORE Sentry.init runs misses the
 * hook. This file is therefore loaded as the very first import in every
 * runtime entry point (webhook-server.ts, db/migrate.ts when relevant).
 *
 * No-op if SENTRY_DSN is not set, so local dev / tests run without any
 * Sentry chatter.
 */
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN?.trim();

if (dsn) {
  const release =
    process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ??
    process.env.GIT_COMMIT_SHA?.slice(0, 12) ??
    undefined;

  const tracesSampleRate = Number.parseFloat(
    process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1",
  );

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release,
    tracesSampleRate: Number.isFinite(tracesSampleRate)
      ? tracesSampleRate
      : 0.1,
    // Don't auto-include user IPs / cookies / headers. We send only
    // what we explicitly attach via setTag / startSpan attributes.
    sendDefaultPii: false,
  });
}
