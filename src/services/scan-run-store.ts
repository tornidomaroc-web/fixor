/**
 * The `scan_runs` writer: one row per pull_request delivery Fixor acted on.
 *
 * Lifecycle, driven by pr-webhook-handler.ts:
 *   createPending  as soon as the delivery is validated and names an
 *                  installation, before the webhook is acknowledged and
 *                  before any GitHub call or budget read;
 *   markRunning    when the budget allowed the scan and the workflow starts
 *                  (pending -> running only; a retrying row stays retrying);
 *   finish         exactly once, from the run's `finally`, with the
 *                  outcome of the delivery.
 *
 * The row is the record of a received delivery: the webhook acknowledges
 * once it exists, and the scan runs afterwards. A process that dies leaves
 * the row unfinished, and scan-run-sweeper.ts picks it up:
 *   pending/running -> retrying   re-run once (at-least-once; a running row
 *                                 may have spent, and the cap bounds a
 *                                 second charge);
 *   retrying, still unfinished -> failed / interrupted, and the pull
 *                                 request gets the did-not-scan notice.
 * `status` is the attempt counter: no second column, no migration.
 *
 * `delivery_id` is unique. createPending inserts with ON CONFLICT DO
 * NOTHING: a redelivered event (same X-GitHub-Delivery) inserts nothing,
 * returns `created: false`, and the handler does not scan it again, so it
 * is not charged again. The guard has to be the conflict clause. Without
 * it the insert raises a unique violation, the handler treats that as a
 * failed insert and scans anyway, which is exactly the double charge.
 * A delivery whose row finished `failed` is therefore not re-run by a
 * redelivery either; the owner retries it by pushing a new commit (new
 * delivery, new row), never by re-scanning a delivery that may have spent.
 *
 * `error_message` only ever holds a message from SCAN_RUN_MESSAGES. The
 * dashboard shows it to every member of the org, and raw error text can
 * quote code, internal hosts or GitHub responses.
 */
import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "../db/client";
import { scanRuns } from "../db/schema";
import type { WorkflowResult } from "../types/workflow.types";
import { ensureInstallation } from "./cost-store";

export type ScanRunStatus =
  | "pending"
  | "running"
  /** Second attempt after the process died mid-scan; a third is never made. */
  | "retrying"
  | "completed"
  | "incomplete"
  | "skipped"
  | "failed";

export type ScanRunCode =
  | "budget_exceeded"
  | "budget_unverifiable"
  | "spend_unrecordable"
  | "spend_unrecorded"
  | "pr_fetch_refused"
  | "comment_refused"
  | "coverage_degraded"
  | "scan_failed"
  | "interrupted"
  | "timed_out"
  | "internal_error";

/** The only strings `scan_runs.error_message` may hold. */
export const SCAN_RUN_MESSAGES: Readonly<Record<ScanRunCode, string>> = {
  budget_exceeded:
    "Not scanned: this installation reached its usage budget for the period.",
  budget_unverifiable:
    "Not scanned: Fixor could not verify this installation's usage budget.",
  spend_unrecordable:
    "Not scanned: Fixor could not record usage for this scan, so it did not start it.",
  spend_unrecorded:
    "Incomplete: Fixor could not record this scan's usage, so it stopped before finishing. These findings are not a complete result.",
  pr_fetch_refused:
    "Not scanned: GitHub refused Fixor's request for the pull request.",
  comment_refused:
    "Scanned, but GitHub refused the report comment, so the pull request has no Fixor report for this commit.",
  coverage_degraded:
    "Incomplete: some files or checks could not be analyzed, so these findings are not a complete result.",
  scan_failed: "The scan did not complete.",
  interrupted:
    "Not completed: the scan was interrupted before it finished, and its retry did not finish either. Push a new commit to scan again.",
  timed_out: "Not completed: the scan did not finish within Fixor's time limit.",
  internal_error: "The scan stopped on an internal error.",
};

export interface ScanRunStart {
  installationId: string;
  deliveryId: string | null;
  repoFullName: string;
  pullNumber: number;
  headSha: string;
  startedAt: Date;
}

export type ScanRunCreateResult =
  | { created: true; id: string }
  | { created: false; reason: "duplicate_delivery" };

export interface ScanRunOutcome {
  status: Exclude<ScanRunStatus, "pending" | "running">;
  code: ScanRunCode | null;
  totalFindings: number;
  findingsByFamily: Record<string, number>;
  fixesGenerated: number;
  costUsd: number;
}

export interface ScanRunStore {
  createPending(start: ScanRunStart): Promise<ScanRunCreateResult>;
  /** pending -> running. A retrying row keeps its status, so the retry stays visible. */
  markRunning(id: string): Promise<void>;
  finish(id: string, outcome: ScanRunOutcome, finishedAt: Date): Promise<void>;
}

/** An unfinished row, with what a re-run needs. */
export interface UnfinishedScanRun {
  id: string;
  installationId: string;
  deliveryId: string | null;
  repoFullName: string;
  pullNumber: number;
  headSha: string;
  status: "pending" | "running" | "retrying";
  startedAt: Date;
}

/** What the sweeper needs beyond the handler's store (scan-run-sweeper.ts). */
export interface ScanRunSweepStore {
  /** Unfinished rows started before `before`, oldest first, at most `limit`. */
  listUnfinished(before: Date, limit: number): Promise<UnfinishedScanRun[]>;
  /** pending or running -> retrying. False when the row is no longer either. */
  markRetrying(id: string): Promise<boolean>;
}

