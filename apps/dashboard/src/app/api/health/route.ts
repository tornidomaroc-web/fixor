/**
 * GET /api/health — uptime probe for status.fixor.dev (5F-1).
 *
 * Public (Clerk middleware skips it via the isPublic matcher in
 * proxy.ts). Returns status + a Neon round-trip status. We deliberately
 * keep the body shape close to the backend's /health (5A-8) so a
 * Better Uptime monitor pointed at either endpoint can use the same
 * "body contains \"status\":\"ok\"" assertion.
 *
 *   - 200 + status:"ok"        → both surfaces reachable
 *   - 503 + status:"degraded"  → Neon round-trip failed
 *
 * No auth, no rate limiting — same exposure pattern as the backend's
 * /health. The endpoint reveals nothing useful to an attacker beyond
 * "the service is up".
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

async function pingDb(): Promise<"ok" | "degraded"> {
  try {
    await db().execute(sql`select 1`);
    return "ok";
  } catch {
    return "degraded";
  }
}

export async function GET() {
  const dbStatus = await pingDb();
  const status = dbStatus === "ok" ? "ok" : "degraded";
  const body = { status, db: dbStatus };
  return NextResponse.json(body, {
    status: status === "ok" ? 200 : 503,
    // Don't let CDN / browser caches pin a stale "ok" in front of a
    // real outage — Better Uptime always wants the live answer.
    headers: { "Cache-Control": "no-store" },
  });
}
