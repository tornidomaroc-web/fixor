import Link from "next/link";
import { notFound } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { TierBadge } from "@/components/tier-badge";
import { SpendBar } from "@/components/spend-bar";
import { listFixorInstallations } from "@/lib/github";
import { getOrgForUser } from "@/lib/scans-data";
import { getOrgSummaries } from "@/lib/orgs-data";
import { TIERS, getTier, type Tier } from "@/lib/tiers";
import { cn } from "@/lib/utils";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function OrgBillingPage({ params }: PageProps) {
  const { id: orgId } = await params;

  const result = await listFixorInstallations();
  if (result.status !== "ok") notFound();

  const allowed = result.installations.map((i) => String(i.id));
  const org = await getOrgForUser(orgId, allowed);
  if (!org) notFound();

  const installation = result.installations.find(
    (i) => String(i.id) === org.installationId,
  );

  // Reuse the home-page summary so spend, cap, and tier come from one
  // query path. DB unreachable → render the page in a degraded mode
  // rather than crashing the billing surface.
  let monthlySpendUsd: number | null = null;
  let monthlyCapUsd: number | null = null;
  try {
    const [summary] = await getOrgSummaries([org.installationId]);
    if (summary) {
      monthlySpendUsd = summary.monthlySpendUsd;
      monthlyCapUsd = summary.monthlyCapUsd;
    }
  } catch {
    monthlySpendUsd = null;
    monthlyCapUsd = null;
  }

  const currentTier = getTier(org.planTier);

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3 text-sm">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground"
          >
            Fixor
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">
            {installation?.account.login ?? "org"}
          </span>
          <TierBadge tier={org.planTier} />
        </div>
        <UserButton />
      </header>

      <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
        <nav className="flex items-center gap-2 text-sm">
          <Link
            href={`/orgs/${org.id}/scans`}
            className="text-muted-foreground hover:text-foreground"
          >
            Scans
          </Link>
          <span className="text-muted-foreground">·</span>
          <Link
            href={`/orgs/${org.id}/settings`}
            className="text-muted-foreground hover:text-foreground"
          >
            Settings
          </Link>
          <span className="text-muted-foreground">·</span>
          <span className="text-foreground font-medium">Billing</span>
        </nav>

        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Billing</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Fixor uses Paddle as the merchant of record — Paddle handles VAT
            / sales tax and the customer portal once Phase 5D ships.
          </p>
        </div>

        <CurrentPlanCard
          tier={currentTier}
          rawTier={org.planTier}
          monthlySpendUsd={monthlySpendUsd}
          monthlyCapUsd={monthlyCapUsd}
        />

        <PricingGrid currentTierId={org.planTier} />

        <Phase5dNotice />
      </section>
    </main>
  );
}

function CurrentPlanCard({
  tier,
  rawTier,
  monthlySpendUsd,
  monthlyCapUsd,
}: {
  tier: Tier | undefined;
  rawTier: string;
  monthlySpendUsd: number | null;
  monthlyCapUsd: number | null;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Current plan
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight">
            {tier ? tier.label : rawTier}
            {tier ? (
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                {tier.priceUsd === 0 ? "Free" : `$${tier.priceUsd}/month`}
              </span>
            ) : null}
          </h3>
          {tier ? (
            <p className="text-muted-foreground mt-1 text-sm">
              {tier.highlight}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled
          title="Available once Phase 5D wires up Paddle"
          className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground cursor-not-allowed"
        >
          Manage subscription
        </button>
      </div>

      {monthlyCapUsd !== null && monthlySpendUsd !== null ? (
        <div className="max-w-md">
          <SpendBar
            spendUsd={monthlySpendUsd}
            capUsd={monthlyCapUsd}
          />
        </div>
      ) : (
        <p className="text-muted-foreground text-xs italic">
          Spend unavailable — couldn&apos;t reach the database.
        </p>
      )}
    </div>
  );
}

function PricingGrid({ currentTierId }: { currentTierId: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold tracking-tight">Plans</h3>
      <p className="text-muted-foreground mt-1 text-sm">
        Upgrade options. Checkout opens once Phase 5D ships.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((t) => {
          const isCurrent = t.id === currentTierId;
          return (
            <div
              key={t.id}
              className={cn(
                "flex flex-col gap-3 rounded-lg border bg-card p-4",
                isCurrent
                  ? "border-foreground/40 ring-1 ring-foreground/10"
                  : "border-border",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold tracking-tight">
                  {t.label}
                </span>
                {isCurrent ? (
                  <span className="text-muted-foreground text-xs uppercase tracking-wide">
                    current
                  </span>
                ) : null}
              </div>
              <div>
                <span className="text-2xl font-semibold tabular-nums">
                  {t.priceUsd === 0 ? "$0" : `$${t.priceUsd}`}
                </span>
                <span className="text-muted-foreground ml-1 text-sm">
                  / mo
                </span>
              </div>
              <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
                {t.features.map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
              <button
                type="button"
                disabled
                title="Available once Phase 5D wires up Paddle"
                className={cn(
                  "mt-auto rounded-md px-3 py-1.5 text-xs font-medium",
                  isCurrent
                    ? "border border-border bg-muted text-muted-foreground cursor-not-allowed"
                    : "border border-border bg-muted text-muted-foreground cursor-not-allowed",
                )}
              >
                {isCurrent ? "Current plan" : `Upgrade to ${t.label}`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Phase5dNotice() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-4 text-sm">
      <p className="font-medium">Checkout coming in Phase 5D</p>
      <p className="text-muted-foreground mt-1">
        Paddle accounts are configured. The checkout overlay, webhook
        handler, and per-subscription portal link land in the next phase
        and will hook into the disabled buttons above.
      </p>
    </div>
  );
}
