/**
 * POST /api/billing/checkout — open a Paddle hosted checkout for an
 * org + paid tier.
 *
 * Body:  { orgId: string, tier: "indie" | "pro" | "team" }
 * Reply: { url: string }   (browser redirects to it)
 *
 * Auth model mirrors PATCH /api/orgs/[id]/settings — Clerk session →
 * listFixorInstallations → getOrgForUser. Out-of-scope orgs return
 * 404 so the URL space isn't enumerable.
 *
 * The free tier is rejected because there's no Paddle product behind
 * it; downgrading is handled by 5D-3's webhook flow + 5D-5's portal
 * link, not by this endpoint.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listFixorInstallations } from "@/lib/github";
import { getOrgForUser } from "@/lib/scans-data";
import { TIERS, getTier, type TierId } from "@/lib/tiers";
import { createCheckoutTransaction } from "@/lib/paddle";

const PAID_TIER_IDS: ReadonlySet<TierId> = new Set(
  TIERS.filter((t) => t.priceUsd > 0).map((t) => t.id),
);

function isPaidTier(s: string): s is TierId {
  return PAID_TIER_IDS.has(s as TierId);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // 1) Body parse + validate. Tighter than the settings endpoint —
  //    the only valid combos are (orgId, paid-tier-id), and the free
  //    tier has no Paddle product so it's a 400 here.
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
  const tierRaw = typeof body.tier === "string" ? body.tier : null;
  if (!orgId || !tierRaw) {
    return NextResponse.json(
      { error: "validation_failed", details: ["orgId and tier are required"] },
      { status: 400 },
    );
  }
  if (!isPaidTier(tierRaw)) {
    return NextResponse.json(
      {
        error: "validation_failed",
        details: [
          "tier must be one of indie | pro | team (free has no Paddle product)",
        ],
      },
      { status: 400 },
    );
  }

  // 2) Auth scope check — same path as the settings endpoint.
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

  // 3) Resolve the Paddle price id from env. The tier-to-env-name
  //    mapping lives on the Tier object (5D-1) so adding a new tier
  //    only touches lib/tiers.ts.
  const tier = getTier(tierRaw)!; // safe: isPaidTier returned true
  const priceEnvName = tier.paddlePriceEnv;
  if (!priceEnvName) {
    return NextResponse.json(
      { error: "tier_not_purchasable" },
      { status: 400 },
    );
  }
  const priceId = process.env[priceEnvName]?.trim();
  if (!priceId) {
    return NextResponse.json(
      { error: "paddle_price_not_configured", details: [priceEnvName] },
      { status: 500 },
    );
  }

  // 4) Build the return URL from the request origin so the same code
  //    works on Vercel previews + production without an env var.
  const url = new URL(req.url);
  const returnUrl = `${url.origin}/orgs/${org.id}/billing?checkout=success`;

  // 5) Create the transaction. Failures bubble out as 502 so the
  //    client can retry rather than treating it as a permanent state.
  try {
    const result = await createCheckoutTransaction({
      priceId,
      orgId: org.id,
      returnUrl,
      paddleCustomerId: org.paddleCustomerId,
    });
    return NextResponse.json({ url: result.checkoutUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "paddle_unknown";
    return NextResponse.json(
      { error: "paddle_failed", details: [message] },
      { status: 502 },
    );
  }
}
