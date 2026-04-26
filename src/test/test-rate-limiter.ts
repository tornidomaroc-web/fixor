/**
 * Unit tests for the in-memory fixed-window rate limiter.
 *
 * Uses an injectable clock so tests are deterministic — no
 * setTimeout / sleep races in the suite.
 */
import { FixedWindowRateLimiter } from "../lib/rate-limiter";

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    failures++;
  }
}

function run(): void {
  // -- basic allow/deny --------------------------------------------
  {
    let now = 1_000_000;
    const rl = new FixedWindowRateLimiter(3, 60_000, () => now);
    assert(rl.allow("k") === true, "1st request allowed");
    assert(rl.allow("k") === true, "2nd request allowed");
    assert(rl.allow("k") === true, "3rd request allowed");
    assert(rl.allow("k") === false, "4th request blocked");
    // independent key
    assert(rl.allow("other") === true, "different key has its own bucket");
  }

  // -- window roll over ---------------------------------------------
  {
    let now = 0;
    const rl = new FixedWindowRateLimiter(2, 1_000, () => now);
    assert(rl.allow("k"), "t=0: 1st allowed");
    assert(rl.allow("k"), "t=0: 2nd allowed");
    assert(!rl.allow("k"), "t=0: 3rd blocked");
    now = 999;
    assert(!rl.allow("k"), "t=999: still blocked (within window)");
    now = 1_000;
    assert(rl.allow("k"), "t=1000: window rolled, allowed");
    assert(rl.allow("k"), "t=1000: 2nd in new window allowed");
    assert(!rl.allow("k"), "t=1000: 3rd blocked");
  }

  // -- retryAfterSeconds --------------------------------------------
  {
    let now = 0;
    const rl = new FixedWindowRateLimiter(1, 60_000, () => now);
    rl.allow("k");
    now = 30_000;
    const retry = rl.retryAfterSeconds("k");
    assert(retry === 30, `~30s remaining (got ${retry})`);
    now = 60_000;
    assert(rl.retryAfterSeconds("k") === 0, "0s after window roll");
    assert(
      rl.retryAfterSeconds("never-seen") === 0,
      "0s for unknown key",
    );
  }

  // -- prune ---------------------------------------------------------
  {
    let now = 0;
    const rl = new FixedWindowRateLimiter(5, 1_000, () => now);
    rl.allow("a");
    rl.allow("b");
    now = 999;
    rl.prune();
    assert(rl.allow("a") === true, "a still active just before window");
    now = 5_000;
    rl.prune();
    // After prune, b's bucket is gone — allow() should treat as fresh
    assert(rl.allow("b") === true, "b allowed after prune (fresh bucket)");
  }

  // -- constructor validation ---------------------------------------
  let threw = false;
  try {
    new FixedWindowRateLimiter(0, 1000);
  } catch {
    threw = true;
  }
  assert(threw, "rejects maxRequests <= 0");

  threw = false;
  try {
    new FixedWindowRateLimiter(1, 0);
  } catch {
    threw = true;
  }
  assert(threw, "rejects windowMs <= 0");

  if (failures === 0) {
    console.log("[PASS] rate-limiter unit tests");
  } else {
    console.error(`[FAIL] ${failures} rate-limiter unit test(s) failed`);
    process.exit(1);
  }
}

run();
