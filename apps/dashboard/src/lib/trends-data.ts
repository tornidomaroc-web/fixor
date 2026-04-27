/**
 * Server-only data layer for the 5C-7 trends widget.
 *
 * Two outputs from one date-bounded scan_runs scan:
 *   - weekly: scan + finding counts bucketed by ISO-week (UTC), zero-
 *     filled so the chart x-axis is contiguous even for inactive weeks.
 *   - byFamily: per-detector finding sums, derived from the
 *     `findings_by_family` jsonb column (5C-7 migration 0003).
 *
 * Both are scoped to an installation_id rather than an org.id — the
 * caller (scans page) has already done the auth check via
 * getOrgForUser, so this layer just runs queries.
 */
import "server-only";
import { and, gte, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { scanRuns } from "@/db/schema";
import { DETECTOR_OPTIONS } from "@/lib/detectors";

export interface WeeklyPoint {
  /** ISO date string for the Monday of the ISO-week, UTC. */
  weekStart: string;
  scans: number;
  findings: number;
}

export interface FamilyPoint {
  /** Detector id (e.g. `xss-js-ts`). */
  family: string;
  /** Human label resolved from DETECTOR_OPTIONS, falls back to id. */
  label: string;
  count: number;
}

export interface Trends {
  weekly: WeeklyPoint[];
  byFamily: FamilyPoint[];
  /** Total scans in the window. UI uses this to short-circuit empty
   *  states without a second count query. */
  totalScans: number;
  /** Number of weeks the series spans (always === weeksBack). */
  weeks: number;
}

const DEFAULT_WEEKS = 12;

export async function getTrendsForOrg(
  installationId: string,
  weeksBack: number = DEFAULT_WEEKS,
): Promise<Trends> {
  const weeks = Math.max(1, Math.floor(weeksBack));
  const since = startOfIsoWeekUtc(new Date());
  since.setUTCDate(since.getUTCDate() - 7 * (weeks - 1));

  // 1) Weekly bucketed counts. date_trunc('week', ...) returns the
  //    Monday at 00:00 UTC for a given timestamp — that's our bucket
  //    key. We then zero-fill in JS so the chart x-axis covers every
  //    week even when no scans landed.
  const weeklyRows = await db()
    .select({
      weekStart: sql<Date>`date_trunc('week', ${scanRuns.startedAt} AT TIME ZONE 'UTC')`,
      scans: sql<number>`count(*)::int`,
      findings: sql<number>`coalesce(sum(${scanRuns.totalFindings}), 0)::int`,
    })
    .from(scanRuns)
    .where(
      and(
        eq(scanRuns.installationId, installationId),
        gte(scanRuns.startedAt, since),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1 asc`);

  const weeklyByKey = new Map<string, { scans: number; findings: number }>();
  for (const r of weeklyRows) {
    const key = isoDateUtc(new Date(r.weekStart));
    weeklyByKey.set(key, { scans: r.scans, findings: r.findings });
  }
  const weekly: WeeklyPoint[] = [];
  for (let i = 0; i < weeks; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + 7 * i);
    const key = isoDateUtc(d);
    const cell = weeklyByKey.get(key);
    weekly.push({
      weekStart: key,
      scans: cell?.scans ?? 0,
      findings: cell?.findings ?? 0,
    });
  }

  // 2) Per-family finding sums. jsonb_each unrolls each row's
  //    findings_by_family into (key, value) pairs which we then sum
  //    across rows. The cast ::text::int handles the jsonb -> int
  //    conversion (jsonb_each returns the value as jsonb, not numeric).
  const familyRows = await db().execute<{ family: string; count: number }>(
    sql`
      SELECT entry.key AS family,
             SUM((entry.value)::text::int)::int AS count
      FROM ${scanRuns},
           LATERAL jsonb_each(${scanRuns.findingsByFamily}) AS entry
      WHERE ${scanRuns.installationId} = ${installationId}
        AND ${scanRuns.startedAt} >= ${since}
      GROUP BY entry.key
      HAVING SUM((entry.value)::text::int) > 0
      ORDER BY count DESC
    `,
  );

  const labelById = new Map(DETECTOR_OPTIONS.map((d) => [d.id, d.label]));
  const byFamily: FamilyPoint[] = (familyRows.rows ?? familyRows).map(
    (r: { family: string; count: number | string }) => ({
      family: r.family,
      label: labelById.get(r.family) ?? r.family,
      count: typeof r.count === "string" ? parseInt(r.count, 10) || 0 : r.count,
    }),
  );

  const totalScans = weekly.reduce((acc, w) => acc + w.scans, 0);

  return { weekly, byFamily, totalScans, weeks };
}

/** ISO-week semantics in UTC: rewind to Monday 00:00 UTC. */
function startOfIsoWeekUtc(d: Date): Date {
  const x = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  // getUTCDay: 0=Sunday..6=Saturday. ISO week starts Monday.
  const dow = (x.getUTCDay() + 6) % 7; // 0 if Monday
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}

function isoDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
