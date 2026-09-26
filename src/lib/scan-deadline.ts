/**
 * One deadline rule for every scan, webhook or API (tracker items 5c, 5d).
 *
 * What a deadline does:
 *   1. Answers the caller at `deadlineMs` with the timed-out result.
 *   2. Cancels the scan's model calls: `cancel.cancelled` is set, and
 *      callClaude (anthropic-client.ts) refuses every later call in that
 *      scan before it reaches the network, the same way it refuses after a
 *      ledger write failed. Spend after the deadline is therefore zero,
 *      which is what the row's `timed_out` outcome records.
 *   3. Does NOT free the scan's queue slot (lib/scan-queue.ts). The slot is
 *      held until the scan settles, so `MAX_CONCURRENT_SCANS` bounds the
 *      scans that are actually running, not the ones whose caller stopped
 *      waiting. Before this, the deadline resolved the queued task, and the
 *      slot was handed to the next scan while the timed-out one kept going.
 *
 * Why the hold is bounded: GitHub fetches carry no timeout, so a scan can
 * hang past its deadline on a fetch that never returns. A slot pinned
 * forever would starve every later scan for that installation and, with
 * three of them, the whole process. So the slot is held for at most
 * `graceMs` after the deadline (default: the deadline again); then it is
 * released with a Sentry error, and the hung task runs on with no model
 * calls possible (rule 2), so it costs nothing and counts against no cap.
 * The bound of `MAX_CONCURRENT_SCANS` thus holds for every scan that can
 * spend; only a cancelled, spend-free task can ever exceed it.
 *
 * Why not cancel the I/O itself: the scan's fetches are not abortable
 * today (no AbortSignal reaches them), and making them so touches every
 * GitHub call. Cancelling the model calls is the part that bounds money and
 * the part the queue exists to bound; the rest is a later change.
 *
 * The sweeper (scan-run-sweeper.ts) is unaffected: the row is finished as
 * `timed_out` at the deadline, exactly as before, so it is never listed as
 * unfinished and never re-run by a later process.
 */
import * as Sentry from "@sentry/node";
import { logger } from "./logger";
import type { ScanCancel } from "./cost-context";

/** Longest a scan may run once started. Waiting in the queue does not count. */
export const DEFAULT_SCAN_DEADLINE_MS = 10 * 60_000;

export interface ScanDeadlineOptions<T> {
  /** The scan, as queued: resolves when the work has actually settled. */
  scan: Promise<T>;
  deadlineMs: number;
  /** Set at the deadline; callClaude refuses once it is. */
  cancel: ScanCancel;
  /** Builds the caller's answer when the deadline wins. May close a row first. */
  onDeadline: () => Promise<T> | T;
  /** For the log and Sentry lines. */
  label: Record<string, unknown>;
  /**
   * When the clock starts. The scan may wait in the queue before it runs,
   * and waiting is not scanning: the deadline is armed only once this
   * resolves (the queued work's first line). Omitted, it is armed at once.
   */
  startsWhen?: Promise<void>;
}

/**
 * Races `scan` against `deadlineMs`, counted from `startsWhen`. Resolves
 * with the scan's result if it settles first, otherwise with
 * `onDeadline()`'s result after cancelling the scan's model calls. Never
 * rejects on the deadline path; a late rejection of the scan itself is
 * logged, never unhandled.
 */
export function withScanDeadline<T>(opts: ScanDeadlineOptions<T>): Promise<T> {
  const { scan, deadlineMs, cancel, onDeadline, label } = opts;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      if (settled) return;
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cancel.cancelled = true;
        logger.error(
          { ...label, deadlineMs },
          "scan did not finish within the deadline: its model calls are cancelled and the caller is answered",
        );
        Sentry.captureMessage("scan deadline exceeded", {
          level: "error",
          tags: { "fixor.phase": "scan_deadline" },
          extra: { ...label, deadlineMs },
        });
        // The late result, if any, must not become an unhandled rejection.
        scan.catch((err) => {
          logger.error({ ...label, err }, "scan failed after its deadline");
        });
        Promise.resolve()
          .then(onDeadline)
          .then(resolve, reject);
      }, deadlineMs);
    };
    if (opts.startsWhen) void opts.startsWhen.then(arm);
    else arm();
    scan.then(
      (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** A promise and the function that resolves it: the queued work calls `started()` on its first line. */
export function startSignal(): { started: () => void; whenStarted: Promise<void> } {
  let started!: () => void;
  const whenStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  return { started, whenStarted };
}

export interface HoldSlotOptions<T> {
  /** The scan's work; the queue slot is held until it settles or the hold expires. */
  work: () => Promise<T>;
  /** Fires when the hold expires with the work still running. */
  onLeak: () => void;
  /** How long past `deadlineMs` the slot may be held. */
  deadlineMs: number;
  graceMs?: number;
}

/**
 * Runs `work` inside a queue slot and returns a promise for its result.
 * The returned promise settles when the work settles, OR when
 * `deadlineMs + graceMs` has passed with the work still running: then the
 * slot is released (the queue sees the task as done) and `onLeak` fires.
 * Meant to be the task handed to `ScanQueue.run`.
 */
export function holdSlotUntilSettled<T>(opts: HoldSlotOptions<T>): () => Promise<T | undefined> {
  const graceMs = opts.graceMs ?? opts.deadlineMs;
  return () =>
    new Promise<T | undefined>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        opts.onLeak();
        resolve(undefined);
      }, opts.deadlineMs + graceMs);
      opts.work().then(
        (value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(err);
        },
      );
    });
}

/** The Sentry and log lines for a slot released with its scan still running. */
export function reportSlotLeak(label: Record<string, unknown>, heldMs: number): void {
  logger.error(
    { ...label, heldMs },
    "scan still running after its deadline and grace: its queue slot is released; it can make no model calls",
  );
  Sentry.captureMessage("scan slot released with scan still running", {
    level: "error",
    tags: { "fixor.phase": "scan_slot_leak" },
    extra: { ...label, heldMs },
  });
}
