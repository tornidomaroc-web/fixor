/**
 * End-to-end plumbing validation for all four vulnerability families — NOT
 * wired into CI.
 *
 * Verifies SARIF rules, PR comment markdown, and PDF generation for SQL,
 * XSS, command injection, and path traversal fixes (offline / fallback paths).
 *
 * Run from repo root after `npm run build`:
 *   node dist/test/validate-e2e.js
 */

delete process.env.ANTHROPIC_API_KEY;

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SqlInjectionDetector } from "../analysis-engine/detectors/sql-injection.detector";
import { XssDetector } from "../analysis-engine/detectors/xss.detector";
import { CommandInjectionDetector } from "../analysis-engine/detectors/command-injection.detector";
import { PathTraversalDetector } from "../analysis-engine/detectors/path-traversal.detector";
import type { NormalizedFinding } from "../analysis-engine/detector.types";
import { buildSarifLog, sarifToJson } from "../services/sarif-output.service";
import { generatePdfReport } from "../services/pdf-report.service";
import { buildPullRequestCommentMarkdown } from "../integrations/github/comment-builder";
import type { GitHubRepoMetadata } from "../integrations/github/github-types";
import type { WorkflowResult } from "../types/workflow.types";
import type { FindingType } from "../analysis-engine/types";

function mkFinding(
  type: FindingType,
  file: string,
  line: number,
  originalCode: string,
  message: string
): NormalizedFinding {
  const explanations: Partial<Record<FindingType, string>> = {
    sql_injection_risk:
      "User input interpolated into SQL grants query-semantic control.",
    xss_risk:
      "User input rendered into HTML enables JS execution in victims' browsers.",
    command_injection_risk:
      "User input reaches a shell command and can inject arbitrary OS commands.",
    path_traversal_risk:
      "User input builds a filesystem path without canonicalization or containment.",
  };
  return {
    detectorId: "central-llm-analyzer",
    type,
    file,
    startLine: line,
    endLine: line,
    originalCode,
    ruleId: `claude-analysis-${type}`,
    message,
    explanation: explanations[type] ?? "(no test explanation)",
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
  console.log("=== Phase 4B end-to-end plumbing validation (4 families) ===\n");

  const sqlDetector = new SqlInjectionDetector();
  const xssDetector = new XssDetector();
  const cmdiDetector = new CommandInjectionDetector();
  const ptDetector = new PathTraversalDetector();

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

  const cmdiFinding = mkFinding(
    "command_injection_risk",
    "src/jobs/runner.ts",
    8,
    "exec('ls ' + userDir);",
    "Shell command built from user input"
  );

  const ptFinding = mkFinding(
    "path_traversal_risk",
    "src/api/download.ts",
    22,
    "fs.readFile(req.query.name);",
    "User-controlled path passed to fs.readFile"
  );

  console.log("[1] Running detectors...");
  const sqlFix = await sqlDetector.fix(sqlFinding);
  const xssFix = await xssDetector.fix(xssFinding);
  const cmdiFix = await cmdiDetector.fix(cmdiFinding);
  const ptFix = await ptDetector.fix(ptFinding);

  const fixes = [sqlFix, xssFix, cmdiFix, ptFix] as const;
  for (const f of fixes) {
    console.log(`    ${f.findingType.padEnd(22)} findingId: ${f.findingId}`);
  }

  expect(sqlFix.findingType === "sql_injection_risk", "SQL fix.findingType");
  expect(xssFix.findingType === "xss_risk", "XSS fix.findingType");
  expect(cmdiFix.findingType === "command_injection_risk", "CMDi fix.findingType");
  expect(ptFix.findingType === "path_traversal_risk", "PT fix.findingType");

  expect(sqlFix.detectorId === "sql-injection-js-ts", "SQL detectorId");
  expect(xssFix.detectorId === "xss-js-ts", "XSS detectorId");
  expect(cmdiFix.detectorId === "command-injection-js-ts", "CMDi detectorId");
  expect(ptFix.detectorId === "path-traversal-js-ts", "PT detectorId");

  expect(
    sqlFix.findingId ===
      "central-llm-analyzer:sql_injection_risk:src/routes/users.js:42",
    "SQL findingId scheme"
  );
  expect(
    xssFix.findingId ===
      "central-llm-analyzer:xss_risk:src/views/profile.tsx:17",
    "XSS findingId scheme"
  );
  expect(
    cmdiFix.findingId ===
      "central-llm-analyzer:command_injection_risk:src/jobs/runner.ts:8",
    "CMDi findingId scheme"
  );
  expect(
    ptFix.findingId ===
      "central-llm-analyzer:path_traversal_risk:src/api/download.ts:22",
    "PT findingId scheme"
  );

  expect(
    sqlFix.metadata?.type === "sql_injection_risk",
    "SQL metadata discriminated"
  );
  expect(xssFix.metadata?.type === "xss_risk", "XSS metadata discriminated");
  expect(
    cmdiFix.metadata?.type === "command_injection_risk",
    "CMDi metadata discriminated"
  );
  expect(
    ptFix.metadata?.type === "path_traversal_risk",
    "PT metadata discriminated"
  );

  console.log("\n[2] Building WorkflowResult...");
  const lowCount = fixes.filter((f) => f.patchQuality === "low").length;
  const medCount = fixes.filter((f) => f.patchQuality === "medium").length;
  const highCount = fixes.filter((f) => f.patchQuality === "high").length;

  const workflow: WorkflowResult = {
    status: "success",
    automationReady: false,
    automationDecisionReason:
      "Four findings across four vulnerability families (synthetic harness)",
    totalFindings: 4,
    sqlInjectionFindings: 1,
    classifiedFindings: 4,
    skippedFindings: 0,
    fixesGenerated: 4,
    highQualityPatches: highCount,
    mediumQualityPatches: medCount,
    lowQualityPatches: lowCount,
    fixes: [...fixes],
    errors: [],
    metadata: { scanId: "phase-4b-validation", commitId: "deadbeef" },
    timing: {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1234,
    },
  };

  console.log("\n[3] Building SARIF log...");
  const sarif = buildSarifLog(workflow);
  const sarifJson = sarifToJson(sarif);
  const tmp = os.tmpdir();
  fs.writeFileSync(path.join(tmp, "fixor-validate.sarif.json"), sarifJson);
  const run = sarif.runs[0]!;
  const ruleIds = run.tool.driver.rules.map((r) => r.id).sort();
  console.log("    rule ids:", ruleIds.join(", "));
  console.log("    result ruleIds:", run.results.map((r) => r.ruleId).join(", "));

  expect(ruleIds.length === 4, "SARIF has 4 rule definitions");
  expect(run.results.length === 4, "SARIF has 4 results");
  expect(ruleIds.includes("sql_injection_risk"), "SARIF rule for SQL");
  expect(ruleIds.includes("xss_risk"), "SARIF rule for XSS");
  expect(
    ruleIds.includes("command_injection_risk"),
    "SARIF rule for command injection"
  );
  expect(ruleIds.includes("path_traversal_risk"), "SARIF rule for path traversal");

  const xssRule = run.tool.driver.rules.find((r) => r.id === "xss_risk")!;
  expect(xssRule.properties.cwe === "CWE-79", "XSS rule CWE-79");
  const ptRule = run.tool.driver.rules.find((r) => r.id === "path_traversal_risk")!;
  expect(ptRule.properties.cwe === "CWE-22", "PT rule CWE-22");

  console.log("\n[4] Rendering PR comment markdown...");
  const metadata: GitHubRepoMetadata = {
    owner: "tornidomaroc-web",
    repo: "fixor",
    pullNumber: 999,
    commitSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    scanId: "phase-4b-validation",
  };
  const markdown = buildPullRequestCommentMarkdown(metadata, workflow);
  fs.writeFileSync(path.join(tmp, "fixor-validate.comment.md"), markdown);

  expect(markdown.includes("`SQL injection`"), "Comment mentions SQL name");
  expect(
    markdown.includes("`Cross-site scripting (XSS)`"),
    "Comment mentions XSS name"
  );
  expect(
    markdown.includes("`OS command injection`"),
    "Comment mentions CMDi name"
  );
  expect(markdown.includes("`Path traversal`"), "Comment mentions PT name");
  expect(markdown.includes("**Dialect:**"), "SQL-specific dialect row rendered");
  expect(
    markdown.includes("**Vulnerabilities classified**"),
    "summary label present"
  );
  expect(markdown.includes("| 4 |"), "classified count is 4");

  const xssBlockStart = markdown.indexOf("Cross-site scripting (XSS)");
  const xssBlockEnd = markdown.indexOf("</details>", xssBlockStart);
  const xssBlock = markdown.slice(xssBlockStart, xssBlockEnd);
  expect(!xssBlock.includes("**Dialect:**"), "XSS block omits Dialect row");

  console.log("\n[5] Generating PDF...");
  try {
    const pdf = await generatePdfReport(workflow, {
      owner: metadata.owner,
      repo: metadata.repo,
      pullNumber: metadata.pullNumber,
      commitSha: metadata.commitSha!,
    });
    fs.writeFileSync(path.join(tmp, "fixor-validate.pdf"), pdf);
    expect(pdf.length > 0, "PDF buffer non-empty");
    expect(pdf.slice(0, 4).toString() === "%PDF", "PDF magic bytes present");
  } catch (err) {
    console.error("    PDF generation threw:", err);
    failures++;
  }

  console.log("\n=== Artifacts saved ===");
  console.log(`  ${path.join(tmp, "fixor-validate.sarif.json")}`);
  console.log(`  ${path.join(tmp, "fixor-validate.comment.md")}`);
  console.log(`  ${path.join(tmp, "fixor-validate.pdf")}`);

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
