/**
 * End-to-end demo: load webhook + Semgrep JSON from disk → handlePullRequestWebhook → print result + markdown.
 *
 * Safety: live posting requires DEMO_LIVE_CONFIRM=true; otherwise dry-run is forced.
 *
 * Usage:
 *   node dist/integrations/github/demo/validate-github-comment-demo.js [options]
 *   npm run demo:validate-github-comment
 *
 * Options:
 *   --webhook <path>   pull_request JSON (default: demo-assets/github-comment-mode/pull_request.webhook.json)
 *   --semgrep <path>   Semgrep JSON (default: demo-assets/github-comment-mode/semgrep.sample.json)
 *   --live             attempt real POST/PATCH (requires GITHUB_TOKEN + DEMO_LIVE_CONFIRM=true)
 *   --pilot            enable pilot file store + idempotency (or set FIXOR_PILOT_ENABLED=true)
 *   --force-repost     bypass pilot duplicate skip for this run
 */
import * as fs from "fs";
import * as path from "path";
import { findLatestFixorIssueCommentId, listIssueComments } from "../github-client";
import { handlePullRequestWebhook } from "../pr-webhook-handler";

const DEFAULT_WEBHOOK_REL = path.join(
  "demo-assets",
  "github-comment-mode",
  "pull_request.webhook.json"
);
const DEFAULT_SEMGREP_REL = path.join(
  "demo-assets",
  "github-comment-mode",
  "semgrep.sample.json"
);

function parseArgs(): {
  webhookPath: string;
  semgrepPath: string;
  liveRequested: boolean;
  pilot: boolean;
  forceRepost: boolean;
} {
  const argv = process.argv.slice(2);
  let webhookPath = "";
  let semgrepPath = "";
  let liveRequested = false;
  let pilot = false;
  let forceRepost = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") liveRequested = true;
    else if (a === "--pilot") pilot = true;
    else if (a === "--force-repost") forceRepost = true;
    else if (a === "--webhook" && argv[i + 1]) webhookPath = argv[++i] as string;
    else if (a === "--semgrep" && argv[i + 1]) semgrepPath = argv[++i] as string;
  }
  const root = process.cwd();
  if (!webhookPath) webhookPath = path.join(root, DEFAULT_WEBHOOK_REL);
  if (!semgrepPath) semgrepPath = path.join(root, DEFAULT_SEMGREP_REL);
  return { webhookPath, semgrepPath, liveRequested, pilot, forceRepost };
}

