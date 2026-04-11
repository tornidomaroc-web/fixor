/**
 * Structured error for non-2xx GitHub REST responses (incl. rate limit metadata).
 */
export type GitHubApiErrorDetails = {
  status: number;
  message: string;
  /** Raw response text (trimmed) when JSON `message` missing or for debugging. */
  responseBodySnippet?: string;
  rateLimitRemaining?: string;
  rateLimitReset?: string;
  retryAfter?: string;
  requestId?: string;
};

export class GitHubApiError extends Error {
  readonly details: GitHubApiErrorDetails;

  constructor(details: GitHubApiErrorDetails) {
    const rl =
      details.rateLimitRemaining !== undefined
        ? ` (x-ratelimit-remaining: ${details.rateLimitRemaining})`
        : "";
    super(`GitHub API ${details.status}: ${details.message}${rl}`);
    this.name = "GitHubApiError";
    this.details = details;
  }
}

export function buildGitHubErrorDetails(
  res: Response,
  json: unknown,
  textFallback: string
): GitHubApiErrorDetails {
  let message = textFallback.slice(0, 500);
  if (
    json &&
    typeof json === "object" &&
    json !== null &&
    "message" in json &&
    typeof (json as { message: unknown }).message === "string"
  ) {
    message = (json as { message: string }).message;
  }

  return {
    status: res.status,
    message,
    responseBodySnippet: textFallback.length > 0 ? textFallback.slice(0, 2000) : undefined,
    rateLimitRemaining: res.headers.get("x-ratelimit-remaining") ?? undefined,
    rateLimitReset: res.headers.get("x-ratelimit-reset") ?? undefined,
    retryAfter: res.headers.get("retry-after") ?? undefined,
    requestId:
      res.headers.get("x-github-request-id") ??
      res.headers.get("x-request-id") ??
      undefined,
  };
}
