import Link from "next/link";
import { notFound } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { ScanStatusPill } from "@/components/scan-status-pill";
import { listFixorInstallations } from "@/lib/github";
import { getOrgForUser, getScanForOrg } from "@/lib/scans-data";

interface PageProps {
  params: Promise<{ id: string; scanId: string }>;
}

export default async function ScanDetailPage({ params }: PageProps) {
  const { id: orgId, scanId } = await params;

  const result = await listFixorInstallations();
  if (result.status !== "ok") notFound();

  const allowed = result.installations.map((i) => String(i.id));
  const org = await getOrgForUser(orgId, allowed);
  if (!org) notFound();

  const installation = result.installations.find(
    (i) => String(i.id) === org.installationId,
  );

  const scan = await getScanForOrg(org.installationId, scanId);
  if (!scan) notFound();

  const prUrl = `https://github.com/${scan.repoFullName}/pull/${scan.pullNumber}`;
  const commitUrl = `https://github.com/${scan.repoFullName}/commit/${scan.headSha}`;

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
          <span className="text-muted-foreground">/</span>
          <Link
            href={`/orgs/${org.id}/scans`}
            className="text-muted-foreground hover:text-foreground"
          >
            scans
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-mono text-xs">{scan.id.slice(0, 8)}</span>
        </div>
        <UserButton />
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {scan.repoFullName}{" "}
              <span className="text-muted-foreground font-normal">
                #{scan.pullNumber}
              </span>
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Scanned {formatDate(scan.startedAt)}
              {scan.finishedAt
                ? ` · finished ${formatDate(scan.finishedAt)}`
                : null}
            </p>
          </div>
          <ScanStatusPill status={scan.status} />
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Findings" value={String(scan.totalFindings)} />
          <Stat label="Fixes" value={String(scan.fixesGenerated)} />
          <Stat label="Cost" value={formatUsd(scan.costUsd)} />
          <Stat
            label="Head SHA"
            value={scan.headSha.slice(0, 7)}
            href={commitUrl}
            mono
          />
        </dl>

        {scan.errorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
            <p className="font-medium">Scan error</p>
            <p className="mt-1 font-mono text-xs">{scan.errorMessage}</p>
          </div>
        ) : null}

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="font-medium">Reports</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Fixor uploads SARIF + PDF reports to Cloudinary as signed URLs
            (1-hour TTL) and links them inline in the PR comment. Open the
            PR to access the latest signed links.
          </p>
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Open PR on GitHub →
          </a>
        </div>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  href,
  mono,
}: {
  label: string;
  value: string;
  href?: string;
  mono?: boolean;
}) {
  const valueEl = (
    <dd
      className={
        mono
          ? "mt-1 font-mono text-base tabular-nums"
          : "mt-1 text-base tabular-nums"
      }
    >
      {value}
    </dd>
  );
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </dt>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          {valueEl}
        </a>
      ) : (
        valueEl
      )}
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
