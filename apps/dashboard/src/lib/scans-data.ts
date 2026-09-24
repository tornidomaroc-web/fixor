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
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { orgs } from "@/db/schema";
import { selectScan, selectScans } from "@/lib/scan-queries";

export interface OrgRef {
  id: string;
  installationId: string;
  planTier: string;
  /** Set by 5D-3's webhook handler after the first successful Paddle
   *  checkout. Null while the org has never paid; passed back into
   *  createCheckoutTransaction so repeat purchases skip re-collecting
   *  the email. */
  paddleCustomerId: string | null;
  /** Set by 5D-3 on `transaction.completed` and cleared on cancel /
   *  payment-failed downgrades. 5D-5 needs this to resolve the
   *  subscription's hosted update-payment / cancel URLs; null means
   *  there's no active subscription so the "Manage" buttons stay
   *  inert. */
  paddleSubscriptionId: string | null;
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
      paddleCustomerId: orgs.paddleCustomerId,
      paddleSubscriptionId: orgs.paddleSubscriptionId,
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
 * Scan history for an org, newest first, limited to the repositories
 * the user can see (`visibleRepos`, from listVisibleRepoNames). See
 * scan-queries.ts for why the installation check alone is not enough.
 */
export async function getScansForOrg(
  installationId: string,
  visibleRepos: readonly string[],
  limit = 100,
): Promise<ScanRow[]> {
  const rows = await selectScans(db(), installationId, visibleRepos, limit);
  return rows.map((r) => ({
    ...r,
    costUsd: parseFloat(r.costUsd) || 0,
  }));
}

/**
 * One scan by id, scoped to the org's installation and to the
 * repositories the user can see. The scope check belongs here (not in
 * the page) because the scan's UUID is a separate enumeration surface
 * from the org's UUID.
 */
export async function getScanForOrg(
  installationId: string,
  visibleRepos: readonly string[],
  scanId: string,
): Promise<ScanRow | null> {
  const row = await selectScan(db(), installationId, visibleRepos, scanId);
  if (!row) return null;
  return { ...row, costUsd: parseFloat(row.costUsd) || 0 };
}
