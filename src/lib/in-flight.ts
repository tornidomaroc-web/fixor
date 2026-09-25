/**
 * Tracks work that outlives the HTTP request that started it, so shutdown
 * can wait for it. Once the webhook acknowledges a delivery before scanning
 * it, `server.close()` alone would let the process exit with a scan half
 * done and its scan_runs row never finished.
 */
import { logger } from "./logger";

export class InFlightTracker {
  private readonly tasks = new Set<Promise<unknown>>();

  get size(): number {
    return this.tasks.size;
  }

  /** Runs `task` now; a rejection is logged, never unhandled. */
  track(label: string, task: () => Promise<unknown>): Promise<void> {
    const p: Promise<void> = Promise.resolve()
      .then(task)
      .then(
        () => undefined,
        (err: unknown) => {
          logger.error({ err, label }, "background task failed");
        },
      )
      .finally(() => {
        this.tasks.delete(p);
      });
    this.tasks.add(p);
    return p;
  }

  /**
   * Waits for every tracked task, up to `timeoutMs`. `drained` is false
   * when the timeout won and `remaining` tasks were still running.
   */
  async drain(timeoutMs: number): Promise<{ drained: boolean; remaining: number }> {
    if (this.tasks.size === 0) return { drained: true, remaining: 0 };
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const all = Promise.allSettled([...this.tasks]).then(() => "done" as const);
    const winner = await Promise.race([all, timeout]);
    if (timer) clearTimeout(timer);
    return { drained: winner === "done", remaining: this.tasks.size };
  }
}
