/**
 * In-memory fixed-window rate limiter.
 *
 * Phase 5B-5 — single Railway worker assumption matches our deploy.
 * When we scale to multiple workers, swap the storage to Redis or a
 * Postgres advisory-lock based counter; the call sites use only the
 * `allow(key)` API so the swap is mechanical.
 *
 * Algorithm: fixed-window counter. Each key has a (count, windowStart).
 * Once `now - windowStart >= windowMs` the count resets. Bursts up to
 * `maxRequests` within a window are allowed; the (maxRequests+1)-th
 * call is rejected until the window rolls.
 *
 * Memory growth: one entry per active key. For API tokens this is
 * bounded by the token count (small). The `prune` method evicts
 * stale entries; callers can call it from a periodic timer. Skipped
 * by default — Node's GC will reclaim when keys go cold.
 */

interface Bucket {
  count: number;
  windowStart: number;
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    public readonly maxRequests: number,
    public readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (maxRequests <= 0) throw new Error("maxRequests must be > 0");
    if (windowMs <= 0) throw new Error("windowMs must be > 0");
  }

  /** Returns true if the request is allowed; false if it exceeds the cap. */
  allow(key: string): boolean {
    const t = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || t - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: t });
      return true;
    }
    if (bucket.count >= this.maxRequests) return false;
    bucket.count++;
    return true;
  }

  /**
   * Approximate seconds until the current window resets for `key`.
   * Returns 0 if the key has no bucket or the window has rolled.
   */
  retryAfterSeconds(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    const elapsed = this.now() - bucket.windowStart;
    if (elapsed >= this.windowMs) return 0;
    return Math.max(1, Math.ceil((this.windowMs - elapsed) / 1000));
  }

  /** Remove buckets whose window has fully rolled. Optional housekeeping. */
  prune(): void {
    const t = this.now();
    for (const [key, bucket] of this.buckets) {
      if (t - bucket.windowStart >= this.windowMs) {
        this.buckets.delete(key);
      }
    }
  }

  /** Test helper. */
  reset(): void {
    this.buckets.clear();
  }
}
