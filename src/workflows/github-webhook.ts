import { runAuditorWorkflow } from "./auditor-workflow.js";
import type { GitHubApiErrorDetails } from "../integrations/github/github-api-error.js";
import { GitHubApiError } from "../integrations/github/github-api-error.js";
import { postFixorPullRequestComment } from "../integrations/github/post-pr-comment.service.js";
import type { GitHubRepoMetadata } from "../integrations/github/github-types.js";

export interface SemgrepPayloadResolverFn {
  (params: { owner: string; repo: string; sha: string }): Promise<string | object>;
}

export interface WebhookConfig {
  GITHUB_COMMENT_DRY_RUN?: boolean;
  GITHUB_COMMENT_ON_NO_ACTION?: boolean;
  DEMO_LIVE_CONFIRM?: boolean;
  FORCE_RUN?: boolean;
  checkDuplicateExecution?: (key: string) => Promise<boolean>;
  /** Pilot: file-backed comment id + idempotency (or set `FIXOR_PILOT_ENABLED=true`). */
  pilotPersistence?: boolean;
  pilotStorePath?: string;
  maxCommentUtf8Bytes?: number;
}

export interface WebhookHandlerResult {
  status: "ignored" | "processed" | "failed";
  reason?: string;
  owner?: string;
  repo?: string;
  pullNumber?: number;
  action?: string;
  sha?: string;
  executionKey?: string;
  workflowStatus?: string;
  automationReady?: boolean;
  automationDecisionReason?: string;
  commentAction?: string;
  commentPosted?: boolean;
  dryRun?: boolean;
  duplicateExecution?: boolean;
  commentSkipped?: boolean;
  commentSkipReason?: string;
  duplicateExecutionSkipped?: boolean;
  commentTruncated?: boolean;
  idempotencyNote?: string;
  githubError?: GitHubApiErrorDetails;
}

/**
 * Intake for GitHub `pull_request` event payloads.
 * Runs the Auditor workflow and delegates publishing to the comment service.
 */
