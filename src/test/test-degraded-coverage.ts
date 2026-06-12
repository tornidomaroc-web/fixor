/**
 * Degraded-coverage regression test (deterministic, no LLM spend, no DB).
 *
 * Guards the invariant added after the 2026-06-11 audit: an LLM detection
 * call failing can NEVER silently present as "no findings". The original
 * defect: every detector mapped callClaude failures to [] (audit run 3:
 * 68 of 90 calls failed after the key died mid-run and the output still
 * read as a clean scan — for a security tool, a false "you're clean" is
 * the worst possible output).
 *
 * Failure injection is the REAL no-key path through callClaude (delete
 * ANTHROPIC_API_KEY → ok:false/no_api_key with zero network I/O), so the
 * test exercises the production chokepoint, not a mock of it.
 *
 * Covers:
 *   1. Chokepoint tally: detection calls are counted (attempted/failed,
 *      by caller, by reason); auxiliary calls (fix-gen) are excluded.
 *   2. Workflow: a diff-scan with failed detection calls surfaces
 *      llmCoverage, pushes a WorkflowError, lands status="failed" (never
 *      no_action), automationReady=false, and a degraded decision reason.
 *   3. Workflow clean control: a zero-LLM-call run reports full coverage
 *      with NO false degradation warning and status no_action.
 *   4. Report: degraded banner + summary line + per-file coverage gaps;
 *      blind variant when ALL calls failed; clean report renders the
 *      positive full-coverage line and no banner.
 *   5. SARIF: invocation.executionSuccessful=false + notification on
 *      degraded runs; true on clean runs.
 *   6. CLI exit-code contract: 0 on full coverage, 2 on degraded.
 *
 * Run via: npm run test:degraded-coverage
 */

// MUST happen before any callClaude: guarantee the no-key failure path.
delete process.env.ANTHROPIC_API_KEY;

import { callClaude } from "../analysis-engine/anthropic-client";
import { CLAUDE_MODELS } from "../config/models";
import {
  coverageExitCode,
  llmCoverageSince,
  snapshotLlmCoverage,
} from "../lib/llm-coverage";
import { runAuditorWorkflow } from "../workflows/auditor-workflow";
import {
  buildMarkdownReport,
  type FileScanResult,
} from "../cli/report-builder";
import { buildSarifLog } from "../services/sarif-output.service";
import type { WorkflowResult } from "../types/workflow.types";
import type { Finding } from "../analysis-engine/types";

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    failures++;
  } else {
    console.log(`[PASS] ${msg}`);
  }
}

// An IDOR-shaped FastAPI diff: a request-derived path param (SOURCE)
// flowing into a session.get primary-key lookup (SINK) with no
// ownership filter. This clears the IDOR detector's prefilter so it
// makes a real callClaude — which fails to `no_api_key` here, exercising
// the degraded-coverage gate on a SPECIALIZED detector.
//
// H3 NOTE: this used to be a benign JS diff that relied on the central
// analyzeCode call (the only unconditional LLM call per diff). H3
// removed analyzeCode, so a benign diff now makes ZERO detection calls
// (specialized detectors short-circuit on the prefilter) and is
// correctly clean. The gate is unchanged; the fixture now has to
// actually trigger a detection call to test it.
const DETECTION_TRIGGERING_DIFF = [
  "diff --git a/app/routers/items.py b/app/routers/items.py",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/app/routers/items.py",
  "@@ -0,0 +1,8 @@",
  "+from fastapi import APIRouter, Depends",
  "+from app.db import get_session",
  "+router = APIRouter()",
  '+@router.get("/items/{item_id}")',
  "+def read_item(item_id: int, session = Depends(get_session)):",
  "+    item = session.get(Item, item_id)",
  "+    return item",
].join("\n");

function sampleFinding(file: string): Finding {
  return {
    type: "sql_injection_risk",
    file,
    line: 10,
    confidence: "high",
    severity: "critical",
    explanation: "test finding",
    why_it_matters: "test",
    suggested_fix: "test",
    example_fix: "test",
    original_snippet: "db.query(`SELECT * FROM t WHERE id=${id}`)",
  };
}

