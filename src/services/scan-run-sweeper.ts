/**
 * Finishes what a dead process left behind. The webhook acknowledges a
 * delivery once its scan_runs row exists and scans afterwards, so a
 * process that dies (deploy, crash, kill) leaves rows that are still
 * `pending` or `running` with nobody working on them.
 *
 * Rules, agreed 2026-09-23 (at-least-once, one retry, then say so):
 *   pending  -> retrying, re-run.  Nothing was spent: the first model call
 *               comes after `running`.
 *   running  -> retrying, re-run.  Spend may exist; a second charge on an
 *               interrupted scan is accepted, and the budget gate re-reads
 *               the ledger before the retry, so the cap still bounds it.
 *   retrying -> failed / interrupted, and the pull request gets the
 *               did-not-scan notice.  A third attempt is never made.
 * The row's `status` is the attempt counter, so no column is added.
 *
 * When it runs: once, `SWEEP_DELAY_MS` after the process starts, over rows
 * started more than `STALE_AFTER_MS` ago. The delay lets a previous
 * process that is still draining (deploy overlap) finish its own rows
 * instead of having them re-run. There is no polling loop: a row can only
 * become stale through a process death, and the next start sweeps it.
 * A scan that hangs inside a live process is closed by the handler's own
 * deadline (pr-webhook-handler.ts), not here.
 */
import * as Sentry from "@sentry/node";
import { logger } from "../lib/logger";
import {
  emptyOutcome,
  type ScanRunStore,
  type ScanRunSweepStore,
  type UnfinishedScanRun,
} from "./scan-run-store";

/** Ten minutes after start: longer than any one scan (its deadline) plus a drain. */
export const SWEEP_DELAY_MS = 10 * 60_000;
/** A row younger than this may still be in progress in another process. */
export const STALE_AFTER_MS = 10 * 60_000;
/** Rows per sweep. A backlog beyond this waits for the next start. */
export const SWEEP_LIMIT = 20;

export interface SweepDeps {
  store: ScanRunStore & ScanRunSweepStore;
  /** Re-runs one row (production: rerunRecordedScanRun). Its own errors are logged here. */
  rerun: (row: UnfinishedScanRun) => Promise<unknown>;
  /** Posts the did-not-scan notice for a row given up on (production: postInterruptedNotice). */
  notify: (row: UnfinishedScanRun) => Promise<unknown>;
  now?: () => Date;
  staleAfterMs?: number;
  limit?: number;
}

export interface SweepReport {
  /** Rows re-run once (pending or running before). */
  retried: string[];
  /** Rows closed as failed / interrupted, with the notice posted. */
  abandoned: string[];
  /** Rows that finished between the listing and the update: left alone. */
  skipped: string[];
}

export async function sweepUnfinishedScanRuns(deps: SweepDeps): Promise<SweepReport> {
  const now = deps.now ?? (() => new Date());
  const before = new Date(now().getTime() - (deps.staleAfterMs ?? STALE_AFTER_MS));
  const report: SweepReport = { retried: [], abandoned: [], skipped: [] };

  let rows: UnfinishedScanRun[];
  try {
    rows = await deps.store.listUnfinished(before, deps.limit ?? SWEEP_LIMIT);
  } catch (err) {
    logger.error({ err }, "scan_runs sweep: could not list unfinished rows");
    Sentry.captureException(err, { tags: { "fixor.phase": "scan_run_sweep" } });
    return report;
  }

  // One at a time: a sweep after a restart must not start twenty scans at
  // once on a process that also serves live deliveries.
  for (const row of rows) {
    const where = { scanRunId: row.id, status: row.status, repo: row.repoFullName, pullNumber: row.pullNumber, headSha: row.headSha };
    try {
      if (row.status === "retrying") {
        await deps.store.finish(row.id, emptyOutcome("failed", "interrupted"), now());
        report.abandoned.push(row.id);
        logger.error(where, "scan_runs sweep: retry did not finish either; row closed as interrupted, notice posted");
        await deps.notify(row);
        continue;
      }
      const marked = await deps.store.markRetrying(row.id);
      if (!marked) {
        report.skipped.push(row.id);
        continue;
      }
      report.retried.push(row.id);
      logger.warn(where, "scan_runs sweep: unfinished row from a previous process; re-running once");
      await deps.rerun(row);
    } catch (err) {
      logger.error({ ...where, err }, "scan_runs sweep: row could not be handled");
      Sentry.captureException(err, { tags: { "fixor.phase": "scan_run_sweep" }, extra: where });
    }
  }
  return report;
}

/** One sweep, `delayMs` after the call; the timer never keeps the process alive. */
export function scheduleStartupSweep(
  deps: SweepDeps,
  delayMs: number = SWEEP_DELAY_MS,
): NodeJS.Timeout {
  const timer = setTimeout(() => {
    void sweepUnfinishedScanRuns(deps).then((report) => {
      logger.info(report, "scan_runs sweep finished");
    });
  }, delayMs);
  timer.unref();
  return timer;
}
