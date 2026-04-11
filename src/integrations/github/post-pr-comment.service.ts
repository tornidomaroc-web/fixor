import {
  buildPullRequestCommentMarkdown,
  DEFAULT_MAX_DETAILED_FIXES,
} from "./comment-builder";
import { applyCommentSizeGuard, DEFAULT_MAX_COMMENT_UTF8_BYTES } from "./comment-size-guard";
import { GitHubApiError } from "./github-api-error";
import {
  findLatestFixorIssueCommentId,
  getGitHubConfigFromEnv,
  listIssueComments,
  postIssueComment,
  updateIssueComment,
} from "./github-client";
import {
  FilePilotStore,
  resolvePilotStorePath,
} from "./persistence/pilot-store";
import type {
  PostPrCommentInput,
  PostPrCommentResult,
} from "./github-types";

function pilotPersistenceEnabled(input: PostPrCommentInput): boolean {
  if (input.pilotPersistence === true) return true;
  return process.env.FIXOR_PILOT_ENABLED?.trim() === "true";
}

/**
 * Builds the PR comment body and optionally posts or updates a single Fixor issue comment.
 *
 * Pilot mode (`pilotPersistence` or `FIXOR_PILOT_ENABLED=true`):
 * - Skips duplicate **live** runs for the same `executionKey` unless `forceRepost`.
 * - Persists `commentId` per `owner/repo/pull/headSha` to prefer PATCH without listing every time.
 * - Falls back to listing by marker if stored id 404s or is missing.
 */
export async function postFixorPullRequestComment(
  input: PostPrCommentInput
): Promise<PostPrCommentResult> {
  const dryRun = input.dryRun === true;
  const updateExisting = input.updateExisting !== false;
  const fixes = input.fixes ?? input.workflow.fixes;
  const maxDetailed =
    input.maxDetailedFixes ?? DEFAULT_MAX_DETAILED_FIXES;

  let body = buildPullRequestCommentMarkdown(
    input.metadata,
    input.workflow,
    fixes,
    { maxDetailedFixes: maxDetailed, exploits: input.workflow.exploits }
  );

  const maxBytes =
    input.maxCommentUtf8Bytes ?? DEFAULT_MAX_COMMENT_UTF8_BYTES;
  const guarded = applyCommentSizeGuard(body, maxBytes);
  body = guarded.body;
  const commentTruncated = guarded.truncated;

  const persistence = pilotPersistenceEnabled(input);
  const storePath = resolvePilotStorePath(input.pilotStorePath);
  const store = persistence ? new FilePilotStore(storePath) : null;

  const headSha = input.metadata.commitSha?.trim();
  const executionKey = input.executionKey?.trim();
  const forceRepost = input.forceRepost === true;

  if (persistence && !dryRun) {
    if (!headSha) {
      throw new Error(
        "Pilot persistence requires metadata.commitSha (head SHA) for store keys and updates"
      );
    }
    if (!executionKey) {
      throw new Error(
        "Pilot persistence requires executionKey for idempotency (e.g. owner/repo/pr-42/sha)"
      );
    }
  }

  if (dryRun) {
    return {
      body,
      dryRun: true,
      commentPosted: false,
      commentAction: "dry_run",
      commentTruncated,
      pilotExecutionKey: executionKey,
    };
  }

  const env = getGitHubConfigFromEnv();
  const token = input.token?.trim() || env.token;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set (or pass token in input) when dryRun is false"
    );
  }

  const apiBaseUrl =
    input.apiBaseUrl?.replace(/\/+$/, "") || env.apiBaseUrl;

  const { owner, repo, pullNumber } = input.metadata;

  if (store && executionKey && !forceRepost) {
    const prev = store.getExecution(executionKey);
    if (prev?.outcome === "completed") {
      return {
        body,
        dryRun: false,
        commentPosted: false,
        commentAction: "duplicate_skipped",
        duplicateExecutionSkipped: true,
        idempotencyNote:
          "Duplicate execution skipped: this executionKey already completed a live comment post. Use forceRepost to run again or clear the record in the pilot store (see PILOT.md).",
        commentTruncated,
        pilotExecutionKey: executionKey,
        commentId: prev.commentId,
      };
    }
  }

  const tryPatchById = async (commentId: number) => {
    const updated = await updateIssueComment({
      owner,
      repo,
      commentId,
      body,
      token,
      apiBaseUrl,
    });
    if (store && headSha) {
      store.setStoredCommentId(owner, repo, pullNumber, headSha, updated.id);
    }
    if (store && executionKey) {
      store.setExecutionCompleted(executionKey, updated.id);
    }
    return {
      body,
      dryRun: false,
      commentPosted: true,
      commentAction: "updated" as const,
      commentId: updated.id,
      commentUrl: updated.html_url,
      commentTruncated,
      pilotExecutionKey: executionKey,
    };
  };

  if (store && headSha && updateExisting) {
    const storedId = store.getStoredCommentId(
      owner,
      repo,
      pullNumber,
      headSha
    );
    if (storedId !== undefined) {
      try {
        return await tryPatchById(storedId);
      } catch (e) {
        if (e instanceof GitHubApiError && e.details.status === 404) {
          store.clearStoredCommentId(owner, repo, pullNumber, headSha);
        } else {
          throw e;
        }
      }
    }
  }

  if (updateExisting) {
    const comments = await listIssueComments({
      owner,
      repo,
      issueNumber: pullNumber,
      token,
      apiBaseUrl,
    });
    const existingId = findLatestFixorIssueCommentId(comments);
    if (existingId !== undefined) {
      const result = await tryPatchById(existingId);
      return result;
    }
  }

  const created = await postIssueComment({
    owner,
    repo,
    issueNumber: pullNumber,
    body,
    token,
    apiBaseUrl,
  });

  if (store && headSha) {
    store.setStoredCommentId(
      owner,
      repo,
      pullNumber,
      headSha,
      created.id
    );
  }
  if (store && executionKey) {
    store.setExecutionCompleted(executionKey, created.id);
  }

  return {
    body,
    dryRun: false,
    commentPosted: true,
    commentAction: "created",
    commentId: created.id,
    commentUrl: created.html_url,
    commentTruncated,
    pilotExecutionKey: executionKey,
  };
}
