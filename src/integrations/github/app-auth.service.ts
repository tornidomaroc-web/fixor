/**
 * GitHub App authentication: RS256 JWT minting + installation access token
 * caching. We use `jose` for JWT signing instead of hand-rolling base64url
 * + crypto.createSign because `jose` handles edge cases (key formats,
 * clock skew, RFC-correct JSON encoding) that used to be our problem.
 */

import { SignJWT } from "jose";
import { createPrivateKey } from "node:crypto";

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
}

const tokenCache = new Map<number, CachedToken>();
/** Concurrent callers for the same installation share one in-flight fetch. */
const inflightFetches = new Map<number, Promise<string>>();

const JWT_LIFETIME_SECONDS = 600;
const JWT_CLOCK_SKEW_SECONDS = 60;

function readPrivateKeyPem(): string {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!raw) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY is missing from environment variables."
    );
  }
  // GitHub Actions / .env files escape newlines as `\n`; normalize them back.
  return raw.replace(/\\n/g, "\n");
}

function readAppId(): string {
  const appId = process.env.GITHUB_APP_ID?.trim();
  if (!appId) {
    throw new Error("GITHUB_APP_ID is missing from environment variables.");
  }
  return appId;
}

/**
 * Mints a short-lived (10 minute) RS256 JWT signed with the GitHub App's
 * private key. Includes a 60-second backdated iat to absorb clock skew.
 */
export async function generateAppJwt(): Promise<string> {
  const appId = readAppId();
  const pem = readPrivateKeyPem();
  // GitHub Apps export private keys in PKCS#1 (-----BEGIN RSA PRIVATE KEY-----)
  // by default; jose.importPKCS8 only accepts PKCS#8. node:crypto.createPrivateKey
  // accepts both formats transparently and returns a KeyObject that jose's SignJWT
  // can sign with directly.
  const privateKey = createPrivateKey({ key: pem, format: "pem" });

  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuedAt(now - JWT_CLOCK_SKEW_SECONDS)
    .setExpirationTime(now + JWT_LIFETIME_SECONDS)
    .setIssuer(appId)
    .sign(privateKey);
}

async function fetchInstallationToken(installationId: number): Promise<string> {
  const jwt = await generateAppJwt();
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `Bearer ${jwt}`,
      },
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `GitHub API returned ${response.status}: ${response.statusText} - ${errorBody}`
    );
  }

  const data = (await response.json()) as InstallationTokenResponse;
  const expiresAt = new Date(data.expires_at).getTime();

  tokenCache.set(installationId, { token: data.token, expiresAt });
  return data.token;
}

/**
 * Fetches (or returns cached) installation access token. Concurrent calls
 * for the same installation share one in-flight request, so we don't burn
 * App rate-limit quota on a race.
 */
export async function getInstallationToken(
  installationId: number
): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const inflight = inflightFetches.get(installationId);
  if (inflight) return inflight;

  const p = fetchInstallationToken(installationId).finally(() => {
    inflightFetches.delete(installationId);
  });
  inflightFetches.set(installationId, p);
  return p;
}

export function clearInstallationTokenCache(installationId?: number): void {
  if (installationId !== undefined) {
    tokenCache.delete(installationId);
  } else {
    tokenCache.clear();
  }
}
