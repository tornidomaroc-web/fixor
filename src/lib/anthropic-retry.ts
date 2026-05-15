/**
 * Pure helpers for the Anthropic retry layer.
 *
 * Extracted so the retry decision + backoff math are unit-testable in
 * isolation — the loop itself in anthropic-client.ts is harder to test
 * without a SDK mock.
 *
 * Retry policy (5A-9):
 *   - Up to 3 retries (4 attempts total)
 *   - Exponential backoff: 1s, 2s, 4s + ±20% jitter
 *   - Honor Retry-After header (seconds OR HTTP-date), capped at 30s
 *   - Retry on 429, 5xx, SDK-level connection errors, and a small set
 *     of Node network error codes
 *   - Do NOT retry on 4xx other than 429, AbortError, or unknown errors
 *
 * SDK note: APIConnectionError / APIConnectionTimeoutError are the
 * Anthropic SDK's classes for transient network failures (no HTTP
 * status, since the request never reached the server). Verified
 * against @anthropic-ai/sdk ^0.32.1. If the SDK is upgraded across
 * major versions, re-verify these class names still exist.
 */

import {
  APIConnectionError,
  APIConnectionTimeoutError,
} from "@anthropic-ai/sdk";

export const MAX_RETRIES = 3;
export const BASE_DELAY_MS = 1000;
export const MAX_DELAY_MS = 30_000;
const JITTER_RATIO = 0.2;

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENOTFOUND",
]);

export function extractStatus(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
}

export function extractRetryAfter(err: unknown): string | undefined {
  const headers = (err as { headers?: unknown } | null)?.headers;
  if (!headers || typeof headers !== "object") return undefined;
  const h = headers as Record<string, unknown>;
  const value = h["retry-after"] ?? h["Retry-After"];
  return typeof value === "string" ? value : undefined;
}

export function isRetryable(err: unknown): boolean {
  // Our own AbortController fired (per-call timeout consumed). Don't
  // retry — the caller's timeout budget is already gone.
  if (err instanceof Error && err.name === "AbortError") return false;

  // SDK-level transient network errors: no HTTP status (request never
  // reached the server), but the SDK classifies them precisely. This
  // catches the "Connection error." case from @anthropic-ai/sdk that
  // surfaces no top-level Node `code` field on the error itself.
  // APIConnectionTimeoutError extends APIConnectionError — listed
  // explicitly for readability.
  if (err instanceof APIConnectionError) return true;
  if (err instanceof APIConnectionTimeoutError) return true;

  const status = extractStatus(err);
  if (status === 429) return true;
  if (typeof status === "number" && status >= 500 && status <= 599) return true;

  // No HTTP status → likely a network error before reaching the server.
  if (status === undefined && err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code;
    if (typeof code === "string" && RETRYABLE_NETWORK_CODES.has(code)) {
      return true;
    }
    // Belt-and-suspenders: SDK wraps the underlying Node error as
    // `cause`, and the inner error often carries the retryable code.
    // One level only — deeper chain-walking is YAGNI.
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause && typeof cause === "object" && cause !== null) {
      const causeCode = (cause as { code?: unknown }).code;
      if (
        typeof causeCode === "string" &&
        RETRYABLE_NETWORK_CODES.has(causeCode)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Delay before the next attempt. `attempt` is 0-indexed and represents
 * the attempt that JUST failed — so attempt=0 means "wait before retry
 * 1", which is 1s. attempt=2 means "wait before retry 3", which is 4s.
 *
 * If the server sent Retry-After, we honor that (capped at MAX_DELAY_MS)
 * since the rate limiter knows better than our exponent.
 *
 * @param random injectable RNG for tests; defaults to Math.random
 */
export function backoffDelayMs(
  attempt: number,
  retryAfter?: string,
  random: () => number = Math.random,
): number {
  if (retryAfter) {
    const asSeconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(asSeconds) && asSeconds > 0) {
      return Math.min(asSeconds * 1000, MAX_DELAY_MS);
    }
    const asDate = Date.parse(retryAfter);
    if (Number.isFinite(asDate)) {
      const diff = asDate - Date.now();
      if (diff > 0) return Math.min(diff, MAX_DELAY_MS);
    }
  }
  const base = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = base * JITTER_RATIO * (random() * 2 - 1);
  return Math.max(0, Math.floor(base + jitter));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
