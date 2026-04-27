import { UserButton } from "@clerk/nextjs";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  fixorInstallUrl,
  listFixorInstallations,
} from "@/lib/github";

export default async function Home() {
  // The middleware enforces sign-in for "/" — by the time this runs we
  // always have a Clerk session. listFixorInstallations defends against
  // missing env vars / expired tokens with explicit status branches.
  const result = await listFixorInstallations();

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
            {result.installations.map((inst) => (
              <li
                key={inst.id}
                className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={inst.account.avatar_url}
                  alt=""
                  width={36}
                  height={36}
                  className="rounded-full"
                />
                <div className="flex flex-col">
                  <span className="font-medium">{inst.account.login}</span>
                  <span className="text-muted-foreground text-xs">
                    {inst.account.type} · installation #{inst.id}
                  </span>
                </div>
              </li>
            ))}
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
