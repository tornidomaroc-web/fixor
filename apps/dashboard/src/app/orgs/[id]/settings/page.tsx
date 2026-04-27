import Link from "next/link";
import { notFound } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { TierBadge } from "@/components/tier-badge";
import { SettingsForm } from "@/components/settings-form";
import { listFixorInstallations } from "@/lib/github";
import { getOrgForUser } from "@/lib/scans-data";
import { getOrgSettings } from "@/lib/settings-data";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function OrgSettingsPage({ params }: PageProps) {
  const { id: orgId } = await params;

  const result = await listFixorInstallations();
  if (result.status !== "ok") notFound();

  const allowed = result.installations.map((i) => String(i.id));
  const org = await getOrgForUser(orgId, allowed);
  if (!org) notFound();

  const installation = result.installations.find(
    (i) => String(i.id) === org.installationId,
  );

  const settings = await getOrgSettings(org.id);

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

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
        <nav className="flex items-center gap-2 text-sm">
          <Link
            href={`/orgs/${org.id}/scans`}
            className="text-muted-foreground hover:text-foreground"
          >
            Scans
          </Link>
          <span className="text-muted-foreground">·</span>
          <span className="text-foreground font-medium">Settings</span>
          <span className="text-muted-foreground">·</span>
          <Link
            href={`/orgs/${org.id}/billing`}
            className="text-muted-foreground hover:text-foreground"
          >
            Billing
          </Link>
        </nav>

        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Tune which findings reach your PRs and where they&apos;re routed.
            Changes apply to the next scan.
          </p>
        </div>

        <SettingsForm orgId={org.id} initial={settings} />
      </section>
    </main>
  );
}
