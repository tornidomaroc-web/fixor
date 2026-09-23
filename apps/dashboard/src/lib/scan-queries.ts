/**
 * The scan_runs queries behind scan history, scan detail and trends.
 *
 * Every query is scoped twice: to the org's installation, AND to the
 * repositories the signed-in user can see in it (`visibleRepos`, from
 * GET /user/installations/{id}/repositories with the user's own token).
 * The installation check alone is not enough: GitHub lists an
 * installation for any user who can read ONE of its repositories, and
 * without the repo filter that user would see the name, PR numbers,
 * head SHAs, finding counts and cost of every private repository under
 * it.
 *
 * An empty `visibleRepos` returns nothing without querying.
 *
 * Imports are relative and free of "server-only" so the root keyless
 * witness (src/test/test-scan-runs.ts) can load this exact file.
 */
import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { scanRuns } from "../db/schema";

// Any Drizzle Postgres database: node-postgres in the app, a recording
// client in the witness.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Database = PgDatabase<PgQueryResultHKT, any, any>;

export interface ScanRowRaw {
  id: string;
  repoFullName: string;
  pullNumber: number;
  headSha: string;
  status: string;
  totalFindings: number;
  fixesGenerated: number;
  costUsd: string;
  startedAt: Date;
  finishedAt: Date | null;
  errorMessage: string | null;
}

/** The one scoping predicate every query below uses. */
export function scanVisibility(
  installationId: string,
  visibleRepos: readonly string[],
): SQL {
  return and(
    eq(scanRuns.installationId, installationId),
    inArray(scanRuns.repoFullName, [...visibleRepos]),
  )!;
}

const SCAN_COLUMNS = {
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
};

export async function selectScans(
  database: Database,
  installationId: string,
  visibleRepos: readonly string[],
  limit: number,
): Promise<ScanRowRaw[]> {
  if (visibleRepos.length === 0) return [];
  return database
    .select(SCAN_COLUMNS)
    .from(scanRuns)
    .where(scanVisibility(installationId, visibleRepos))
    .orderBy(desc(scanRuns.startedAt))
    .limit(limit);
}

export async function selectScan(
  database: Database,
  installationId: string,
  visibleRepos: readonly string[],
  scanId: string,
): Promise<ScanRowRaw | null> {
  if (visibleRepos.length === 0) return null;
  const rows = await database
    .select(SCAN_COLUMNS)
    .from(scanRuns)
    .where(and(eq(scanRuns.id, scanId), scanVisibility(installationId, visibleRepos)))
    .limit(1);
  return rows[0] ?? null;
}

export async function selectWeekly(
  database: Database,
  installationId: string,
  visibleRepos: readonly string[],
  since: Date,
): Promise<Array<{ weekStart: Date; scans: number; findings: number }>> {
  if (visibleRepos.length === 0) return [];
  // date_trunc('week', ...) returns the Monday at 00:00 UTC for a given
  // timestamp: that is the bucket key.
  return database
    .select({
      weekStart: sql<Date>`date_trunc('week', ${scanRuns.startedAt} AT TIME ZONE 'UTC')`,
      scans: sql<number>`count(*)::int`,
      findings: sql<number>`coalesce(sum(${scanRuns.totalFindings}), 0)::int`,
    })
    .from(scanRuns)
    .where(and(scanVisibility(installationId, visibleRepos), gte(scanRuns.startedAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1 asc`);
}

export async function selectByFamily(
  database: Database,
  installationId: string,
  visibleRepos: readonly string[],
  since: Date,
): Promise<Array<{ family: string; count: number | string }>> {
  if (visibleRepos.length === 0) return [];
  // jsonb_each unrolls each row's findings_by_family into (key, value)
  // pairs, summed across rows. ::text::int converts the jsonb value.
  const result = await database.execute<{ family: string; count: number | string }>(
    sql`
      SELECT entry.key AS family,
             SUM((entry.value)::text::int)::int AS count
      FROM ${scanRuns},
           LATERAL jsonb_each(${scanRuns.findingsByFamily}) AS entry
      WHERE ${scanVisibility(installationId, visibleRepos)}
        AND ${scanRuns.startedAt} >= ${since}
      GROUP BY entry.key
      HAVING SUM((entry.value)::text::int) > 0
      ORDER BY count DESC
    `,
  );
  const rows = (result as { rows?: unknown }).rows ?? result;
  return rows as Array<{ family: string; count: number | string }>;
}
