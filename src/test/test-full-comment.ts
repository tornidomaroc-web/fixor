import { buildPullRequestCommentMarkdown } from "../integrations/github/comment-builder";
import type { GitHubRepoMetadata } from "../integrations/github/github-types";
import { generateSqlInjectionRiskExplanation } from "../services/risk-explainer";
import { generateSqlInjectionFix } from "../services/fix.service";
import type { WorkflowResult } from "../types/workflow.types";
import type { NormalizedSqlInjectionFinding } from "../types/vulnerability.types";

async function main() {
  const finding: NormalizedSqlInjectionFinding = {
    type: "SQL_INJECTION",
    findingType: "sql_injection_risk",
    file: "routes/users.js",
    startLine: 14,
    endLine: 14,
    classificationConfidence: "high",
    ruleId: "sql-injection",
    message: "SQL injection via concatenation",
    originalCode:
      "const query = 'SELECT * FROM users WHERE id = ' + req.params.id;",
    explanation: "Test harness for full PR comment.",
    classificationScore: 55,
  };

  const [fix, exploit] = await Promise.all([
    generateSqlInjectionFix(finding, { dialect: "mysql" }),
    generateSqlInjectionRiskExplanation(finding, {
      dialect: "mysql",
      includeProof: true,
    }),
  ]);

  const workflow: WorkflowResult = {
    status: "success",
    automationReady: true,
    automationDecisionReason: "Test harness — full comment preview",
    totalFindings: 1,
    sqlInjectionFindings: 1,
    skippedFindings: 0,
    fixesGenerated: 1,
    highQualityPatches: fix.patchQuality === "high" ? 1 : 0,
    mediumQualityPatches: fix.patchQuality === "medium" ? 1 : 0,
    lowQualityPatches: fix.patchQuality === "low" ? 1 : 0,
    fixes: [fix],
    errors: [],
    metadata: { scanId: "test-full-comment" },
    timing: {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
    },
  };

  const metadata: GitHubRepoMetadata = {
    owner: "test-org",
    repo: "test-repo",
    pullNumber: 1,
  };

  const markdown = buildPullRequestCommentMarkdown(
    metadata,
    workflow,
    [fix],
    { exploits: [exploit] }
  );

  console.log(markdown);
}

main().catch(console.error);
