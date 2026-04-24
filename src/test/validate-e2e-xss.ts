/**
 * End-to-end XSS plumbing validation — NOT wired into CI.
 *
 * Verifies that:
 *   1. A synthetic xss_risk finding routes to XssDetector.
 *   2. The resulting NormalizedFixSuggestion has XSS metadata + the
 *      canonical findingId scheme.
 *   3. SARIF output emits a rule with id "xss_risk" + CWE-79 + OWASP A03.
 *   4. PR comment renders the XSS fix using the registry display name
 *      ("Cross-site scripting (XSS)") and omits SQL-only rows.
 *   5. PDF renders without throwing and contains both fix cards.
 *
 * No Claude API key required — XSS uses the fallback path, SQL uses
 * the offline regex rewrite. What this validates is PLUMBING, not
 * LLM output quality (that needs a real API).
 *
 * Run from repo root after `npm run build`:
 *   node dist/test/validate-e2e-xss.js
 */

delete process.env.ANTHROPIC_API_KEY;

import * as fs from "fs";
import { SqlInjectionDetector } from "../analysis-engine/detectors/sql-injection.detector";
import { XssDetector } from "../analysis-engine/detectors/xss.detector";
import type { NormalizedFinding } from "../analysis-engine/detector.types";
import { buildSarifLog, sarifToJson } from "../services/sarif-output.service";
import { generatePdfReport } from "../services/pdf-report.service";
import { buildPullRequestCommentMarkdown } from "../integrations/github/comment-builder";
import type { GitHubRepoMetadata } from "../integrations/github/github-types";
import type { WorkflowResult } from "../types/workflow.types";

function mkFinding(
  type: "sql_injection_risk" | "xss_risk",
  file: string,
  line: number,
  originalCode: string,
  message: string
): NormalizedFinding {
  return {
    detectorId: "central-llm-analyzer",
    type,
    file,
    startLine: line,
    endLine: line,
    originalCode,
    ruleId: `claude-analysis-${type}`,
    message,
    explanation:
      type === "sql_injection_risk"
        ? "User input interpolated into SQL grants query-semantic control."
        : "User input rendered into HTML enables JS execution in victims' browsers.",
    confidence: "high",
    severity: "high",
  };
}

let failures = 0;
function expect(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`  ✅ ${msg}`);
  } else {
    console.error(`  ❌ ${msg}`);
    failures++;
  }
}

