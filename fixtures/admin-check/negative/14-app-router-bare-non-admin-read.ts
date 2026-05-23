// ASSUMED-PATH: app/api/me/profile/route.ts
// Phase C — bare GET that is a non-admin self-profile fetch. Not
// admin-tier (read of own data, scoped on session id). Inline auth
// check present (401 on no session). Handler is a bare exported
// async function (no HOC wrapper) — the every-route-on-this-router-
// unguarded heuristic does NOT apply because the body unambiguously
// authenticates and scopes by self. Should land LOW, not flagged.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, avatar: true },
  });
  return NextResponse.json(user);
}
