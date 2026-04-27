/**
 * Server-only data layer for the scan-history pages.
 *
 * Auth model: every export takes the set of GitHub installation ids the
 * signed-in user can see (resolved from listFixorInstallations()) and
 * scopes queries to orgs whose github_installation_id is in that set.
 * A direct id lookup that bypasses this scope would let anyone enumerate
 * other orgs' scans by guessing UUIDs.
 */
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { orgs, scanRuns } from "@/db/schema";

export interface OrgRef {
  id: string;
  installationId: string;
  planTier: string;
}

export interface ScanRow {
  id: string;
  repoFullName: string;
  pullNumber: number;
  headSha: string;
  status: string;
  totalFindings: number;
  fixesGenerated: number;
  costUsd: number;
  startedAt: Date;
  finishedAt: Date | null;
  errorMessage: string | null;
}

/**
 * Resolve an org by id, but ONLY if the user has access to its
 * underlying GitHub installation. Returns null when the org doesn't
 * exist OR when the caller has no business reading it — same shape
 * either way so the page can render a single 404 path without leaking
 * which case applies.
 */
export async function getOrgForUser(
  orgId: string,
  allowedInstallationIds: string[],
): Promise<OrgRef | null> {
  if (allowedInstallationIds.length === 0) return null;

  const rows = await db()
    .select({
      id: orgs.id,
      installationId: orgs.githubInstallationId,
      planTier: orgs.planTier,
    })
    .from(orgs)
    .where(
      and(
        eq(orgs.id, orgId),
        inArray(orgs.githubInstallationId, allowedInstallationIds),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Scan history for an org, newest first. Uses the
 * scan_runs_installation_started_idx index from the backend schema so
 * this is a single index range scan even on busy installations.
 */
export async function getScansForOrg(
  installationId: string,
  limit = 100,
): Promise<ScanRow[]> {
  const rows = await db()
    .select({
      id: scanRuns.id,
      repoFullName: scanRuns.repoFullName,
      pullNumber: scanRuns.pullNumber,
      headSha: scanRuns.headSha,
      status: scanRuns.status,
      totalFindings: scanRuns.totalFindings,
      fixesGenerated: scanRuns.fixesGenerated,
      costUsd: scanRuns.costUsd,
      startedAt: scanRuns.startedAt,
      finishedAt: scanRuns.finishedAt,
      errorMessage: scanRuns.errorMessage,
    })
    .from(scanRuns)
    .where(eq(scanRuns.installationId, installationId))
    .orderBy(desc(scanRuns.startedAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    costUsd: parseFloat(r.costUsd) || 0,
  }));
}

/**
 * One scan by id, scoped to the same installation as the org. The
 * installation_id check belongs here (not in the page) because the
 * scan's UUID is a separate enumeration surface from the org's UUID.
 */
export async function getScanForOrg(
  installationId: string,
  scanId: string,
): Promise<ScanRow | null> {
  const rows = await db()
    .select({
      id: scanRuns.id,
      repoFullName: scanRuns.repoFullName,
      pullNumber: scanRuns.pullNumber,
      headSha: scanRuns.headSha,
      status: scanRuns.status,
      totalFindings: scanRuns.totalFindings,
      fixesGenerated: scanRuns.fixesGenerated,
      costUsd: scanRuns.costUsd,
      startedAt: scanRuns.startedAt,
      finishedAt: scanRuns.finishedAt,
      errorMessage: scanRuns.errorMessage,
    })
    .from(scanRuns)
    .where(
      and(
        eq(scanRuns.id, scanId),
        eq(scanRuns.installationId, installationId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { ...row, costUsd: parseFloat(row.costUsd) || 0 };
}
