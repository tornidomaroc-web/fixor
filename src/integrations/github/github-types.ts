import type { WorkflowResult } from "../../types/workflow.types";
import type { NormalizedFixSuggestion } from "../../analysis-engine/detector.types";

/** Identifies the PR and optional scan context for the comment header. */
export type GitHubRepoMetadata = {
  owner: string;
  repo: string;
  pullNumber: number;
  commitSha?: string;
  scanId?: string;
};

export type PostPrCommentInput = {
  metadata: GitHubRepoMetadata;
  workflow: WorkflowResult;
  /** When omitted, `workflow.fixes` is used. */
  fixes?: NormalizedFixSuggestion[];
  /** When true, builds the body but does not call the GitHub API. */
  dryRun?: boolean;
  /**
   * When true (default), PATCH an existing issue comment that contains the Fixor marker
   * instead of creating a duplicate. If none exists, POST a new comment.
   */
  updateExisting?: boolean;
  /** Passed to comment builder (default 10). */
  maxDetailedFixes?: number;
  /** Overrides `GITHUB_TOKEN` when posting. */
  token?: string;
  /** Overrides `GITHUB_API_BASE_URL` (default `https://api.github.com`). */
  apiBaseUrl?: string;

  /**
   * Pilot: idempotency key (e.g. `owner/repo/pr-42/sha`).
   * When `pilotPersistence` is on, a completed execution is skipped unless `forceRepost` is true.
   */
  executionKey?: string;
  /** Pilot: enable file-backed store + idempotency (or set env `FIXOR_PILOT_ENABLED=true`). */
  pilotPersistence?: boolean;
  /** Pilot: JSON store path (default `data/fixor-pilot-store.json` or `FIXOR_PILOT_STORE_PATH`). */
  pilotStorePath?: string;
  /** Pilot: bypass idempotency skip for this execution key. */
  forceRepost?: boolean;
  /** Max UTF-8 bytes for the final comment body (default 58_000). */
  maxCommentUtf8Bytes?: number;
};

export type PostPrCommentAction =
  | "dry_run"
  | "created"
  | "updated"
  | "duplicate_skipped";

export type PostPrCommentResult = {
  body: string;
  /** Mirrors the `dryRun` flag passed into the operation (actual mode used). */
  dryRun: boolean;
  /** True only after a successful GitHub create or update; always false for dry-run / duplicate skip. */
  commentPosted: boolean;
  commentAction: PostPrCommentAction;
  commentId?: number;
  commentUrl?: string;
  /** Pilot: same executionKey already completed a live post. */
  duplicateExecutionSkipped?: boolean;
  idempotencyNote?: string;
  /** Pilot: comment body was shortened for GitHub limits. */
  commentTruncated?: boolean;
  pilotExecutionKey?: string;
};

export type GitHubIssueCommentApiResponse = {
  id: number;
  html_url: string;
};

/** Minimal `pull_request` webhook fields Fixor requires. */
export type ValidatedGitHubPullRequestWebhook = {
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  action?: string;
};

export type GitHubPayloadValidationResult =
  | {
      ok: true;
      data: ValidatedGitHubPullRequestWebhook;
    }
  | {
      ok: false;
      error: string;
      missingFields: string[];
    };
