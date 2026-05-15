/**
 * Pure-function tests for the Anthropic retry helpers.
 *
 * The retry loop itself in anthropic-client.ts depends on the SDK's
 * messages.create — that's an integration test, not a unit test, and
 * lives outside this suite. Here we exercise the math and the
 * decision logic that backs the loop.
 */
import {
  APIConnectionError,
  APIConnectionTimeoutError,
} from "@anthropic-ai/sdk";

import {
  BASE_DELAY_MS,
  MAX_DELAY_MS,
  MAX_RETRIES,
  backoffDelayMs,
  extractRetryAfter,
  extractStatus,
  isRetryable,
} from "../lib/anthropic-retry";

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    failures++;
  }
}

function run(): void {
  // -- isRetryable ----------------------------------------------------
  assert(isRetryable({ status: 429 }) === true, "429 is retryable");
  assert(isRetryable({ status: 500 }) === true, "500 is retryable");
  assert(isRetryable({ status: 502 }) === true, "502 is retryable");
  assert(isRetryable({ status: 503 }) === true, "503 is retryable");
  assert(isRetryable({ status: 504 }) === true, "504 is retryable");
  assert(isRetryable({ status: 599 }) === true, "599 is retryable");

  assert(isRetryable({ status: 400 }) === false, "400 is NOT retryable");
  assert(isRetryable({ status: 401 }) === false, "401 is NOT retryable");
  assert(isRetryable({ status: 403 }) === false, "403 is NOT retryable");
  assert(isRetryable({ status: 404 }) === false, "404 is NOT retryable");
  assert(isRetryable({ status: 200 }) === false, "200 is NOT retryable");

  // AbortError never retries (timeout already consumed)
  const abortErr = new Error("aborted");
  abortErr.name = "AbortError";
  assert(isRetryable(abortErr) === false, "AbortError is NOT retryable");

  // Network codes
  const econnreset = Object.assign(new Error("conn reset"), {
    code: "ECONNRESET",
  });
  assert(isRetryable(econnreset) === true, "ECONNRESET is retryable");
  const etimedout = Object.assign(new Error("timed out"), {
    code: "ETIMEDOUT",
  });
  assert(isRetryable(etimedout) === true, "ETIMEDOUT is retryable");
  const efoo = Object.assign(new Error("nope"), { code: "EFOO" });
  assert(isRetryable(efoo) === false, "unknown error code is NOT retryable");

  // SDK-level connection errors: no HTTP status, no top-level code,
  // but classified retryable by class (the "Connection error." case
  // from @anthropic-ai/sdk that bit us in IDOR validation).
  const connErr = new APIConnectionError({ message: "Connection error." });
  assert(isRetryable(connErr) === true, "APIConnectionError is retryable");
  const connTimeoutErr = new APIConnectionTimeoutError({ message: "slow" });
  assert(
    isRetryable(connTimeoutErr) === true,
    "APIConnectionTimeoutError is retryable",
  );

  // Cause-chain walk: SDK wraps the underlying Node error as `cause`.
  const wrappedNetErr = Object.assign(new Error("wrapped"), {
    cause: Object.assign(new Error("inner"), { code: "ECONNRESET" }),
  });
  assert(
    isRetryable(wrappedNetErr) === true,
    "ECONNRESET via err.cause is retryable",
  );

  assert(isRetryable(null) === false, "null is NOT retryable");
  assert(isRetryable(undefined) === false, "undefined is NOT retryable");
  assert(isRetryable("string error") === false, "string is NOT retryable");

  // -- extractStatus --------------------------------------------------
  assert(extractStatus({ status: 503 }) === 503, "extracts numeric status");
  assert(
    extractStatus({ status: "503" }) === undefined,
    "string status returns undefined",
  );
  assert(extractStatus({}) === undefined, "no status returns undefined");
  assert(extractStatus(null) === undefined, "null returns undefined");

  // -- extractRetryAfter ----------------------------------------------
  assert(
    extractRetryAfter({ headers: { "retry-after": "5" } }) === "5",
    "lower-case retry-after header read",
  );
  assert(
    extractRetryAfter({ headers: { "Retry-After": "10" } }) === "10",
    "Title-case Retry-After header read",
  );
  assert(
    extractRetryAfter({ headers: {} }) === undefined,
    "missing header returns undefined",
  );
  assert(
    extractRetryAfter({}) === undefined,
    "no headers object returns undefined",
  );

  // -- backoffDelayMs (deterministic when random=0.5 -> jitter=0) ------
  // base*2^attempt with random=0.5 gives jitter of 0
  const noJitter = () => 0.5;
  assert(
    backoffDelayMs(0, undefined, noJitter) === BASE_DELAY_MS,
    `attempt 0: ${BASE_DELAY_MS}ms (no jitter)`,
  );
  assert(
    backoffDelayMs(1, undefined, noJitter) === BASE_DELAY_MS * 2,
    `attempt 1: ${BASE_DELAY_MS * 2}ms (no jitter)`,
  );
  assert(
    backoffDelayMs(2, undefined, noJitter) === BASE_DELAY_MS * 4,
    `attempt 2: ${BASE_DELAY_MS * 4}ms (no jitter)`,
  );

  // Jitter bounds: with random=0 -> minus 20%; random=1 -> plus 20%
  const minJitter = () => 0;
  const maxJitter = () => 1;
  const attempt0Min = backoffDelayMs(0, undefined, minJitter);
  const attempt0Max = backoffDelayMs(0, undefined, maxJitter);
  assert(
    attempt0Min === Math.floor(BASE_DELAY_MS * 0.8),
    `min jitter: ${attempt0Min} = 80% of ${BASE_DELAY_MS}`,
  );
  assert(
    attempt0Max === Math.floor(BASE_DELAY_MS * 1.2),
    `max jitter: ${attempt0Max} = 120% of ${BASE_DELAY_MS}`,
  );

  // Retry-After in seconds wins over backoff
  assert(
    backoffDelayMs(0, "7", noJitter) === 7000,
    "Retry-After: 7 → 7000ms (overrides backoff)",
  );
  // Cap at MAX_DELAY_MS
  assert(
    backoffDelayMs(0, "120", noJitter) === MAX_DELAY_MS,
    `Retry-After: 120 → capped at ${MAX_DELAY_MS}ms`,
  );

  // Retry-After as HTTP-date in the past → falls through to backoff
  const pastDate = new Date(Date.now() - 60_000).toUTCString();
  assert(
    backoffDelayMs(1, pastDate, noJitter) === BASE_DELAY_MS * 2,
    "Retry-After in the past falls back to exponential",
  );
  // Retry-After as HTTP-date in the future. toUTCString() rounds to
  // whole seconds, and a few hundred ms can pass between building the
  // string and calling backoffDelayMs, so widen the bound generously.
  const futureDate = new Date(Date.now() + 5_000).toUTCString();
  const futureDelay = backoffDelayMs(0, futureDate, noJitter);
  assert(
    futureDelay > 0 && futureDelay <= 5_500,
    `Retry-After future date: in (0, 5500]ms (got ${futureDelay})`,
  );

  // Garbage Retry-After → fall through to backoff
  assert(
    backoffDelayMs(0, "tomorrow-ish", noJitter) === BASE_DELAY_MS,
    "garbage Retry-After ignored",
  );

  // -- constants ------------------------------------------------------
  assert(MAX_RETRIES === 3, "MAX_RETRIES is 3 per roadmap");
  assert(BASE_DELAY_MS === 1000, "BASE_DELAY_MS is 1000 per roadmap");

  if (failures === 0) {
    console.log("[PASS] anthropic-retry unit tests");
  } else {
    console.error(`[FAIL] ${failures} anthropic-retry unit test(s) failed`);
    process.exit(1);
  }
}

run();
