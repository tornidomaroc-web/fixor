import { FIXOR_PR_COMMENT_MARKER } from "./comment-constants";
import {
  buildGitHubErrorDetails,
  GitHubApiError,
} from "./github-api-error";

/**
 * Reads GitHub credentials / base URL from the environment.
 */
export function getGitHubConfigFromEnv(): {
  token: string | undefined;
  apiBaseUrl: string;
} {
  const token = process.env.GITHUB_TOKEN?.trim() || undefined;
  const raw =
    process.env.GITHUB_API_BASE_URL?.trim() || "https://api.github.com";
  const apiBaseUrl = raw.replace(/\/+$/, "");
  return { token, apiBaseUrl };
}

export type IssueCommentItem = {
  id: number;
  body: string;
};

export type PostIssueCommentParams = {
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
  token: string;
  apiBaseUrl?: string;
};

export type UpdateIssueCommentParams = {
  owner: string;
  repo: string;
  commentId: number;
  body: string;
  token: string;
  apiBaseUrl?: string;
};

function normalizeBase(apiBaseUrl?: string): string {
  return (apiBaseUrl || "https://api.github.com").replace(/\/+$/, "");
}

async function parseJsonResponse(
  res: Response
): Promise<{ ok: true; json: unknown; text: string } | { ok: false; text: string }> {
  const text = await res.text();
  try {
    return { ok: true, json: JSON.parse(text) as unknown, text };
  } catch {
    return { ok: false, text };
  }
}

function throwGitHubError(
  res: Response,
  parsed: { ok: true; json: unknown; text: string } | { ok: false; text: string }
): never {
  const json = parsed.ok ? parsed.json : null;
  const text = parsed.ok ? parsed.text : parsed.text;
  throw new GitHubApiError(buildGitHubErrorDetails(res, json, text));
}

/**
 * Lists all issue comments (paginated, up to a reasonable cap).
 */
export async function listIssueComments(params: {
  owner: string;
  repo: string;
  issueNumber: number;
  token: string;
  apiBaseUrl?: string;
  maxPages?: number;
}): Promise<IssueCommentItem[]> {
  const base = normalizeBase(params.apiBaseUrl);
  const out: IssueCommentItem[] = [];
  const maxPages = params.maxPages ?? 20;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${base}/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/issues/${params.issueNumber}/comments?per_page=100&page=${page}`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${params.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    const parsed = await parseJsonResponse(res);
    if (!res.ok) {
      throwGitHubError(res, parsed);
    }
    if (!parsed.ok || !Array.isArray(parsed.json)) {
      throw new Error("GitHub API: failed to list issue comments");
    }

    const batch = parsed.json as unknown[];
    for (const row of batch) {
      if (
        row &&
        typeof row === "object" &&
        typeof (row as { id: unknown }).id === "number" &&
        typeof (row as { body: unknown }).body === "string"
      ) {
        out.push({
          id: (row as { id: number }).id,
          body: (row as { body: string }).body,
        });
      }
    }

    if (batch.length < 100) break;
  }

  return out;
}

/**
 * Returns the **last** issue comment whose body contains the Fixor marker (stable dedupe target).
 */
export function findLatestFixorIssueCommentId(
  comments: IssueCommentItem[],
  marker: string = FIXOR_PR_COMMENT_MARKER
): number | undefined {
  let last: number | undefined;
  for (const c of comments) {
    if (typeof c.body === "string" && c.body.includes(marker)) {
      last = c.id;
    }
  }
  return last;
}

/**
 * `POST /repos/{owner}/{repo}/issues/{issue_number}/comments`
 */
export async function postIssueComment(
  params: PostIssueCommentParams
): Promise<{ id: number; html_url: string }> {
  const base = normalizeBase(params.apiBaseUrl);
  const url = `${base}/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/issues/${params.issueNumber}/comments`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${params.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body: params.body }),
  });

  const parsed = await parseJsonResponse(res);
  if (!res.ok) {
    throwGitHubError(res, parsed);
  }

  const json = parsed.ok ? parsed.json : null;
  if (
    !json ||
    typeof json !== "object" ||
    typeof (json as { id: unknown }).id !== "number" ||
    typeof (json as { html_url: unknown }).html_url !== "string"
  ) {
    throw new Error("GitHub API returned an unexpected comment payload");
  }

  const o = json as { id: number; html_url: string };
  return { id: o.id, html_url: o.html_url };
}

/**
 * `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}`
 */
export async function updateIssueComment(
  params: UpdateIssueCommentParams
): Promise<{ id: number; html_url: string }> {
  const base = normalizeBase(params.apiBaseUrl);
  const url = `${base}/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/issues/comments/${params.commentId}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${params.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body: params.body }),
  });

  const parsed = await parseJsonResponse(res);
  if (!res.ok) {
    throwGitHubError(res, parsed);
  }

  const json = parsed.ok ? parsed.json : null;
  if (
    !json ||
    typeof json !== "object" ||
    typeof (json as { id: unknown }).id !== "number" ||
    typeof (json as { html_url: unknown }).html_url !== "string"
  ) {
    throw new Error("GitHub API returned an unexpected comment payload");
  }

  const o = json as { id: number; html_url: string };
  return { id: o.id, html_url: o.html_url };
}

/**
 * `GET /repos/{owner}/{repo}/pulls/{pullNumber}` with diff media type — returns raw unified diff text.
 */
export async function fetchPrDiff(
  owner: string,
  repo: string,
  pullNumber: number,
  token: string,
  apiBaseUrl?: string
): Promise<string> {
  const base = normalizeBase(apiBaseUrl);
  const url = `${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3.diff",
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await res.text();
  let json: unknown = null;
  if (!res.ok) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
    throw new GitHubApiError(buildGitHubErrorDetails(res, json, text));
  }

  return text;
}

export { GitHubApiError } from "./github-api-error";
export type { GitHubApiErrorDetails } from "./github-api-error";
