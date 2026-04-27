/**
 * Server-only data layer for the dashboard's home page.
 *
 * Joins GitHub installation IDs (from listFixorInstallations) against
 * our orgs + cost_ledger tables to produce the per-org rows that the
 * UI renders.
 */
import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { costLedger, orgs } from "@/db/schema";

export interface OrgSummary {
  installationId: string;
  /** Null when GitHub has the install but our backend hasn't received the
   *  installation_created webhook yet (rare race; render as "provisioning"). */
  orgId: string | null;
  planTier: string;
  monthlyCapUsd: number;
  monthlySpendUsd: number;
  createdAt: Date | null;
}

function startOfMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Resolve org metadata + this-month spend for a list of GitHub
 * installation ids. Single round-trip via LEFT JOIN.
 *
 * Returns one row PER installation id supplied — including ids with
 * no orgs row (orgId === null). The caller decides how to render
 * those (we show "provisioning" copy).
 */
export async function getOrgSummaries(
  installationIds: string[],
): Promise<OrgSummary[]> {
  if (installationIds.length === 0) return [];

  const since = startOfMonthUtc();

  // Drizzle's filtered aggregate keeps the cost SUM scoped to the
  // current calendar month so older months don't inflate the bar.
  const rows = await db()
    .select({
      installationId: orgs.githubInstallationId,
      orgId: orgs.id,
      planTier: orgs.planTier,
      monthlyCapUsd: orgs.monthlyCapUsd,
      createdAt: orgs.createdAt,
      monthlySpend: sql<string>`coalesce(sum(${costLedger.costUsd}) filter (where ${costLedger.recordedAt} >= ${since}), 0)`,
    })
    .from(orgs)
    .leftJoin(
      costLedger,
      eq(costLedger.installationId, orgs.githubInstallationId),
    )
    .where(inArray(orgs.githubInstallationId, installationIds))
    .groupBy(orgs.id);

  const byInstallation = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byInstallation.set(r.installationId, r);

  return installationIds.map((id) => {
    const row = byInstallation.get(id);
    if (!row) {
      return {
        installationId: id,
        orgId: null,
        planTier: "free",
        monthlyCapUsd: 5,
        monthlySpendUsd: 0,
        createdAt: null,
      };
    }
    return {
      installationId: id,
      orgId: row.orgId,
      planTier: row.planTier,
      monthlyCapUsd: parseFloat(row.monthlyCapUsd) || 0,
      monthlySpendUsd: parseFloat(row.monthlySpend) || 0,
      createdAt: row.createdAt,
    };
  });
}
