import type { Finding } from "../analysis-engine/types.js";
import { analyzeCode } from "../analysis-engine/analyze.js";
import { getDetectorFor } from "../analysis-engine/detectors/registry.js";
import type { NormalizedFinding } from "../analysis-engine/detector.types.js";
import { extractSqlInjectionFromSemgrep } from "../services/vulnerability.service.js";
import {
  generateSqlInjectionRiskExplanation,
  type SqlInjectionExploit,
} from "../services/risk-explainer.js";
import type { NormalizedSqlInjectionFinding } from "../types/vulnerability.types.js";
import type { WorkflowResult, ScanMetadata } from "../types/workflow.types.js";
import { runWithConcurrency } from "../lib/concurrency.js";
import { logger } from "../lib/logger.js";
import * as Sentry from "@sentry/node";

function findingToNormalized(f: Finding): NormalizedFinding {
  const msg = f.explanation.slice(0, 500);
  const originalCode = f.original_snippet || `// ${f.file}:${f.line}`;
  return {
    detectorId: "central-llm-analyzer",
    type: f.type,
    file: f.file,
    startLine: f.line,
    endLine: f.line,
    originalCode,
    ruleId: `claude-analysis-${f.type}`,
    message: msg,
    explanation: f.why_it_matters,
    confidence: f.confidence,
    severity: f.severity,
  };
}

/** Convert a SQL-specific finding back into the generic NormalizedFinding
 *  shape. Used for the legacy Semgrep path so it can reuse the registry. */
