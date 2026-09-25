/**
 * Bounds how scans run: one at a time per installation, and at most
 * `maxConcurrent` at once across all of them.
 *
 * Per installation, serial: `checkBudget` sums the ledger, so N scans for
 * one installation that all read it before any of them spends can each
 * see the same headroom and together overshoot the cap by up to N scans.
 * Running them one after another makes each budget read see the previous
 * scan's ledger rows. This is the fix for tracker item 5b.
 *
 * Globally bounded: since the webhook acknowledges before scanning, a
 * burst of deliveries would otherwise start that many scans at once, each
 * with its whole-file fetches and model calls. The bound is per process;
 * Railway runs one.
 *
 * A waiting scan is not started, so nothing about it is timed: the
 * handler starts a scan's deadline inside the queued task.
 */

export const MAX_CONCURRENT_SCANS = 3;

export class ScanQueue {
  /** The tail of each key's chain: resolves when that key's last queued task has finished. */
  private readonly tails = new Map<string, Promise<void>>();
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(readonly maxConcurrent: number) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error(`ScanQueue: maxConcurrent must be a positive integer, got ${maxConcurrent}`);
    }
  }

  /** Tasks started and not yet finished. */
  get active(): number {
    return this.running;
  }

  /**
   * Runs `task` after every earlier task with the same `key` has finished
   * and a global slot is free. Its result or rejection is the caller's.
   */
  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let done!: () => void;
    const mine = new Promise<void>((resolve) => {
      done = resolve;
    });
    const tail = previous.then(() => mine);
    this.tails.set(key, tail);
    try {
      await previous;
      await this.acquire();
      try {
        return await task();
      } finally {
        this.release();
      }
    } finally {
      done();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  private release(): void {
    this.running--;
    const next = this.waiting.shift();
    if (next) next();
  }
}

/** The process-wide queue every scan goes through. */
export const scanQueue = new ScanQueue(MAX_CONCURRENT_SCANS);
