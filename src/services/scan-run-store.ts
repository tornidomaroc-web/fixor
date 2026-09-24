/**
 * The `scan_runs` writer: one row per pull_request delivery Fixor acted on.
 *
 * Lifecycle, driven by pr-webhook-handler.ts:
 *   createPending  as soon as the delivery is validated and names an
 *                  installation, before any GitHub call or budget read;
 *   markRunning    when the budget allowed the scan and the workflow starts;
 *   finish         exactly once, from the handler's `finally`, with the
 *                  outcome of the delivery.
 *
 * The row is the record of a received delivery, so acknowledge-then-scan
 * can reuse it as its queue entry without a second schema.
 *
 * `delivery_id` is unique. createPending inserts with ON CONFLICT DO
 * NOTHING: a redelivered event (same X-GitHub-Delivery) inserts nothing,
 * returns `created: false`, and the handler does not scan it again, so it
 * is not charged again. The guard has to be the conflict clause. Without
 * it the insert raises a unique violation, the handler treats that as a
 * failed insert and scans anyway, which is exactly the double charge.
 *
 * `error_message` only ever holds a message from SCAN_RUN_MESSAGES. The
 * dashboard shows it to every member of the org, and raw error text can
 * quote code, internal hosts or GitHub responses.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { scanRuns } from "../db/schema";
import type { WorkflowResult } from "../types/workflow.types";
import { ensureInstallation } from "./cost-store";

export type ScanRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "incomplete"
  | "skipped"
  | "failed";

export type ScanRunCode =
  | "budget_exceeded"
  | "budget_unverifiable"
  | "pr_fetch_refused"
  | "comment_refused"
  | "coverage_degraded"
  | "scan_failed"
  | "internal_error";

/** The only strings `scan_runs.error_message` may hold. */
export const SCAN_RUN_MESSAGES: Readonly<Record<ScanRunCode, string>> = {
  budget_exceeded:
    "Not scanned: this installation reached its usage budget for the period.",
  budget_unverifiable:
    "Not scanned: Fixor could not verify this installation's usage budget.",
  pr_fetch_refused:
    "Not scanned: GitHub refused Fixor's request for the pull request.",
  comment_refused:
    "Scanned, but GitHub refused the report comment, so the pull request has no Fixor report for this commit.",
  coverage_degraded:
    "Incomplete: some files or checks could not be analyzed, so these findings are not a complete result.",
  scan_failed: "The scan did not complete.",
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
  markRunning(id: string): Promise<void>;
  finish(id: string, outcome: ScanRunOutcome, finishedAt: Date): Promise<void>;
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
): ScanRunStore {
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
      await database()
        .update(scanRuns)
        .set({ status: "running" })
        .where(and(eq(scanRuns.id, id), isNull(scanRuns.finishedAt)));
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
