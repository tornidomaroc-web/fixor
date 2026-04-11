import { createHmac, timingSafeEqual } from "crypto";

const PREFIX = "sha256=";

/**
 * Verifies the `X-Hub-Signature-256` header for a GitHub webhook delivery.
 *
 * @param rawBody — **Raw** request body (same bytes GitHub signed), not re-serialized JSON.
 * @param signatureHeader — Value of `X-Hub-Signature-256` (e.g. `sha256=abcdef...`).
 * @param secret — Shared secret configured for the webhook.
 * @returns whether the signature is valid.
 *
 * @example
 * ```ts
 * const rawBody = await request.text(); // or Buffer from raw stream
 * const sig = request.headers.get("x-hub-signature-256");
 * const ok = verifyGitHubWebhookSignature256(rawBody, sig, process.env.GITHUB_WEBHOOK_SECRET!);
 * if (!ok) return new Response("Invalid signature", { status: 401 });
 * ```
 */
export function verifyGitHubWebhookSignature256(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string
): boolean {
  if (!secret || typeof secret !== "string" || secret.length === 0) {
    return false;
  }
  if (!signatureHeader || typeof signatureHeader !== "string") {
    return false;
  }
  const trimmed = signatureHeader.trim();
  if (!trimmed.startsWith(PREFIX)) {
    return false;
  }
  const receivedHex = trimmed.slice(PREFIX.length).trim();
  if (!/^[0-9a-f]+$/i.test(receivedHex) || receivedHex.length % 2 !== 0) {
    return false;
  }

  let received: Buffer;
  try {
    received = Buffer.from(receivedHex, "hex");
  } catch {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest();

  if (received.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(received, expected);
}
