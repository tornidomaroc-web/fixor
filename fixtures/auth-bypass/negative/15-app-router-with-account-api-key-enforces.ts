// ASSUMED-PATH: app/api/v1/labels/route.ts
// Phase D — Phase D-1 unmeasured-HOC-name negative anchor.
// Symmetric anchor to positive/15-app-router-with-account-api-key-
// no-enforce.ts. Same wrapper (`withAccountApiKey`), same destructive
// op (db.label.delete), same wrapper-name shape (no "auth"/"admin"
// substring → not auto-gated by the auth-bypass prompt's substring
// rule at line 160-161).
//
// The ONLY discriminator is the body. Here the handler destructures
// `request.apiAuth.emailAccountId` and uses it as the scope filter
// in the DELETE query's WHERE clause — the structural analogue of
// the session.user.id scope filter that the prompt's session-rule
// (line 167-168) explicitly counts as gating.
//
// The tightened auth-bypass prompt MUST recognize this body pattern
// as enforcement, generalizing the body-discriminator rule from
// session-substring HOCs to ApiKey-context wrappers. If it does not,
// this fixture surfaces a real calibration residual: the body-rule
// is anchored to session-substring HOCs and does not extend to
// other wrapper-context auth shapes that real-world OSS uses.
import { NextResponse } from "next/server";
import { withAccountApiKey } from "@/lib/middleware/api-key";
import { db } from "@/lib/db";

export const DELETE = withAccountApiKey(
  "v1/labels",
  ["LABELS_WRITE"],
  async (request) => {
    const { emailAccountId } = request.apiAuth;
    const body = await request.json();
    await db.label.delete({
      where: { id: body.labelId, emailAccountId },
    });
    return NextResponse.json({ ok: true });
  },
);