async function describeCreateOrUpdate(args: {
  dryRun: boolean;
  commentPosted: boolean;
  commentAction: string;
  duplicateExecutionSkipped?: boolean;
  owner: string;
  repo: string;
  pullNumber: number;
  token?: string;
  apiBaseUrl?: string;
}): Promise<string> {
  if (!args.dryRun) {
    if (args.commentAction === "duplicate_skipped" || args.duplicateExecutionSkipped) {
      return "Duplicate execution skipped: pilot idempotency — no new POST/PATCH (see idempotencyNote in JSON).";
    }
    if (args.commentPosted) {
      return `Comment was ${args.commentAction === "updated" ? "UPDATED" : "CREATED"} on GitHub (see commentUrl in JSON above).`;
    }
    return "Live run completed but comment was not posted (unexpected).";
  }

  const token = args.token?.trim();
  if (!token) {
    return "Create vs update (dry-run): unknown without GITHUB_TOKEN — no read-only probe performed.";
  }

  try {
    const comments = await listIssueComments({
      owner: args.owner,
      repo: args.repo,
      issueNumber: args.pullNumber,
      token,
      apiBaseUrl: args.apiBaseUrl,
      maxPages: 10,
    });
    const existingId = findLatestFixorIssueCommentId(comments);
    return existingId !== undefined
      ? `Create vs update (dry-run + probe): would UPDATE existing Fixor comment id=${existingId}.`
      : `Create vs update (dry-run + probe): would CREATE a new issue comment.`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Create vs update (dry-run + probe): failed — ${msg}`;
  }
}

async function main() {
  const { webhookPath, semgrepPath, liveRequested, pilot, forceRepost } =
    parseArgs();

  const liveConfirmed = process.env.DEMO_LIVE_CONFIRM?.trim() === "true";
  let effectiveDryRun = true;
  let guardNote = "";

  if (liveRequested && liveConfirmed) {
    effectiveDryRun = false;
  } else if (liveRequested && !liveConfirmed) {
    guardNote =
      "⚠️  --live was passed but DEMO_LIVE_CONFIRM is not 'true' — forcing DRY-RUN for safety.\n";
    effectiveDryRun = true;
  } else {
    effectiveDryRun = true;
  }

  if (!effectiveDryRun && !process.env.GITHUB_TOKEN?.trim()) {
    console.error(
      "GITHUB_TOKEN is required for live mode (after DEMO_LIVE_CONFIRM=true)."
    );
    process.exit(1);
  }

  if (!fs.existsSync(webhookPath)) {
    console.error("Webhook file not found:", webhookPath);
    process.exit(1);
  }
  if (!fs.existsSync(semgrepPath)) {
    console.error("Semgrep file not found:", semgrepPath);
    process.exit(1);
  }

  const rawBody = fs.readFileSync(webhookPath, "utf8");
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    console.error("Invalid JSON in webhook file:", webhookPath);
    process.exit(1);
  }

  let semgrepObject: unknown;
  try {
    semgrepObject = JSON.parse(
      fs.readFileSync(semgrepPath, "utf8")
    ) as unknown;
  } catch {
    console.error("Invalid JSON in Semgrep file:", semgrepPath);
    process.exit(1);
  }

  console.log("══════════════════════════════════════════════════════════");
  console.log(" Fixor — GitHub Comment Mode validation demo");
  console.log("══════════════════════════════════════════════════════════");
  console.log("Webhook file: ", webhookPath);
  console.log("Semgrep file: ", semgrepPath);
  const pilotPersistence =
    pilot || process.env.FIXOR_PILOT_ENABLED?.trim() === "true";
  console.log("Mode:         ", effectiveDryRun ? "DRY-RUN" : "LIVE");
  console.log("Pilot store:  ", pilotPersistence ? "on" : "off");
  if (guardNote) console.log(guardNote);

  const token = process.env.GITHUB_TOKEN?.trim();
  const apiBaseUrl = process.env.GITHUB_API_BASE_URL?.trim();

  const result = await handlePullRequestWebhook({
    rawBody,
    payload,
    dryRun: effectiveDryRun,
    skipSignatureVerification: true,
    resolveSemgrep: () => semgrepObject,
    workflowMetadata: {
      scanId: `demo-validate-${Date.now()}`,
    },
    token,
    apiBaseUrl,
    updateExisting: true,
    pilotPersistence,
    pilotStorePath: process.env.FIXOR_PILOT_STORE_PATH?.trim(),
    forceRepost,
  });

  if (!result.ok) {
    console.log("\n--- Processed webhook result (failure) ---\n");
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const summary = {
    ok: result.ok,
    dryRun: result.dryRun,
    signatureState: result.signatureState,
    pr: result.data,
    workflow: {
      status: result.workflow.status,
      automationReady: result.workflow.automationReady,
      automationDecisionReason: result.workflow.automationDecisionReason,
      totalFindings: result.workflow.totalFindings,
      sqlInjectionFindings: result.workflow.sqlInjectionFindings,
      skippedFindings: result.workflow.skippedFindings,
      fixesGenerated: result.workflow.fixesGenerated,
      highQualityPatches: result.workflow.highQualityPatches,
      mediumQualityPatches: result.workflow.mediumQualityPatches,
      lowQualityPatches: result.workflow.lowQualityPatches,
    },
    comment: {
      dryRun: result.comment.dryRun,
      commentPosted: result.comment.commentPosted,
      commentAction: result.comment.commentAction,
      commentId: result.comment.commentId,
      commentUrl: result.comment.commentUrl,
      duplicateExecutionSkipped: result.comment.duplicateExecutionSkipped,
      idempotencyNote: result.comment.idempotencyNote,
      commentTruncated: result.comment.commentTruncated,
      pilotExecutionKey: result.comment.pilotExecutionKey,
    },
  };

  console.log("\n--- Processed webhook result ---\n");
  console.log(JSON.stringify(summary, null, 2));

  const planLine = await describeCreateOrUpdate({
    dryRun: result.comment.dryRun,
    commentPosted: result.comment.commentPosted,
    commentAction: result.comment.commentAction,
    duplicateExecutionSkipped: result.comment.duplicateExecutionSkipped,
    owner: result.data.owner,
    repo: result.data.repo,
    pullNumber: result.data.pullNumber,
    token,
    apiBaseUrl,
  });

  console.log("\n--- Create vs update ---\n");
  console.log(planLine);

  console.log("\n--- Generated markdown (comment body) ---\n");
  console.log(result.comment.body);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
