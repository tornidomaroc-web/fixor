/**
 * Real GitHub PR demo: PR diff SQLi heuristic → auditor workflow → PR comment.
 *
 * Env: GITHUB_TOKEN, DEMO_OWNER, DEMO_REPO, DEMO_PR (required); DRY_RUN optional (default "true").
 */
import { postFixorPullRequestComment } from "../integrations/github/post-pr-comment.service";
import { analyzePrDiff } from "../services/pr-diff-analyzer";
import { runAuditorWorkflow } from "../workflows/auditor-workflow";

function collectMissingRequired(): string[] {
  const names = ["GITHUB_TOKEN", "DEMO_OWNER", "DEMO_REPO", "DEMO_PR"] as const;
  const missing: string[] = [];
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (!v) missing.push(n);
  }
  return missing;
}

async function main(): Promise<void> {
  const missing = collectMissingRequired();
  if (missing.length > 0) {
    console.error(
      "Missing required environment variable(s):\n  " + missing.join("\n  ")
    );
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN!.trim();
  const owner = process.env.DEMO_OWNER!.trim();
  const repo = process.env.DEMO_REPO!.trim();
  const prRaw = process.env.DEMO_PR!.trim();
  const dryRun = (process.env.DRY_RUN ?? "true") === "true";

  const pullNumber = Number.parseInt(prRaw, 10);
  if (!Number.isFinite(pullNumber) || pullNumber < 1) {
    console.error("DEMO_PR must be a positive integer.");
    process.exit(1);
  }

  const diffFindings = await analyzePrDiff(owner, repo, pullNumber, token);
  const payload = {
    results: [] as unknown[],
    findings: diffFindings,
    _source: "pr-diff",
  };

  const workflow = await runAuditorWorkflow(payload, {
    scanId: "real-github-demo",
    repoName: `${owner}/${repo}`,
  });

  const commentResult = await postFixorPullRequestComment({
    metadata: { owner, repo, pullNumber, scanId: "real-github-demo" },
    workflow,
    dryRun,
    updateExisting: true,
    token,
  });

  console.log("findings count:", diffFindings.length);
  console.log("fixes generated:", workflow.fixesGenerated);
  console.log("dryRun:", dryRun);
  if (!dryRun) {
    console.log("comment action:", commentResult.commentAction);
  }
}

main().catch(console.error);