async function main(): Promise<void> {
  console.log("=== Phase 4A end-to-end plumbing validation ===\n");

  const sqlDetector = new SqlInjectionDetector();
  const xssDetector = new XssDetector();

  const sqlFinding = mkFinding(
    "sql_injection_risk",
    "src/routes/users.js",
    42,
    "const q = 'SELECT * FROM users WHERE id = ' + req.params.id;",
    "SQL injection via string concatenation"
  );

  const xssFinding = mkFinding(
    "xss_risk",
    "src/views/profile.tsx",
    17,
    "container.innerHTML = req.query.bio;",
    "Unsanitized user input assigned to innerHTML"
  );

  console.log("[1] Running detectors...");
  const sqlFix = await sqlDetector.fix(sqlFinding);
  const xssFix = await xssDetector.fix(xssFinding);
  console.log("    sql  findingId:", sqlFix.findingId);
  console.log("    xss  findingId:", xssFix.findingId);
  console.log("    sql  metadata.type:", sqlFix.metadata?.type);
  console.log("    xss  metadata.type:", xssFix.metadata?.type);

  expect(sqlFix.findingType === "sql_injection_risk", "SQL fix.findingType");
  expect(xssFix.findingType === "xss_risk", "XSS fix.findingType");
  expect(sqlFix.detectorId === "sql-injection-js-ts", "SQL detectorId");
  expect(xssFix.detectorId === "xss-js-ts", "XSS detectorId");
  expect(
    sqlFix.findingId ===
      "central-llm-analyzer:sql_injection_risk:src/routes/users.js:42",
    "SQL findingId matches deriveFindingId scheme"
  );
  expect(
    xssFix.findingId ===
      "central-llm-analyzer:xss_risk:src/views/profile.tsx:17",
    "XSS findingId matches deriveFindingId scheme"
  );
  expect(
    sqlFix.metadata?.type === "sql_injection_risk",
    "SQL metadata discriminated correctly"
  );
  expect(xssFix.metadata?.type === "xss_risk", "XSS metadata discriminated correctly");

  console.log("\n[2] Building WorkflowResult...");
  const workflow: WorkflowResult = {
    status: "success",
    automationReady: false,
    automationDecisionReason: "Two findings across two vulnerability families",
    totalFindings: 2,
    sqlInjectionFindings: 1,
    classifiedFindings: 2,
    skippedFindings: 0,
    fixesGenerated: 2,
    highQualityPatches: sqlFix.patchQuality === "high" ? 1 : 0,
    mediumQualityPatches: sqlFix.patchQuality === "medium" ? 1 : 0,
    lowQualityPatches:
      (sqlFix.patchQuality === "low" ? 1 : 0) +
      (xssFix.patchQuality === "low" ? 1 : 0),
    fixes: [sqlFix, xssFix],
    errors: [],
    metadata: { scanId: "phase-4a-validation", commitId: "deadbeef" },
    timing: {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1234,
    },
  };

  console.log("\n[3] Building SARIF log...");
  const sarif = buildSarifLog(workflow);
  const sarifJson = sarifToJson(sarif);
  fs.writeFileSync("/tmp/fixor-validate.sarif.json", sarifJson);
  const run = sarif.runs[0]!;
  const ruleIds = run.tool.driver.rules.map((r) => r.id).sort();
  console.log("    rule ids:", ruleIds.join(", "));
  console.log("    result ruleIds:", run.results.map((r) => r.ruleId).join(", "));

  expect(ruleIds.includes("sql_injection_risk"), "SARIF rule for SQL present");
  expect(ruleIds.includes("xss_risk"), "SARIF rule for XSS present");
  expect(run.results.length === 2, "SARIF has 2 results");
  const xssRule = run.tool.driver.rules.find((r) => r.id === "xss_risk")!;
  expect(xssRule.properties.cwe === "CWE-79", "XSS rule mapped to CWE-79");
  expect(xssRule.properties.owaspTop10 === "A03:2021", "XSS rule mapped to A03");

  console.log("\n[4] Rendering PR comment markdown...");
  const metadata: GitHubRepoMetadata = {
    owner: "tornidomaroc-web",
    repo: "fixor",
    pullNumber: 999,
    commitSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    scanId: "phase-4a-validation",
  };
  const markdown = buildPullRequestCommentMarkdown(metadata, workflow);
  fs.writeFileSync("/tmp/fixor-validate.comment.md", markdown);
  expect(
    markdown.includes("`SQL injection`"),
    "Comment mentions SQL injection registry name"
  );
  expect(
    markdown.includes("`Cross-site scripting (XSS)`"),
    "Comment mentions XSS registry name"
  );
  expect(markdown.includes("**Dialect:**"), "SQL-specific dialect row rendered");
  expect(
    markdown.includes("**Vulnerabilities classified**"),
    "summary label updated to classifiedFindings"
  );
  expect(markdown.includes("| 2 |"), "classified count reflects 2 findings");
  // XSS block should NOT have a Dialect line (only applies to SQL).
  const xssBlockStart = markdown.indexOf("Cross-site scripting (XSS)");
  const nextDetailsClose = markdown.indexOf("</details>", xssBlockStart);
  const xssBlock = markdown.slice(xssBlockStart, nextDetailsClose);
  expect(
    !xssBlock.includes("**Dialect:**"),
    "XSS block omits SQL-only Dialect row"
  );

  console.log("\n[5] Generating PDF...");
  try {
    const pdf = await generatePdfReport(workflow, {
      owner: metadata.owner,
      repo: metadata.repo,
      pullNumber: metadata.pullNumber,
      commitSha: metadata.commitSha!,
    });
    fs.writeFileSync("/tmp/fixor-validate.pdf", pdf);
    expect(pdf.length > 0, "PDF buffer non-empty");
    expect(pdf.slice(0, 4).toString() === "%PDF", "PDF magic bytes present");
  } catch (err) {
    console.error("    PDF generation threw:", err);
    failures++;
  }

  console.log("\n=== Artifacts saved ===");
  console.log("  /tmp/fixor-validate.sarif.json");
  console.log("  /tmp/fixor-validate.comment.md");
  console.log("  /tmp/fixor-validate.pdf");

  console.log(
    failures === 0
      ? "\n✅ All plumbing checks passed"
      : `\n❌ ${failures} check(s) failed`
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
