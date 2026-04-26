/**
 * Health-check helpers for /health and /ready endpoints.
 *
 * Design choices:
 * - DB check is a real `select 1` round-trip (cheap, catches connection-
 *   level outages and credential rotations).
 * - Anthropic check is a config-only probe — we verify the API key is
 *   present and has the expected `sk-ant-` prefix. We do NOT round-trip
 *   to Anthropic itself: every probe would burn $0+ in admin overhead
 *   and add a hard dependency on Anthropic's uptime to our own. Real
 *   API failures are surfaced via Sentry from the actual scan path
 *   (5A-6's captureException covers this).
 * - Both helpers swallow exceptions and return a discrete status string
 *   so a flapping dependency cannot crash /health itself.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client";

export type ComponentStatus = "ok" | "degraded";

export async function pingDb(): Promise<ComponentStatus> {
  try {
    await db().execute(sql`select 1`);
    return "ok";
  } catch {
    return "degraded";
  }
}

export function pingAnthropic(): ComponentStatus {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return "degraded";
  // Real Anthropic keys start with `sk-ant-`. Anything else is almost
  // certainly a typo or a placeholder from .env.example.
  return key.startsWith("sk-ant-") ? "ok" : "degraded";
}

export interface HealthReport {
  status: ComponentStatus;
  db: ComponentStatus;
  anthropic: ComponentStatus;
  uptime_s: number;
}

export async function runHealthChecks(): Promise<HealthReport> {
  const [dbStatus, anthropicStatus] = await Promise.all([
    pingDb(),
    Promise.resolve(pingAnthropic()),
  ]);
  const status: ComponentStatus =
    dbStatus === "ok" && anthropicStatus === "ok" ? "ok" : "degraded";
  return {
    status,
    db: dbStatus,
    anthropic: anthropicStatus,
    uptime_s: Math.floor(process.uptime()),
  };
}
