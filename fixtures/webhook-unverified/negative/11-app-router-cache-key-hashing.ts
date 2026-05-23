// ASSUMED-PATH: app/api/feed/route.ts
// Phase C — W1 MANDATORY false-positive class. node:crypto hash of
// the request body for a NON-webhook purpose: cache-key generation.
// File path has no /webhook/ or /hooks/ segment. No webhook library
// imported. No signature header read. The hash output flows
// DIRECTLY to `cache.get(cacheKey)` then `cache.set(cacheKey, ...)`
// — the canonical non-signature sink class the tightened webhook
// prompt enumerates. The current webhook prompt treats node:crypto
// HMAC operations on request-body-derived input as a webhook
// signal, which makes this fixture flag as a missing-verification
// webhook (the FP); Phase C must tune the prompt to track the
// hash-output's sink, not just the hash-input's source.
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

interface FeedRequest {
  filters: Record<string, string>;
  cursor?: string;
}

async function computeFeed(_req: FeedRequest): Promise<unknown> {
  return { items: [] };
}

const cache = {
  async get(_k: string): Promise<unknown | null> {
    return null;
  },
  async set(_k: string, _v: unknown): Promise<void> {},
};

export async function POST(req: Request) {
  const body = (await req.json()) as FeedRequest;
  const cacheKey = createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex");
  const cached = await cache.get(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }
  const result = await computeFeed(body);
  await cache.set(cacheKey, result);
  return NextResponse.json(result);
}
