import type {
  GitHubPayloadValidationResult,
  ValidatedGitHubPullRequestWebhook,
} from "./github-types";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function nonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

/**
 * Validates a GitHub `pull_request` webhook JSON body (parsed object).
 * Requires `repository.owner.login`, `repository.name`, `pull_request.number`, `pull_request.head.sha`.
 */
export function validateGitHubPullRequestPayload(
  payload: unknown
): GitHubPayloadValidationResult {
  const missing: string[] = [];

  if (!isRecord(payload)) {
    return {
      ok: false,
      error: "Payload must be a JSON object",
      missingFields: ["<root>"],
    };
  }

  const repository = payload.repository;
  if (!isRecord(repository)) {
    missing.push("repository");
  }

  const ownerLogin = isRecord(repository)
    ? repository.owner
    : undefined;
  const owner =
    isRecord(ownerLogin) && nonEmptyString(ownerLogin.login)
      ? ownerLogin.login.trim()
      : undefined;
  if (!owner) missing.push("repository.owner.login");

  const repoName =
    isRecord(repository) && nonEmptyString(repository.name)
      ? repository.name.trim()
      : undefined;
  if (!repoName) missing.push("repository.name");

  const pr = payload.pull_request;
  if (!isRecord(pr)) {
    missing.push("pull_request");
  }

  const pullNumber =
    isRecord(pr) &&
    typeof pr.number === "number" &&
    Number.isFinite(pr.number) &&
    pr.number >= 1
      ? Math.floor(pr.number)
      : undefined;
  if (pullNumber === undefined) missing.push("pull_request.number");

  const head = isRecord(pr) ? pr.head : undefined;
  const headSha =
    isRecord(head) && nonEmptyString(head.sha) ? head.sha.trim() : undefined;
  if (!headSha) missing.push("pull_request.head.sha");

  if (missing.length > 0) {
    return {
      ok: false,
      error: "Malformed GitHub pull_request payload",
      missingFields: missing,
    };
  }

  const action =
    nonEmptyString(payload.action) && typeof payload.action === "string"
      ? payload.action.trim()
      : undefined;

  const data: ValidatedGitHubPullRequestWebhook = {
    owner: owner!,
    repo: repoName!,
    pullNumber: pullNumber!,
    headSha: headSha!,
    action,
  };

  return { ok: true, data };
}