async function testChokepointTally(): Promise<void> {
  console.log("\n--- 1. chokepoint tally ---");

  const snap = snapshotLlmCoverage();
  const detection = await callClaude({
    callerId: "test-detector",
    model: CLAUDE_MODELS.DETECTION,
    system: "test",
    messages: [{ role: "user", content: "test" }],
  });
  assert(
    !detection.ok && detection.reason === "no_api_key",
    "no-key detection call fails with reason no_api_key (no network)",
  );
  const d1 = llmCoverageSince(snap);
  assert(d1.attempted === 1, `detection call tallied as attempted (got ${d1.attempted})`);
  assert(d1.failed === 1, `detection call tallied as failed (got ${d1.failed})`);
  assert(
    d1.byReason.no_api_key === 1,
    "failure reason recorded as no_api_key",
  );
  assert(
    d1.byCaller["test-detector"] === 1,
    "failure attributed to callerId",
  );

  const snap2 = snapshotLlmCoverage();
  await callClaude({
    coverage: "auxiliary",
    model: CLAUDE_MODELS.REASONING,
    system: "test",
    messages: [{ role: "user", content: "test" }],
  });
  const d2 = llmCoverageSince(snap2);
  assert(
    d2.attempted === 0 && d2.failed === 0,
    "auxiliary call is excluded from the coverage tally",
  );
}

async function testWorkflowSurfacesDegradation(): Promise<void> {
  console.log("\n--- 2. workflow surfaces degraded coverage ---");

  const result = await runAuditorWorkflow({ diff: DETECTION_TRIGGERING_DIFF });

  assert(result.llmCoverage !== undefined, "workflow result carries llmCoverage");
  assert(
    (result.llmCoverage?.failed ?? 0) >= 1,
    `llmCoverage.failed >= 1 (got ${result.llmCoverage?.failed})`,
  );
  assert(
    (result.llmCoverage?.byCaller["idor-multi"] ?? 0) >= 1,
    "the specialized detector's failed call is attributed by callerId",
  );
  assert(
    result.status === "failed",
    `0-findings run with failed LLM calls is status "failed", NOT no_action (got "${result.status}")`,
  );
  assert(
    result.automationReady === false,
    "automationReady is false on a degraded run",
  );
  assert(
    result.errors.some((e) => /coverage degraded/i.test(e.message)),
    "a degraded-coverage WorkflowError is pushed (reaches the PR comment)",
  );
  assert(
    /coverage degraded/i.test(result.automationDecisionReason),
    `automationDecisionReason names the degradation (got "${result.automationDecisionReason}")`,
  );
}

async function testWorkflowCleanControl(): Promise<void> {
  console.log("\n--- 3. workflow clean control (no false warning) ---");

  // Legacy Semgrep payload with zero findings: no LLM call is ever made,
  // so this run must present as genuinely clean — full coverage, no
  // degradation error, status no_action.
  const result = await runAuditorWorkflow({ results: [], findings: [] });

  assert(
    result.llmCoverage !== undefined &&
      result.llmCoverage.attempted === 0 &&
      result.llmCoverage.failed === 0,
    `clean run reports zero attempted/failed (got ${JSON.stringify(result.llmCoverage)})`,
  );
  assert(
    result.status === "no_action",
    `clean run keeps status no_action (got "${result.status}")`,
  );
  assert(
    !result.errors.some((e) => /coverage/i.test(e.message)),
    "no false degraded-coverage error on a clean run",
  );
  assert(
    result.automationDecisionReason === "No classified vulnerabilities to automate",
    "automationDecisionReason unchanged on a clean run",
  );
}

