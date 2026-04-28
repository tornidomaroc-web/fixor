/**
 * GitHub API helpers used by the dashboard's signed-in pages.
 *
 * Only the bits the dashboard needs live here — the backend has its
 * own GitHub client at src/integrations/github/* (different concerns,
 * different auth surface).
 */
import { auth, clerkClient } from "@clerk/nextjs/server";

export interface GitHubInstallation {
  id: number;
  app_id: number;
  account: {
    login: string;
    type: string;
    avatar_url: string;
  };
  target_type: string;
  permissions?: Record<string, string>;
}

/**
 * Returns Fixor App installations the signed-in user has access to.
 *
 * Algorithm:
 *   1. Pull the user's GitHub OAuth token from Clerk.
 *   2. GET /user/installations with that token — returns every
 *      installation accessible to the user.
 *   3. Filter to those whose app_id matches FIXOR_GITHUB_APP_ID.
 *
 * Returns:
 *   - `{ status: "ok", installations: [...] }` on success (may be empty)
 *   - `{ status: "no_token" }` if Clerk has no GitHub token (user
 *     signed in via a different provider, or token expired)
 *   - `{ status: "error", message }` on network / API failure
 *
 * The caller renders the "install on GitHub" CTA when installations
 * is empty OR status is anything other than "ok".
 */
export type ListInstallationsResult =
  | { status: "ok"; installations: GitHubInstallation[] }
  | { status: "no_token" }
  | { status: "error"; message: string };

export async function listFixorInstallations(): Promise<ListInstallationsResult> {
  const { userId } = await auth();
  if (!userId) return { status: "no_token" };

  const fixorAppId = process.env.FIXOR_GITHUB_APP_ID?.trim();
  if (!fixorAppId) {
    return {
      status: "error",
      message: "FIXOR_GITHUB_APP_ID is not configured on the dashboard.",
    };
  }

  const clerk = await clerkClient();
  let githubToken: string | undefined;
  try {
    const tokens = await clerk.users.getUserOauthAccessToken(
      userId,
      "oauth_github",
    );
    githubToken = tokens.data[0]?.token;
    console.error("[fixor-debug] clerk-tokens", {
      userId,
      tokenCount: tokens.data.length,
      provider: tokens.data[0]?.provider,
      scopes: tokens.data[0]?.scopes,
      hasToken: Boolean(githubToken),
    });
  } catch (err) {
    console.error("[fixor-debug] clerk-token-error", {
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { status: "no_token" };
  }
  if (!githubToken) return { status: "no_token" };

  let res: Response;
  try {
    res = await fetch("https://api.github.com/user/installations", {
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[fixor-debug] github-fetch-throw", {
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      status: "error",
      message: err instanceof Error ? err.message : "github fetch failed",
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[fixor-debug] github-non-2xx", {
      status: res.status,
      statusText: res.statusText,
      body: body.slice(0, 500),
    });
    return {
      status: "error",
      message: `GitHub API ${res.status} ${res.statusText}`,
    };
  }

  const data = (await res.json()) as { installations?: GitHubInstallation[] };
  const all = Array.isArray(data.installations) ? data.installations : [];
  const fixorOnly = all.filter((i) => String(i.app_id) === fixorAppId);
  return { status: "ok", installations: fixorOnly };
}

export function fixorInstallUrl(): string {
  const slug = process.env.FIXOR_GITHUB_APP_SLUG?.trim() || "fixor";
  return `https://github.com/apps/${slug}/installations/new`;
}
