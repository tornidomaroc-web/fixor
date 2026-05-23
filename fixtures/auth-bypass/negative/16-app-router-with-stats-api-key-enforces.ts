// ASSUMED-PATH: app/api/v1/stats/export/route.ts
// Phase D — Phase D-2 unmeasured-HOC-name negative anchor.
// Symmetric anchor to positive/16-app-router-with-stats-api-key-
// no-enforce.ts. Same wrapper (`withStatsApiKey`), same destructive
// op (db.statSnapshot.deleteMany), same wrapper-name shape (no
// "auth"/"admin" substring).
//
// The ONLY discriminator is the body. Here the handler destructures
// `request.apiAuth.emailAccountId` and uses it as the scope filter
// in the deleteMany WHERE clause — structurally analogous to the
// session.user.id scope filter the prompt recognises as gating.
//
// The tightened auth-bypass prompt MUST skip this. If it flags, the
// body-discriminator rule is anchored too narrowly to session-
// substring HOCs and we have a calibration residual to address
// (tune the prompt OR document the residual).
import { NextResponse } from "next/server";
import { withStatsApiKey } from "@/lib/middleware/api-key";
import { db } from "@/lib/db";

export const POST = withStatsApiKey(
  "v1/stats/export",
  async (request) => {
    const { emailAccountId } = request.apiAuth;
    const body = await request.json();
    await db.statSnapshot.deleteMany({
      where: { period: body.period, emailAccountId },
    });
    return NextResponse.json({ ok: true });
  },
);
