// ASSUMED-PATH: app/api/v1/labels/route.ts
// Phase D — Phase D-1 unmeasured-HOC-name positive.
// `withAccountApiKey` is an API-key-auth wrapper from real-world OSS
// (inbox-zero). The wrapper NAME does NOT contain "auth" or "admin"
// as a substring, so the auth-bypass prompt's substring-pass rule
// (auth-bypass.detector.ts:160-161) does NOT auto-treat it as gated.
// The prompt's generic-wrapper rule (line 178-182) defaults such
// wrappers to UNgated unless the body shows enforcement.
//
// This fixture deliberately omits any body-level use of the wrapper's
// auth context: the handler does not destructure `request.apiAuth`,
// applies no scope filter to the DELETE query, performs the
// destructive op blindly. Per the prompt's "judge content, not just
// the wrapper" rule (line 188-189), this must flag as missing-HOC-
// wrapper bypass on App Router.
//
// Pair-anchor: negative/15-app-router-with-account-api-key-enforces.ts
// is the same wrapper with body that DOES use apiAuth.emailAccountId
// as a scope filter on the destructive query. Both fixtures together
// test whether the body-discriminator rule generalizes from session-
// substring HOCs to ApiKey-suffix wrappers.
import { NextResponse } from "next/server";
import { withAccountApiKey } from "@/lib/middleware/api-key";
import { db } from "@/lib/db";

export const DELETE = withAccountApiKey(
  "v1/labels",
  ["LABELS_WRITE"],
  async (request) => {
    const body = await request.json();
    await db.label.delete({ where: { id: body.labelId } });
    return NextResponse.json({ ok: true });
  },
);
