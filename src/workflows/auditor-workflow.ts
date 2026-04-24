import type { Finding } from "../analysis-engine/types.js";
import { analyzeCode } from "../analysis-engine/analyze.js";
import { extractSqlInjectionFromSemgrep } from "../services/vulnerability.service.js";
import {
  generateSqlInjectionRiskExplanation,
  type SqlInjectionExploit,
} from "../services/risk-explainer.js";
import { generateSqlInjectionFix } from "../services/fix.service.js";
import type { NormalizedSqlInjectionFinding } from "../types/vulnerability.types.js";
import type { WorkflowResult, ScanMetadata } from "../types/workflow.types.js";
import { runWithConcurrency } from "../lib/concurrency.js";

function findingToNormalized(f: Finding): NormalizedSqlInjectionFinding {
  const score =
    f.confidence === "high" ? 90 : f.confidence === "medium" ? 50 : 20;
  const msg = f.explanation.slice(0, 500);
  const originalCode = f.original_snippet || `// ${f.file}:${f.line}`;
  return {
    type: "SQL_INJECTION",
    file: f.file,
    startLine: f.line,
    endLine: f.line,
    ruleId: "claude-analysis-sql-injection-risk",
    message: msg,
    originalCode,
    explanation: f.why_it_matters,
    classificationConfidence: f.confidence,
    classificationScore: score,
  };
}

function extractDiffString(payload: unknown): string | null {
  if (typeof payload === "string") {
    const t = payload.trim();
    if (
      t.includes("diff --git") ||
      (t.includes("@@") && t.includes("\n")) ||
      /^---\s+\S/m.test(t)
    ) {
      return t;
    }
    return null;
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const o = payload as Record<string, unknown>;
    if (typeof o.diff === "string" && o.diff.trim()) return o.diff.trim();
    if (typeof o.prDiff === "string" && o.prDiff.trim()) return o.prDiff.trim();
  }
  return null;
}

/**
 * Validates legacy Semgrep payload shape (when no raw diff is provided).
 */
function parseSemgrepPayload(payload: any): { root: any; error?: string } {
  let root = payload;

  if (typeof payload === "string") {
    try {
      root = JSON.parse(payload);
    } catch {
      return { root: null, error: "Invalid JSON format" };
    }
  }

  const hasResults = Array.isArray(root.results);
  const hasFindings = Array.isArray(root.findings);

  if (
    typeof root !== "object" ||
    root === null ||
    (!hasResults && !hasFindings)
  ) {
    return {
      root: null,
      error: "Malformed payload: missing results or findings array",
    };
  }
  if (!hasResults && hasFindings) {
    root.results = [];
  }

  return { root };
}

function computeAutomationDecisionReason(
  finalStatus: WorkflowResult["status"],
  lowQualityPatches: number,
  anyPatchWarnings: boolean,
  automationReady: boolean
): string {
  if (finalStatus === "failed") {
    return "Workflow failed";
  }
  if (finalStatus === "partial_success") {
    return "Partial success: errors occurred during fix generation";
  }
  if (finalStatus === "no_action") {
    return "No SQL injection findings to automate";
  }
  if (finalStatus === "success" && lowQualityPatches > 0) {
    return "Low-quality patches detected";
  }
  if (finalStatus === "success" && anyPatchWarnings) {
    return "Warnings present in patches";
  }
  if (automationReady) {
    return "All patches high/medium quality and no warnings";
  }
  return "Automation not ready";
}

/**
 * Main workflow entry point with a timeout guard.
 */
