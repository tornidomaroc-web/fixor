import * as crypto from 'crypto';

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<number, CachedToken>();

export function generateAppJwt(): string {
  const appId = process.env.GITHUB_APP_ID;
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const privateKey = rawKey?.replace(/\\n/g, '\n');

  if (!appId || !privateKey) {
    throw new Error('GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY is missing from environment variables.');
  }

  const now = Math.floor(Date.now() / 1000);
  const iat = now - 60;
  const exp = now + 600;

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat, exp, iss: appId };

  const base64UrlEncode = (obj: any) => 
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(payload);

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${encodedHeader}.${encodedPayload}`);
  sign.end();

  const signature = sign.sign(privateKey, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.token;
  }

  const jwt = generateAppJwt();
  
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${jwt}`
    }
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GitHub API returned ${response.status}: ${response.statusText} - ${errorBody}`);
  }

  const data = await response.json();
  const expiresAt = new Date(data.expires_at).getTime();
  
  tokenCache.set(installationId, {
    token: data.token,
    expiresAt
  });

  return data.token;
}

export function clearInstallationTokenCache(installationId?: number): void {
  if (installationId !== undefined) {
    tokenCache.delete(installationId);
  } else {
    tokenCache.clear();
  }
}
