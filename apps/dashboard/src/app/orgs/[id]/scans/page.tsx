import Link from "next/link";
import { notFound } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { TierBadge } from "@/components/tier-badge";
import { ScanStatusPill } from "@/components/scan-status-pill";
import { listFixorInstallations } from "@/lib/github";
import {
  getOrgForUser,
  getScansForOrg,
  type ScanRow,
} from "@/lib/scans-data";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function OrgScansPage({ params }: PageProps) {
  const { id: orgId } = await params;

  const result = await listFixorInstallations();
  // Auth gate: if we can't enumerate the user's installations we treat
  // the org as not-found. Same response whether the org is missing,
  // private, or the GitHub side is broken — keeps enumeration shut.
  if (result.status !== "ok") notFound();

  const allowed = result.installations.map((i) => String(i.id));
  const org = await getOrgForUser(orgId, allowed);
  if (!org) notFound();

  const installation = result.installations.find(
    (i) => String(i.id) === org.installationId,
  );

  let scans: ScanRow[] = [];
  let dbStatus: "ok" | "error" = "ok";
  try {
    scans = await getScansForOrg(org.installationId);
  } catch {
    dbStatus = "error";
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            ← Fixor
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">
            {installation?.account.login ?? "org"}
          </span>
          <TierBadge tier={org.planTier} />
        </div>
        <UserButton />
      </header>

      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-12">
        <nav className="flex items-center gap-2 text-sm">
          <span className="text-foreground font-medium">Scans</span>
          <span className="text-muted-foreground">·</span>
          <Link
            href={`/orgs/${org.id}/settings`}
            className="text-muted-foreground hover:text-foreground"
          >
            Settings
          </Link>
          <span className="text-muted-foreground">·</span>
          <Link
            href={`/orgs/${org.id}/billing`}
            className="text-muted-foreground hover:text-foreground"
          >
            Billing
          </Link>
        </nav>

        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Scan history
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Every PR Fixor has scanned for this org, newest first.
          </p>
        </div>

        {dbStatus === "error" ? (
          <ErrorState />
        ) : scans.length === 0 ? (
          <EmptyState />
        ) : (
          <ScansTable orgId={org.id} scans={scans} />
        )}
      </section>
    </main>
  );
}

function ScansTable({ orgId, scans }: { orgId: string; scans: ScanRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Date</th>
            <th className="px-4 py-2 text-left font-medium">Repo</th>
            <th className="px-4 py-2 text-left font-medium">PR</th>
            <th className="px-4 py-2 text-left font-medium">Status</th>
            <th className="px-4 py-2 text-right font-medium">Findings</th>
            <th className="px-4 py-2 text-right font-medium">Fixes</th>
            <th className="px-4 py-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {scans.map((s) => (
            <tr
              key={s.id}
              className="border-t border-border hover:bg-muted/30"
            >
              <td className="px-4 py-2 align-middle">
                <Link
                  href={`/orgs/${orgId}/scans/${s.id}`}
                  className="block text-foreground hover:underline"
                >
                  {formatDate(s.startedAt)}
                </Link>
              </td>
              <td className="px-4 py-2 align-middle font-mono text-xs">
                {s.repoFullName}
              </td>
              <td className="px-4 py-2 align-middle">#{s.pullNumber}</td>
              <td className="px-4 py-2 align-middle">
                <ScanStatusPill status={s.status} />
              </td>
              <td className="px-4 py-2 text-right align-middle tabular-nums">
                {s.totalFindings}
              </td>
              <td className="px-4 py-2 text-right align-middle tabular-nums">
                {s.fixesGenerated}
              </td>
              <td className="px-4 py-2 text-right align-middle tabular-nums">
                {formatUsd(s.costUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-6">
      <p className="font-medium">No scans yet</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Open a pull request on a repo where Fixor is installed and the scan
        will show up here within a minute.
      </p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-6">
      <p className="font-medium">Couldn&apos;t load scan history</p>
      <p className="text-muted-foreground mt-1 text-sm">
        The dashboard couldn&apos;t reach the database. Try refreshing in a
        moment; if it persists, check the dashboard logs.
      </p>
    </div>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}