function sqlFindingToNormalized(
  f: NormalizedSqlInjectionFinding
): NormalizedFinding {
  return {
    detectorId: "semgrep-legacy",
    type: "sql_injection_risk",
    file: f.file,
    startLine: f.startLine,
    endLine: f.endLine,
    originalCode: f.originalCode,
    ruleId: f.ruleId,
    message: f.message,
    explanation: f.explanation,
    confidence: f.classificationConfidence,
    severity: "high",
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
    return "No classified vulnerabilities to automate";
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
  /**
   * Wall-clock budget for the whole workflow. Must exceed the sum of
   * per-phase model timeouts in MODEL_DEFAULTS — one Opus call alone can
   * take up to 60s, and we run detection + ≤4 parallel fix services +
   * risk explainer. 120s leaves comfortable headroom for real LLM runs
   * while still failing fast on a truly stuck call.
   */
  timeoutMs: number = 120_000
): Promise<WorkflowResult> {
  return Sentry.startSpan(
    {
      name: "fixor.workflow.auditor",
      op: "function",
      attributes: {
        "fixor.scan_id": metadata.scanId,
        "fixor.repo": metadata.repoName,
        "fixor.commit_id": metadata.commitId,
        "fixor.timeout_ms": timeoutMs,
      },
    },
    async () => {
      const startedAt = new Date().toISOString();
      const startTimeMs = Date.now();

      logger.info({ scanId: metadata.scanId }, "workflow started");

      let timeoutHandle: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<WorkflowResult>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Workflow timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      });

      try {
        return await Promise.race([
          executeWorkflow(semgrepPayload, metadata, startedAt, startTimeMs),
          timeoutPromise,
        ]);
      } catch (err) {
        Sentry.captureException(err, {
          tags: { "fixor.phase": "workflow" },
          extra: { scanId: metadata.scanId, repo: metadata.repoName },
        });
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { err: message },
          "workflow execution failed or timed out",
        );
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
          classifiedFindings: 0,
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
    },
  );
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
    classifiedFindings: 0,
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
      logger.info({ status }, "workflow completed");
    } else if (status === "no_action") {
      logger.info("workflow finished: no_action");
    } else {
      logger.warn("workflow failed");
    }
    return result;
  };

  const diffStr = extractDiffString(semgrepPayload);
  let findings: NormalizedFinding[];
  /** SQL-shaped findings retained for the risk explainer (SQL-only today). */
  let sqlFindingsForExplainer: NormalizedSqlInjectionFinding[] = [];
  let legacyRoot: any = null;

  if (diffStr) {
    logger.debug("using Claude analysis engine on PR diff");
    const analysis = await analyzeCode(diffStr);
    result.totalFindings = analysis.findings.length;
    findings = analysis.findings.map(findingToNormalized);
    sqlFindingsForExplainer = analysis.findings
      .filter((f) => f.type === "sql_injection_risk")
      .map(
        (f): NormalizedSqlInjectionFinding => ({
          type: "SQL_INJECTION",
          findingType: "sql_injection_risk",
          file: f.file,
          startLine: f.line,
          endLine: f.line,
          ruleId: "claude-analysis-sql-injection-risk",
          message: f.explanation.slice(0, 500),
          originalCode: f.original_snippet || `// ${f.file}:${f.line}`,
          explanation: f.why_it_matters,
          classificationConfidence: f.confidence,
          classificationScore:
            f.confidence === "high" ? 90 : f.confidence === "medium" ? 50 : 20,
        })
      );
    logger.info(
      {
        totalFindings: result.totalFindings,
        sqlInjectionFindings: sqlFindingsForExplainer.length,
      },
      "analysis findings extracted",
    );
  } else {
    const { root, error } = parseSemgrepPayload(semgrepPayload);
    if (error || !root) {
      logger.error({ err: error }, "payload validation failed");
      result.errors.push({ message: error || "Unknown validation error" });
      result.automationDecisionReason = "Workflow failed";
      return finalize("failed");
    }
    legacyRoot = root;
    logger.debug("legacy Semgrep payload validated");
    result.totalFindings = root.results.length;
    logger.info(
      { totalFindings: result.totalFindings },
      "total findings extracted",
    );

    const semgrepFindings = extractSqlInjectionFromSemgrep(root);
    const diffFindings: NormalizedSqlInjectionFinding[] = Array.isArray(
      root.findings
    )
      ? (root.findings as NormalizedSqlInjectionFinding[])
      : [];
    sqlFindingsForExplainer = [...semgrepFindings, ...diffFindings];
    findings = sqlFindingsForExplainer.map(sqlFindingToNormalized);
  }

  // Partition findings by detector availability. Unsupported types are
  // counted as skipped until a detector for them ships (Phase 4A+).
  const routed: { finding: NormalizedFinding; detectorId: string }[] = [];
  const unsupportedByType = new Map<string, number>();
  for (const f of findings) {
    const detector = getDetectorFor(f.type);
    if (detector) {
      routed.push({ finding: f, detectorId: detector.id });
    } else {
      unsupportedByType.set(f.type, (unsupportedByType.get(f.type) ?? 0) + 1);
    }
  }

  result.sqlInjectionFindings = findings.filter(
    (f) => f.type === "sql_injection_risk"
  ).length;
  result.classifiedFindings = routed.length;
  const unsupportedTotal = Array.from(unsupportedByType.values()).reduce(
    (a, b) => a + b,
    0
  );
  if (legacyRoot) {
    result.skippedFindings =
      result.totalFindings - result.sqlInjectionFindings;
  } else {
    result.skippedFindings = unsupportedTotal;
  }
  if (unsupportedByType.size > 0) {
    for (const [type, count] of unsupportedByType) {
      logger.info(
        { type, count },
        "findings of type have no registered detector; skipped",
      );
    }
  }
  logger.info(
    {
      classifiedFindings: result.classifiedFindings,
      sqlInjectionFindings: result.sqlInjectionFindings,
      skippedFindings: result.skippedFindings,
    },
    "findings classified",
  );

  logger.debug("fix generation started");

  /**
   * Bounded concurrency: we don't want a 100-finding PR to open 100
   * simultaneous Claude connections. 4 keeps wall time low while
   * staying well under per-account rate limits.
   */
  const FIX_CONCURRENCY = 4;
  const fixResults = await runWithConcurrency(
    routed,
    FIX_CONCURRENCY,
    async ({ finding }) => {
      const detector = getDetectorFor(finding.type);
      if (!detector) {
        return {
          kind: "err" as const,
          finding,
          message: `No detector registered for type '${finding.type}'`,
        };
      }
      try {
        const fix = await detector.fix(finding);
        return { kind: "ok" as const, finding, fix };
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
      logger.warn(
        {
          file: r.finding.file,
          line: r.finding.startLine,
          err: r.message,
        },
        "failed to generate fix",
      );
      result.errors.push({
        findingId: r.finding.ruleId || "unknown",
        message: "Failed to generate fix",
        details: r.message,
      });
    }
  }

  logger.info(
    { fixesGenerated: result.fixesGenerated },
    "fix generation completed",
  );

  // Risk explanations apply only to SQL fixes (no XSS equivalent exists
  // yet). Key the map by the SQL fix's findingId so the comment builder
  // attaches exploit text to the RIGHT fix even when the fixes array
  // interleaves SQL and XSS findings.
  const sqlFixesInOrder = result.fixes.filter(
    (f) => f.findingType === "sql_injection_risk"
  );
  const exploits: Record<string, SqlInjectionExploit> = {};
  if (sqlFixesInOrder.length > 0 && sqlFindingsForExplainer.length > 0) {
    const pairs = sqlFindingsForExplainer
      .slice(0, sqlFixesInOrder.length)
      .map((finding, i) => ({ finding, fixId: sqlFixesInOrder[i]!.findingId }));
    const riskResults = await Promise.allSettled(
      pairs.map(async (p) => ({
        fixId: p.fixId,
        exploit: await generateSqlInjectionRiskExplanation(p.finding, {
          dialect: "mysql",
          includeProof: true,
        }),
      }))
    );
    for (const r of riskResults) {
      if (r.status === "fulfilled") exploits[r.value.fixId] = r.value.exploit;
    }
  }
  result.exploits = exploits;

  let finalStatus: WorkflowResult["status"] = "failed";

  if (result.classifiedFindings === 0 && result.errors.length === 0) {
    finalStatus = "no_action";
  } else if (result.classifiedFindings > 0 && result.fixesGenerated === 0) {
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
