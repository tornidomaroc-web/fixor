import Link from "next/link";
import { notFound } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { TierBadge } from "@/components/tier-badge";
import { SpendBar } from "@/components/spend-bar";
import { UpgradeButton } from "@/components/upgrade-button";
import { ManageSubscriptionButtons } from "@/components/manage-subscription-buttons";
import { listFixorInstallations } from "@/lib/github";
import { getOrgForUser } from "@/lib/scans-data";
import { getOrgSummaries } from "@/lib/orgs-data";
import { TIERS, getTier, type Tier } from "@/lib/tiers";
import { cn } from "@/lib/utils";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkout?: string }>;
}

export default async function OrgBillingPage({
  params,
  searchParams,
}: PageProps) {
  const { id: orgId } = await params;
  const { checkout } = await searchParams;
  const justCheckedOut = checkout === "success";

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
            Fixor uses Paddle as the merchant of record — Paddle handles
            VAT / sales tax and the cancel / update-payment portal.
          </p>
        </div>

        {justCheckedOut ? <CheckoutSuccessBanner /> : null}

        <CurrentPlanCard
          orgId={org.id}
          tier={currentTier}
          rawTier={org.planTier}
          monthlySpendUsd={monthlySpendUsd}
          monthlyCapUsd={monthlyCapUsd}
          hasSubscription={Boolean(org.paddleSubscriptionId)}
        />

        <PricingGrid orgId={org.id} currentTierId={org.planTier} />
      </section>
    </main>
  );
}

function CurrentPlanCard({
  orgId,
  tier,
  rawTier,
  monthlySpendUsd,
  monthlyCapUsd,
  hasSubscription,
}: {
  orgId: string;
  tier: Tier | undefined;
  rawTier: string;
  monthlySpendUsd: number | null;
  monthlyCapUsd: number | null;
  hasSubscription: boolean;
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
        <ManageSubscriptionButtons
          orgId={orgId}
          hasSubscription={hasSubscription}
        />
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

function PricingGrid({
  orgId,
  currentTierId,
}: {
  orgId: string;
  currentTierId: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold tracking-tight">Plans</h3>
      <p className="text-muted-foreground mt-1 text-sm">
        Upgrade opens Paddle&apos;s hosted checkout. Tier change takes effect
        within ~30 seconds of payment, when Paddle&apos;s webhook fires.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((t) => {
          const isCurrent = t.id === currentTierId;
          const isFree = t.priceUsd === 0;
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
                  {isFree ? "$0" : `$${t.priceUsd}`}
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
              <div className="mt-auto">
                <UpgradeButton
                  orgId={orgId}
                  tier={t.id}
                  label={`Upgrade to ${t.label}`}
                  isCurrent={isCurrent}
                  // Free tier has no Paddle product — show as inert.
                  // Downgrade is handled by Paddle's portal in 5D-5,
                  // not by this button.
                  disabled={isFree}
                  className="w-full"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CheckoutSuccessBanner() {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950">
      <p className="font-medium text-emerald-900 dark:text-emerald-100">
        Thanks — your payment went through.
      </p>
      <p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80">
        Tier upgrade lands within ~30 seconds, once Paddle&apos;s webhook
        reaches us. Refresh in a moment if your plan still shows the
        previous tier.
      </p>
    </div>
  );
}
