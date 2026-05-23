// ASSUMED-PATH: app/api/v1/stats/export/route.ts
// Phase D — Phase D-2 unmeasured-HOC-name positive.
// `withStatsApiKey` is a second API-key-auth wrapper shape from real-
// world OSS (inbox-zero), distinct from withAccountApiKey by signature
// (2-arg vs 3-arg) and by domain (stats vs general API). The wrapper
// NAME does NOT contain "auth" or "admin" as a substring, so the
// prompt's substring-pass rule does NOT auto-treat it as gated.
//
// This fixture exports a destructive write (bulk delete of stat
// records) and the body does NOT use `request.apiAuth` in the query.
// Per the prompt's "judge content, not just the wrapper" rule, this
// must flag.
//
// Pair-anchor: negative/16-app-router-with-stats-api-key-enforces.ts.
// Together with the positive/negative/15 pair, these four fixtures
// test whether the body-discriminator rule generalizes across TWO
// distinct ApiKey-suffix wrapper shapes — not a single shape's
// idiosyncrasy.
import { NextResponse } from "next/server";
import { withStatsApiKey } from "@/lib/middleware/api-key";
import { db } from "@/lib/db";

export const POST = withStatsApiKey(
  "v1/stats/export",
  async (request) => {
    const body = await request.json();
    await db.statSnapshot.deleteMany({
      where: { period: body.period },
    });
    return NextResponse.json({ ok: true });
  },
);