function testReportRendering(): void {
  console.log("\n--- 4. report rendering ---");

  const resultsWithGap: FileScanResult[] = [
    {
      filePath: "src/clean.ts",
      findings: [],
      llmFailures: 0,
      llmFailuresByReason: {},
    },
    {
      filePath: "src/blindspot.ts",
      findings: [],
      llmFailures: 2,
      llmFailuresByReason: { http_error: 2 },
    },
    {
      filePath: "src/vuln.ts",
      findings: [sampleFinding("src/vuln.ts")],
      llmFailures: 0,
      llmFailuresByReason: {},
    },
  ];

  const degraded = buildMarkdownReport("repo", resultsWithGap, {
    coverage: { attempted: 90, failed: 2, byReason: { http_error: 2 } },
  });
  assert(
    degraded.includes("DEGRADED COVERAGE — NOT A CLEAN SCAN"),
    "degraded report leads with the degraded-coverage banner",
  );
  assert(
    degraded.includes("2 of 90 LLM detection calls failed"),
    "banner states failed/attempted counts",
  );
  assert(
    degraded.includes("## Coverage gaps (NOT fully analyzed)"),
    "degraded report has a Coverage gaps section",
  );
  assert(
    degraded.includes("`src/blindspot.ts` — 2 failed call(s) (http_error: 2)"),
    "the not-analyzed file is listed with counts and reasons",
  );
  assert(
    degraded.includes("LLM detection coverage: **DEGRADED**"),
    "summary block carries the degraded coverage line",
  );

  const blind = buildMarkdownReport("repo", resultsWithGap, {
    coverage: { attempted: 90, failed: 90, byReason: { no_api_key: 90 } },
  });
  assert(
    blind.includes("SCAN BLIND — ALL 90 LLM detection calls failed"),
    "all-calls-failed run renders the SCAN BLIND banner",
  );
  assert(
    blind.includes("MUST NOT be used as evidence of a clean codebase"),
    "blind banner forbids reading the report as clean",
  );

  const clean = buildMarkdownReport(
    "repo",
    [{ filePath: "src/clean.ts", findings: [], llmFailures: 0, llmFailuresByReason: {} }],
    { coverage: { attempted: 90, failed: 0, byReason: {} } },
  );
  assert(
    !clean.includes("DEGRADED") && !clean.includes("SCAN BLIND"),
    "clean report has no degraded/blind banner (no false warning)",
  );
  assert(
    clean.includes("LLM detection coverage: full — 90/90 calls succeeded"),
    "clean report makes full coverage an explicit positive claim",
  );
  assert(
    !clean.includes("## Coverage gaps"),
    "clean report has no Coverage gaps section",
  );
}

function workflowResultShell(
  llmCoverage: WorkflowResult["llmCoverage"],
): WorkflowResult {
  return {
    status: "no_action",
    automationReady: false,
    automationDecisionReason: "",
    totalFindings: 0,
    sqlInjectionFindings: 0,
    classifiedFindings: 0,
    skippedFindings: 0,
    fixesGenerated: 0,
    highQualityPatches: 0,
    mediumQualityPatches: 0,
    lowQualityPatches: 0,
    fixes: [],
    errors: [],
    llmCoverage,
    metadata: {},
    timing: { startedAt: "", finishedAt: "", durationMs: 0 },
  };
}

function testSarifInvocation(): void {
  console.log("\n--- 5. SARIF invocation record ---");

  const degraded = buildSarifLog(
    workflowResultShell({
      attempted: 90,
      failed: 68,
      byReason: { http_error: 68 },
      byCaller: { "central-analyzer": 68 },
    }),
  );
  const degradedInv = degraded.runs[0]!.invocations[0]!;
  assert(
    degradedInv.executionSuccessful === false,
    "degraded run: SARIF executionSuccessful is false",
  );
  assert(
    degradedInv.toolExecutionNotifications?.some(
      (n) => n.level === "error" && /coverage degraded/i.test(n.message.text),
    ) ?? false,
    "degraded run: SARIF carries an error notification naming the degradation",
  );

  const clean = buildSarifLog(
    workflowResultShell({ attempted: 90, failed: 0, byReason: {}, byCaller: {} }),
  );
  assert(
    clean.runs[0]!.invocations[0]!.executionSuccessful === true,
    "clean run: SARIF executionSuccessful is true",
  );

  const legacy = buildSarifLog(workflowResultShell(undefined));
  assert(
    legacy.runs[0]!.invocations[0]!.executionSuccessful === true,
    "result without coverage info (legacy shape) stays executionSuccessful",
  );
}

function testExitCodeContract(): void {
  console.log("\n--- 6. CLI exit-code contract ---");
  assert(coverageExitCode(0) === 0, "full coverage exits 0");
  assert(coverageExitCode(1) === 2, "a single failed detection call exits 2");
  assert(coverageExitCode(68) === 2, "mass failure (audit run 3 shape) exits 2");
}

async function main(): Promise<void> {
  assert(
    !process.env.ANTHROPIC_API_KEY,
    "precondition: ANTHROPIC_API_KEY is unset (failure injection via real no-key path)",
  );

  await testChokepointTally();
  await testWorkflowSurfacesDegradation();
  await testWorkflowCleanControl();
  testReportRendering();
  testSarifInvocation();
  testExitCodeContract();

  console.log(
    failures === 0
      ? "\nDegraded-coverage test: PASS."
      : `\nDegraded-coverage test: ${failures} FAILURE(S).`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
