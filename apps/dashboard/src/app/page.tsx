import { UserButton } from "@clerk/nextjs";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fixorInstallUrl, listFixorInstallations } from "@/lib/github";
import { getOrgSummaries, type OrgSummary } from "@/lib/orgs-data";
import { TierBadge } from "@/components/tier-badge";
import { SpendBar } from "@/components/spend-bar";

export default async function Home() {
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

        {result.status === "ok" && result.installations.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {result.installations.map((inst) => {
              const summary = summaries.find(
                (s) => s.installationId === String(inst.id),
              );
              return (
                <li
                  key={inst.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:items-center"
                >
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
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState status={result.status} />
        )}
      </section>
    </main>
  );
}

function EmptyState({
  status,
}: {
  status: "ok" | "no_token" | "error";
}) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-border bg-card/50 p-6">
      <div>
        <p className="font-medium">No Fixor installations yet</p>
        <p className="text-muted-foreground text-sm">
          {status === "no_token"
            ? "We could not read your GitHub token. Sign out and back in with GitHub to retry."
            : status === "error"
              ? "We could not reach GitHub to list your installations. If this persists, check the dashboard logs."
              : "Install Fixor on a GitHub user or organization to get started."}
        </p>
      </div>
      <a
        className={cn(buttonVariants({ variant: "default", size: "lg" }))}
        href={fixorInstallUrl()}
        target="_blank"
        rel="noopener noreferrer"
      >
        Install Fixor on GitHub
      </a>
    </div>
  );
}
