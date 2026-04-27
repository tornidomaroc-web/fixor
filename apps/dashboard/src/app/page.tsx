import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { fixorInstallUrl, listFixorInstallations } from "@/lib/github";
import { getOrgSummaries, type OrgSummary } from "@/lib/orgs-data";
import { TierBadge } from "@/components/tier-badge";
import { SpendBar } from "@/components/spend-bar";
import { InstallWizard } from "@/components/install-wizard";
import { WelcomeBanner } from "@/components/welcome-banner";

interface HomeProps {
  searchParams: Promise<{ installed?: string }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const { installed } = await searchParams;
  const justInstalled = installed === "1";

  const result = await listFixorInstallations();

  // Fetch DB summaries only when GitHub returned installations. Defends
  // the page against missing DATABASE_URL during the initial Vercel
  // env-vars setup window.
  let summaries: OrgSummary[] = [];
  let dbStatus: "ok" | "error" = "ok";
  if (result.status === "ok" && result.installations.length > 0) {
    try {
      summaries = await getOrgSummaries(
        result.installations.map((i) => String(i.id)),
      );
    } catch {
      dbStatus = "error";
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Fixor</h1>
        <UserButton />
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Your orgs</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            One row per GitHub installation Fixor has access to.
          </p>
        </div>

        {justInstalled &&
        result.status === "ok" &&
        result.installations.length > 0 ? (
          <WelcomeBanner />
        ) : null}

        {result.status === "ok" && result.installations.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {result.installations.map((inst) => {
              const summary = summaries.find(
                (s) => s.installationId === String(inst.id),
              );
              const orgHref =
                summary && summary.orgId
                  ? `/orgs/${summary.orgId}/scans`
                  : null;
              const inner = (
                <>
                  <div className="flex flex-1 items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={inst.account.avatar_url}
                      alt=""
                      width={36}
                      height={36}
                      className="rounded-full"
                    />
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{inst.account.login}</span>
                        <TierBadge tier={summary?.planTier ?? "free"} />
                        {summary && summary.orgId === null ? (
                          <span className="text-muted-foreground text-xs italic">
                            provisioning…
                          </span>
                        ) : null}
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {inst.account.type} · installation #{inst.id}
                      </span>
                    </div>
                  </div>
                  <div className="w-full sm:w-56">
                    {summary ? (
                      <SpendBar
                        spendUsd={summary.monthlySpendUsd}
                        capUsd={summary.monthlyCapUsd}
                      />
                    ) : (
                      <div className="text-muted-foreground text-xs italic">
                        {dbStatus === "error" ? "spend unavailable" : "—"}
                      </div>
                    )}
                  </div>
                </>
              );
              const baseClass =
                "flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:items-center";
              return (
                <li key={inst.id}>
                  {orgHref ? (
                    <Link
                      href={orgHref}
                      className={cn(
                        baseClass,
                        "transition-colors hover:bg-muted/30",
                      )}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className={baseClass}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <InstallWizard
            state={
              result.status === "ok"
                ? justInstalled
                  ? "waiting"
                  : "ready"
                : "error"
            }
            reason={result.status === "ok" ? undefined : result.status}
            installUrl={fixorInstallUrl()}
          />
        )}
      </section>
    </main>
  );
}
