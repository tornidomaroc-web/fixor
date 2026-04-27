/**
 * POST /api/billing/portal — return a Paddle hosted-portal URL for an
 * org's active subscription.
 *
 * Body:  { orgId: string, kind: "update_payment" | "cancel" }
 * Reply: { url: string }   (browser redirects to it)
 *
 * Auth: Clerk session → listFixorInstallations → getOrgForUser
 * (same scope-check pattern as /api/billing/checkout). When the org
 * has no `paddle_subscription_id` we return 409 — the caller should
 * surface "no active subscription" rather than retry.
 *
 * The URL is fetched fresh on every click (rather than cached) so the
 * customer always lands on a non-stale Paddle-signed URL even if
 * Paddle rotates them server-side.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listFixorInstallations } from "@/lib/github";
import { getOrgForUser } from "@/lib/scans-data";
import { getSubscriptionManagementUrls } from "@/lib/paddle";

type PortalKind = "update_payment" | "cancel";

const ALLOWED_KINDS: ReadonlySet<PortalKind> = new Set([
  "update_payment",
  "cancel",
]);

function isPortalKind(s: string): s is PortalKind {
  return ALLOWED_KINDS.has(s as PortalKind);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // 1) Body parse + validate.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;
  const orgId = typeof body.orgId === "string" ? body.orgId : null;
  const kindRaw = typeof body.kind === "string" ? body.kind : null;
  if (!orgId || !kindRaw) {
    return NextResponse.json(
      { error: "validation_failed", details: ["orgId and kind are required"] },
      { status: 400 },
    );
  }
  if (!isPortalKind(kindRaw)) {
    return NextResponse.json(
      {
        error: "validation_failed",
        details: ["kind must be one of update_payment | cancel"],
      },
      { status: 400 },
    );
  }

  // 2) Auth scope check.
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

  // 3) Subscription check. The portal URLs only exist on a live
  //    Paddle subscription, so a free-tier org or a downgraded org
  //    has nothing to surface here.
  if (!org.paddleSubscriptionId) {
    return NextResponse.json(
      { error: "no_active_subscription" },
      { status: 409 },
    );
  }

  // 4) Fetch URLs and return the requested one. Paddle errors bubble
  //    out as 502 so the client can retry.
  try {
    const urls = await getSubscriptionManagementUrls(org.paddleSubscriptionId);
    const url =
      kindRaw === "cancel" ? urls.cancel : urls.updatePaymentMethod;
    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "paddle_unknown";
    return NextResponse.json(
      { error: "paddle_failed", details: [message] },
      { status: 502 },
    );
  }
}
