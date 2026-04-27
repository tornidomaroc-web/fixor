/**
 * Pure verification + parsing for Paddle Billing webhooks.
 *
 * Kept separate from the route handler so the signature recipe is
 * unit-testable without spinning up Next.js. The route handler does
 * IO (read body, lookup org, write rows); this file is just bytes
 * in, decision out.
 *
 * Paddle's signature header looks like:
 *   ts=1671552777;h1=eb4d0dc8853be...
 * The signed payload is `<ts>:<rawBody>`, HMAC-SHA256, hex-encoded,
 * compared against `h1` in constant time.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface ParsedSignature {
  ts: number;
  h1: string;
}

/**
 * Splits the `Paddle-Signature` header into its `ts=…;h1=…` parts.
 * Returns null when the header is missing or malformed — the route
 * handler treats that as a 401 the same way it treats a bad HMAC.
 */
export function parsePaddleSignatureHeader(
  header: string | null | undefined,
): ParsedSignature | null {
  if (!header) return null;
  const parts = header.split(";");
  let ts: number | null = null;
  let h1: string | null = null;
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "ts") {
      const n = parseInt(value, 10);
      if (Number.isFinite(n) && n > 0) ts = n;
    } else if (key === "h1") {
      // Only accept lowercase hex; anything else is treated as bad
      // input rather than tolerated, since we compare bytes later.
      if (/^[0-9a-f]+$/.test(value)) h1 = value;
    }
  }
  if (ts === null || h1 === null) return null;
  return { ts, h1 };
}

export interface VerifyOptions {
  /** Raw request body — MUST be the exact bytes Paddle sent.
   *  Re-serialising parsed JSON and re-hashing will not match. */
  rawBody: string;
  signatureHeader: string | null | undefined;
  secret: string;
  /** Optional unix-seconds clock for tests; defaults to Date.now/1000. */
  nowSeconds?: number;
  /** Reject signatures older than this many seconds. Paddle retries
   *  for ~24h on 5xx so we keep a generous window — 5 minutes is the
   *  industry-standard guardrail against replay. */
  toleranceSeconds?: number;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "expired" | "mismatch" | "no_secret" };

export function verifyPaddleSignature({
  rawBody,
  signatureHeader,
  secret,
  nowSeconds,
  toleranceSeconds = 5 * 60,
}: VerifyOptions): VerifyResult {
  if (!secret) return { ok: false, reason: "no_secret" };
  const parsed = parsePaddleSignatureHeader(signatureHeader);
  if (!parsed) return { ok: false, reason: "missing" };

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.ts) > toleranceSeconds) {
    return { ok: false, reason: "expired" };
  }

  const signedPayload = `${parsed.ts}:${rawBody}`;
  const expected = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  // timingSafeEqual requires equal-length buffers — guard before
  // comparing so a length mismatch isn't an exception, just a clean
  // "mismatch" reason.
  const a = Buffer.from(parsed.h1, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}