export async function handlePullRequestWebhook(
  payload: any,
  getSemgrepPayload: SemgrepPayloadResolverFn,
  config: WebhookConfig = {}
): Promise<WebhookHandlerResult> {
  console.log("[Webhook] webhook received");
  console.log("[Webhook] signature verified / skipped");

  const action = payload?.action;
  if (!action || !payload?.pull_request) {
    console.log("[Webhook] payload rejected: Not a valid pull_request payload");
    return { status: "ignored", reason: "Missing action or pull_request object" };
  }

  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const pullNumber = payload.pull_request?.number;
  const sha = payload.pull_request?.head?.sha;

  if (!owner || !repo || !pullNumber || !sha) {
    console.log("[Webhook] payload rejected: Missing essential metadata");
    return { status: "ignored", reason: "Missing owner, repo, pull_number, or sha" };
  }

  const executionKey = `${owner}/${repo}/pr-${pullNumber}/${sha}`;
  console.log(`[Webhook] Execution Key: ${executionKey}`);

  let duplicateExecution = false;
  if (config.checkDuplicateExecution) {
    duplicateExecution = await config.checkDuplicateExecution(executionKey);
    if (duplicateExecution) {
      console.log(`[Webhook] duplicate execution detected for key: ${executionKey}`);
      if (config.FORCE_RUN) {
        console.log(`[Webhook] forced re-run overriding duplicate guard`);
      }
    }
  }

  const allowedActions = ["opened", "synchronize", "reopened"];
  if (!allowedActions.includes(action)) {
    console.log(`[Webhook] payload rejected: Unsupported action '${action}'`);
    return {
      status: "ignored",
      reason: `Unsupported action: ${action}`,
      owner, repo, pullNumber, action, sha, executionKey
    };
  }

  console.log("[Webhook] payload accepted");

  // Flow triggers
  let semgrepPayload: string | object;
  try {
    semgrepPayload = await getSemgrepPayload({ owner, repo, sha });
    console.log("[Webhook] scan payload resolved");
  } catch (err: any) {
    console.error(`[Webhook] Failed to resolve scan payload: ${err.message}`);
    return {
      status: "failed",
      reason: "Could not obtain scan payload",
      owner, repo, pullNumber, action, sha, executionKey
    };
  }

  console.log("[Webhook] workflow started");
  const workflowResult = await runAuditorWorkflow(semgrepPayload, {
    repoName: repo, commitId: sha
  });
  console.log("[Webhook] workflow completed");

  // Reason derivations
  let automationDecisionReason = "All generated patches met quality thresholds.";
  if (workflowResult.status === "failed") {
    automationDecisionReason = "Workflow execution failed.";
    // Explicit malformed payload logging policy
    if (workflowResult.errors.some(e => e.message?.toLowerCase().includes("malformed"))) {
      console.log(`[Webhook] Policy: Malformed payload detected. Reporting failure securely.`);
    }
  } else if (workflowResult.status === "no_action") {
    automationDecisionReason = "No action necessary.";
  } else if (!workflowResult.automationReady) {
    if (workflowResult.lowQualityPatches > 0) {
      automationDecisionReason = "Gated: Generated low-quality patches requiring review.";
    } else {
      automationDecisionReason = "Gated: Requires manual review.";
    }
  }

  const metadata: GitHubRepoMetadata = { owner, repo, pullNumber, commitSha: sha };
  let dryRun = config.GITHUB_COMMENT_DRY_RUN ?? true;
  const onNoAction = config.GITHUB_COMMENT_ON_NO_ACTION ?? false;
  const pilotPersistence =
    config.pilotPersistence === true ||
    process.env.FIXOR_PILOT_ENABLED?.trim() === "true";
  const pilotStorePath =
    config.pilotStorePath?.trim() ||
    process.env.FIXOR_PILOT_STORE_PATH?.trim() ||
    undefined;

  // Explicit live-demo guard
  if (!dryRun && config.DEMO_LIVE_CONFIRM !== true) {
    console.log("[Webhook] demo guard: forced dry-run");
    dryRun = true;
  }

  // Explicit no_action logging & gating
  if (workflowResult.status === "no_action" && !onNoAction) {
    console.log(`[Webhook] Policy: no_action condition triggered.`);
    console.log(`[Webhook] comment skipped due to no_action policy`);
    
    const finalResult: WebhookHandlerResult = {
      status: "processed",
      owner, repo, pullNumber, action, sha, executionKey,
      workflowStatus: workflowResult.status,
      automationReady: workflowResult.automationReady,
      automationDecisionReason,
      commentPosted: false,
      commentSkipped: true,
      commentSkipReason: "no_action policy",
      duplicateExecution,
      dryRun
    };
    printPilotSummary(finalResult);
    return finalResult;
  }

  if (duplicateExecution && !config.FORCE_RUN) {
    console.log(`[Webhook] comment skipped due to duplicate`);
    
    const finalResult: WebhookHandlerResult = {
      status: "processed",
      owner, repo, pullNumber, action, sha, executionKey,
      workflowStatus: workflowResult.status,
      automationReady: workflowResult.automationReady,
      automationDecisionReason,
      commentPosted: false,
      commentSkipped: true,
      commentSkipReason: "Duplicate execution detected",
      duplicateExecution,
      dryRun
    };
    printPilotSummary(finalResult);
    return finalResult;
  }

  // Pass to Comment layer
  let postResult;
  try {
    postResult = await postFixorPullRequestComment({
      metadata,
      workflow: workflowResult,
      dryRun,
      executionKey,
      pilotPersistence,
      pilotStorePath,
      forceRepost: config.FORCE_RUN === true,
      maxCommentUtf8Bytes: config.maxCommentUtf8Bytes,
    });

    // Explicit comment tracking log policy
    if (postResult.dryRun) {
      console.log("[Webhook] comment skipped (dry-run mode)");
    } else if (postResult.commentAction === "duplicate_skipped") {
      console.log(
        `[Webhook] duplicate execution skipped (pilot idempotency) key=${executionKey}`
      );
    } else if (postResult.commentPosted) {
      console.log(
        `[Webhook] comment ${postResult.commentAction} id=${postResult.commentId ?? "?"}`
      );
    } else {
      console.log("[Webhook] comment not posted");
    }
  } catch (err: unknown) {
    if (err instanceof GitHubApiError) {
      console.error(
        "[Webhook] GitHub API failure",
        err.message,
        JSON.stringify(err.details)
      );
      const finalResult: WebhookHandlerResult = {
        status: "failed",
        reason: err.message,
        owner,
        repo,
        pullNumber,
        action,
        sha,
        executionKey,
        workflowStatus: workflowResult.status,
        automationReady: workflowResult.automationReady,
        automationDecisionReason,
        commentPosted: false,
        duplicateExecution,
        dryRun,
        githubError: err.details,
      };
      printPilotSummary(finalResult);
      return finalResult;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Webhook] GitHub API failure", err);
    const finalResult: WebhookHandlerResult = {
      status: "failed",
      reason: msg,
      owner,
      repo,
      pullNumber,
      action,
      sha,
      executionKey,
      workflowStatus: workflowResult.status,
      automationReady: workflowResult.automationReady,
      automationDecisionReason,
      commentPosted: false,
      duplicateExecution,
      dryRun,
    };
    printPilotSummary(finalResult);
    return finalResult;
  }

  const finalResult: WebhookHandlerResult = {
    status: workflowResult.status === "failed" ? "failed" : "processed",
    owner,
    repo,
    pullNumber,
    action,
    sha,
    executionKey,
    workflowStatus: workflowResult.status,
    automationReady: workflowResult.automationReady,
    automationDecisionReason,
    commentAction: postResult?.commentAction,
    commentPosted: postResult?.commentPosted,
    duplicateExecution,
    dryRun: postResult?.dryRun,
    duplicateExecutionSkipped: postResult?.duplicateExecutionSkipped,
    commentTruncated: postResult?.commentTruncated,
    idempotencyNote: postResult?.idempotencyNote,
    ...(postResult?.commentAction === "duplicate_skipped"
      ? {
          commentSkipped: true,
          commentSkipReason:
            postResult.idempotencyNote ??
            "Duplicate execution skipped (pilot idempotency)",
        }
      : {}),
  };

  printPilotSummary(finalResult);
  return finalResult;
}

function printPilotSummary(finalResult: WebhookHandlerResult) {
  console.log("\n======================================================");
  console.log("[Pilot Execution Summary]");
  console.log(`Execution Key: ${finalResult.executionKey}`);
  console.log(`Workflow Status: ${finalResult.workflowStatus}`);
  console.log(`Automation Ready: ${finalResult.automationReady}`);
  console.log(`Comment Action: ${finalResult.commentAction || "N/A"}`);
  console.log(`Comment Posted: ${finalResult.commentPosted ? "true" : "false"}`);
  console.log(`Comment Skipped: ${finalResult.commentSkipped ? "true" : "false"}`);
  console.log(`Reason / Details: ${finalResult.commentSkipReason || finalResult.reason || finalResult.automationDecisionReason || "Processed normally"}`);
  console.log("======================================================\n");
}
