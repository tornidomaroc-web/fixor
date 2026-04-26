/**
 * API token verification + bookkeeping (Phase 5B-5).
 *
 * Tokens are 32 random bytes prefixed with `fxr_` and base64url-encoded.
 * We store SHA-256(token) in the DB; the plain token is shown to the
 * user exactly once at creation (see src/scripts/create-api-token.ts).
 *
 * SHA-256 (not bcrypt) is appropriate here because the input has 256
 * bits of entropy — there is no per-token brute-force advantage from
 * a password-style KDF. Indexed `hash` column gives O(log n) lookup.
 */
import * as crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { apiTokens, orgs } from "../db/schema";

const TOKEN_PREFIX = "fxr_";

export interface VerifiedToken {
  tokenId: string;
  orgId: string;
}

/**
 * Generate a fresh API token. Returns both forms — caller persists the
 * `hash` and shows the `plain` value to the user once.
 */
export function generateApiToken(): { plain: string; hash: string } {
  const random = crypto.randomBytes(32).toString("base64url");
  const plain = `${TOKEN_PREFIX}${random}`;
  const hash = hashToken(plain);
  return { plain, hash };
}

export function hashToken(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

/**
 * Look up a token by SHA-256 hash. Returns null when:
 *   - the token format is wrong (missing prefix)
 *   - no row matches the hash
 *   - the row has been revoked
 *
 * Does NOT update last_used_at — caller decides whether the request
 * actually consumed the token (e.g. only after rate-limit + body
 * validation pass).
 */
export async function verifyApiToken(
  plainToken: string,
): Promise<VerifiedToken | null> {
  if (typeof plainToken !== "string" || !plainToken.startsWith(TOKEN_PREFIX)) {
    return null;
  }
  const hash = hashToken(plainToken);
  const rows = await db()
    .select({
      id: apiTokens.id,
      orgId: apiTokens.orgId,
      revokedAt: apiTokens.revokedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.hash, hash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.revokedAt !== null) return null;
  return { tokenId: row.id, orgId: row.orgId };
}

export async function markTokenUsed(tokenId: string): Promise<void> {
  await db()
    .update(apiTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(apiTokens.id, tokenId));
}

/**
 * Resolve the GitHub installation id for an org. Used by the API
 * endpoint to wire the workflow into costContext for spend tracking
 * + budget enforcement.
 */
export async function getInstallationIdForOrg(
  orgId: string,
): Promise<string | null> {
  const rows = await db()
    .select({ installationId: orgs.githubInstallationId })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  return rows[0]?.installationId ?? null;
}