export async function runAuditorWorkflow(
  semgrepPayload: any,
  metadata: ScanMetadata = {},
  timeoutMs: number = 30000
): Promise<WorkflowResult> {
  const startedAt = new Date().toISOString();
  const startTimeMs = Date.now();

  console.log(
    `[Workflow] Started execution.${metadata.scanId ? ` Scan ID: ${metadata.scanId}` : ""}`
  );

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<WorkflowResult>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`Workflow timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([
      executeWorkflow(semgrepPayload, metadata, startedAt, startTimeMs),
      timeoutPromise,
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Workflow] Execution failed or timed out:", message);
    const finishedAt = new Date().toISOString();
    return {
      status: "failed",
      automationReady: false,
      automationDecisionReason:
        message.includes("timed out") || message.includes("timeout")
          ? "Workflow timed out"
          : "Workflow failed",
      totalFindings: 0,
      sqlInjectionFindings: 0,
      skippedFindings: 0,
      fixesGenerated: 0,
      highQualityPatches: 0,
      mediumQualityPatches: 0,
      lowQualityPatches: 0,
      fixes: [],
      errors: [{ message: message || "Unknown workflow error" }],
      metadata,
      timing: {
        startedAt,
        finishedAt,
        durationMs: Date.now() - startTimeMs,
      },
    };
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

/**
 * Executes the steps of the workflow.
 */
async function executeWorkflow(
  semgrepPayload: any,
  metadata: ScanMetadata,
  startedAt: string,
  startTimeMs: number
): Promise<WorkflowResult> {
  const result: WorkflowResult = {
    status: "failed",
    automationReady: false,
    automationDecisionReason: "",
    totalFindings: 0,
    sqlInjectionFindings: 0,
    skippedFindings: 0,
    fixesGenerated: 0,
    highQualityPatches: 0,
    mediumQualityPatches: 0,
    lowQualityPatches: 0,
    fixes: [],
    errors: [],
    metadata,
    timing: { startedAt, finishedAt: "", durationMs: 0 },
  };

  const finalize = (status: WorkflowResult["status"]) => {
    result.status = status;
    result.timing.finishedAt = new Date().toISOString();
    result.timing.durationMs = Date.now() - startTimeMs;
    if (status === "success" || status === "partial_success") {
      console.log(`[Workflow] Workflow completed with ${status}.`);
    } else if (status === "no_action") {
      console.log(`[Workflow] Workflow finished: no_action.`);
    } else {
      console.log(`[Workflow] Workflow failed.`);
    }
    return result;
  };

  const diffStr = extractDiffString(semgrepPayload);
  let sqlFindings: NormalizedSqlInjectionFinding[];
  let legacyRoot: any = null;

  if (diffStr) {
    console.log("[Workflow] Using Claude analysis engine on PR diff.");
    const analysis = await analyzeCode(diffStr);
    result.totalFindings = analysis.findings.length;
    sqlFindings = analysis.findings.map(findingToNormalized);
    result.skippedFindings = 0;
    console.log(
      `[Workflow] Analysis findings: ${result.totalFindings}; SQL injection (classified): ${sqlFindings.length}`
    );
  } else {
    const { root, error } = parseSemgrepPayload(semgrepPayload);
    if (error || !root) {
      console.error("[Workflow] Payload validation failed:", error);
      result.errors.push({ message: error || "Unknown validation error" });
      result.automationDecisionReason = "Workflow failed";
      return finalize("failed");
    }
    legacyRoot = root;
    console.log("[Workflow] Legacy Semgrep payload validated successfully.");
    result.totalFindings = root.results.length;
    console.log(`[Workflow] Total findings extracted: ${result.totalFindings}`);

    const semgrepFindings = extractSqlInjectionFromSemgrep(root);
    const diffFindings: NormalizedSqlInjectionFinding[] = Array.isArray(
      root.findings
    )
      ? (root.findings as NormalizedSqlInjectionFinding[])
      : [];
    sqlFindings = [...semgrepFindings, ...diffFindings];
  }

  result.sqlInjectionFindings = sqlFindings.length;
  console.log(`[Workflow] SQL Injection findings count: ${result.sqlInjectionFindings}`);
  if (legacyRoot) {
    result.skippedFindings =
      result.totalFindings - result.sqlInjectionFindings;
  }

  console.log("[Workflow] Fix generation started.");

  /**
   * Bounded concurrency: we don't want a 100-finding PR to open 100
   * simultaneous Claude connections. 4 keeps wall time low while
   * staying well under per-account rate limits.
   */
  const FIX_CONCURRENCY = 4;
  const fixResults = await runWithConcurrency(
    sqlFindings,
    FIX_CONCURRENCY,
    async (finding) => {
      try {
        return { kind: "ok" as const, finding, fix: await generateSqlInjectionFix(finding) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { kind: "err" as const, finding, message };
      }
    }
  );

  for (const r of fixResults) {
    if (r.kind === "ok") {
      result.fixes.push(r.fix);
      result.fixesGenerated++;
      if (r.fix.patchQuality === "high") result.highQualityPatches++;
      else if (r.fix.patchQuality === "medium") result.mediumQualityPatches++;
      else result.lowQualityPatches++;
    } else {
      console.warn(
        `[Workflow] Failed to generate fix for finding in ${r.finding.file}:${r.finding.startLine}`
      );
      result.errors.push({
        findingId: r.finding.ruleId || "unknown",
        message: "Failed to generate fix",
        details: r.message,
      });
    }
  }

  console.log(
    `[Workflow] Fix generation completed. Generated ${result.fixesGenerated} fixes.`
  );

  const exploits: SqlInjectionExploit[] = [];
  if (result.fixes.length > 0) {
    const riskResults = await Promise.allSettled(
      sqlFindings.slice(0, result.fixes.length).map((finding) =>
        generateSqlInjectionRiskExplanation(finding, {
          dialect: "mysql",
          includeProof: true,
        })
      )
    );
    for (const r of riskResults) {
      if (r.status === "fulfilled") exploits.push(r.value);
    }
  }
  result.exploits = exploits;

  let finalStatus: WorkflowResult["status"] = "failed";

  if (result.sqlInjectionFindings === 0 && result.errors.length === 0) {
    finalStatus = "no_action";
  } else if (result.sqlInjectionFindings > 0 && result.fixesGenerated === 0) {
    finalStatus = "failed";
  } else if (result.fixesGenerated > 0 && result.errors.length > 0) {
    finalStatus = "partial_success";
  } else if (result.fixesGenerated > 0 && result.errors.length === 0) {
    finalStatus = "success";
  } else if (result.errors.length > 0) {
    finalStatus = "failed";
  }

  const anyPatchWarnings = result.fixes.some(
    (f) => Array.isArray(f.patchWarnings) && f.patchWarnings.length > 0
  );

  result.automationReady =
    finalStatus === "success" &&
    result.lowQualityPatches === 0 &&
    !anyPatchWarnings;

  result.automationDecisionReason = computeAutomationDecisionReason(
    finalStatus,
    result.lowQualityPatches,
    anyPatchWarnings,
    result.automationReady
  );

  return finalize(finalStatus);
}