/** An outcome with nothing counted: the scan did not run, or ran nothing. */
export function emptyOutcome(
  status: ScanRunOutcome["status"],
  code: ScanRunCode | null,
): ScanRunOutcome {
  return {
    status,
    code,
    totalFindings: 0,
    findingsByFamily: {},
    fixesGenerated: 0,
    costUsd: 0,
  };
}

/**
 * Maps a workflow result onto a row outcome. Detection coverage decides
 * between `completed` and `incomplete`; a failed fix is not a failed scan
 * (the workflow reports `failed` when findings got no fix, yet the PR
 * comment is a full report).
 */
export function outcomeFromWorkflow(
  workflow: WorkflowResult,
  costUsd: number,
  scanInputDegraded: boolean,
): ScanRunOutcome {
  const counted = {
    totalFindings: workflow.totalFindings,
    findingsByFamily: { ...(workflow.findingsByDetector ?? {}) },
    fixesGenerated: workflow.fixesGenerated,
    costUsd,
  };
  if (workflow.status === "budget_exceeded") {
    return { ...emptyOutcome("skipped", "budget_exceeded"), costUsd };
  }
  if (workflow.status === "budget_unverifiable") {
    return { ...emptyOutcome("skipped", "budget_unverifiable"), costUsd };
  }
  if (workflow.status === "spend_unrecordable") {
    return { ...emptyOutcome("skipped", "spend_unrecordable"), costUsd };
  }
  // No coverage tally means the workflow never reached detection: it
  // threw, timed out, or rejected its input.
  if (workflow.llmCoverage === undefined && workflow.status === "failed") {
    return { status: "failed", code: "scan_failed", ...counted };
  }
  const degraded =
    scanInputDegraded ||
    (workflow.llmCoverage?.failed ?? 0) > 0 ||
    (workflow.detectorFailures?.length ?? 0) > 0;
  if (degraded) {
    return { status: "incomplete", code: "coverage_degraded", ...counted };
  }
  return { status: "completed", code: null, ...counted };
}

type Database = ReturnType<typeof db>;

/** Production store. `database` is injectable so the SQL can be witnessed keylessly. */
export function drizzleScanRunStore(
  database: () => Database = db,
): ScanRunStore & ScanRunSweepStore {
  return {
    async createPending(start) {
      const d = database();
      await ensureInstallation(start.installationId, d);
      const rows = await d
        .insert(scanRuns)
        .values({
          installationId: start.installationId,
          deliveryId: start.deliveryId,
          repoFullName: start.repoFullName,
          pullNumber: start.pullNumber,
          headSha: start.headSha,
          status: "pending",
          startedAt: start.startedAt,
        })
        .onConflictDoNothing({ target: scanRuns.deliveryId })
        .returning({ id: scanRuns.id });
      const row = rows[0];
      if (row) return { created: true, id: row.id };
      if (start.deliveryId === null) {
        throw new Error("scan_runs insert returned no row");
      }
      return { created: false, reason: "duplicate_delivery" };
    },

    async markRunning(id) {
      // `status = 'pending'` keeps a retrying row marked as the retry it
      // is; without it the sweeper could not tell a second attempt from a
      // first and would re-run the row a third time.
      await database()
        .update(scanRuns)
        .set({ status: "running" })
        .where(
          and(
            eq(scanRuns.id, id),
            eq(scanRuns.status, "pending"),
            isNull(scanRuns.finishedAt),
          ),
        );
    },

    async listUnfinished(before, limit) {
      const rows = await database()
        .select({
          id: scanRuns.id,
          installationId: scanRuns.installationId,
          deliveryId: scanRuns.deliveryId,
          repoFullName: scanRuns.repoFullName,
          pullNumber: scanRuns.pullNumber,
          headSha: scanRuns.headSha,
          status: scanRuns.status,
          startedAt: scanRuns.startedAt,
        })
        .from(scanRuns)
        .where(
          and(
            isNull(scanRuns.finishedAt),
            inArray(scanRuns.status, ["pending", "running", "retrying"]),
            lt(scanRuns.startedAt, before),
          ),
        )
        .orderBy(asc(scanRuns.startedAt))
        .limit(limit);
      return rows.map((r) => ({
        ...r,
        status: r.status as UnfinishedScanRun["status"],
      }));
    },

    async markRetrying(id) {
      const rows = await database()
        .update(scanRuns)
        .set({ status: "retrying" })
        .where(
          and(
            eq(scanRuns.id, id),
            inArray(scanRuns.status, ["pending", "running"]),
            isNull(scanRuns.finishedAt),
          ),
        )
        .returning({ id: scanRuns.id });
      return rows.length > 0;
    },

    async finish(id, outcome, finishedAt) {
      // `finished_at IS NULL` makes the final state write-once in the
      // database as well as in the handler.
      await database()
        .update(scanRuns)
        .set({
          status: outcome.status,
          errorMessage: outcome.code ? SCAN_RUN_MESSAGES[outcome.code] : null,
          totalFindings: outcome.totalFindings,
          findingsByFamily: outcome.findingsByFamily,
          fixesGenerated: outcome.fixesGenerated,
          costUsd: outcome.costUsd.toFixed(6),
          finishedAt,
        })
        .where(and(eq(scanRuns.id, id), isNull(scanRuns.finishedAt)));
    },
  };
}
