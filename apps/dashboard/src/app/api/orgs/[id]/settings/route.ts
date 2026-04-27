/**
 * PATCH /api/orgs/:id/settings — update an org's settings.
 *
 * Auth model:
 *   - Clerk session cookie identifies the actor.
 *   - listFixorInstallations() resolves the user's GitHub installations.
 *   - getOrgForUser() loads the org by id ONLY when its
 *     github_installation_id is in that allow-list. Out-of-scope orgs
 *     return 404 (same shape as missing) so we don't leak existence.
 *
 * The endpoint name and verb match the 5C-5 roadmap line. We keep the
 * write path on the dashboard runtime — Vercel + Drizzle to the same
 * Neon db the backend uses — rather than fanning out to Railway. This
 * gives the form a tight loop, and future API-token writes (5B-5
 * tokens) can land on a parallel /api/v1/* endpoint when needed.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listFixorInstallations } from "@/lib/github";
import { getOrgForUser } from "@/lib/scans-data";
import {
  getOrgSettings,
  updateOrgSettings,
  type OrgSettingsRow,
} from "@/lib/settings-data";
import {
  diffSettings,
  validateSettingsPatch,
} from "@/lib/settings-validation";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id: orgId } = await ctx.params;

  // 1) Resolve user's GitHub installations and confirm they own this org.
  //    notFound semantics live at the page; the API returns 403 / 404 to
  //    let the form distinguish "no access" from "validation failed".
  const installations = await listFixorInstallations();
  if (installations.status !== "ok") {
    return NextResponse.json(
      { error: "github_unavailable" },
      { status: 502 },
    );
  }
  const allowed = installations.installations.map((i) => String(i.id));
  const org = await getOrgForUser(orgId, allowed);
  if (!org) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 2) Parse + validate body. Handler returns 400 with all errors so the
  //    form can surface every problem at once instead of one-at-a-time.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const validated = validateSettingsPatch(raw);
  if (!validated.ok) {
    return NextResponse.json(
      { error: "validation_failed", details: validated.errors },
      { status: 400 },
    );
  }

  // 3) Diff against the current row to record only what actually
  //    changed in the audit log. A no-op PATCH still returns 200 so the
  //    caller doesn't need to compute the diff client-side.
  const current = await getOrgSettings(orgId);
  const next: OrgSettingsRow = validated.value;
  const changedFields = diffSettings(current, next);

  if (changedFields.length === 0) {
    return NextResponse.json({ ok: true, value: next, changed: [] });
  }

  await updateOrgSettings(orgId, next, {
    actorUserId: userId,
    changedFields,
  });

  return NextResponse.json({ ok: true, value: next, changed: changedFields });
}
