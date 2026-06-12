import {
  getDetectorFor,
  DETECTORS,
  SHIPPING_DETECTOR_IDS,
} from "../analysis-engine/detectors/registry.js";
import type { NormalizedFinding } from "../analysis-engine/detector.types.js";
import { extractSqlInjectionFromSemgrep } from "../services/vulnerability.service.js";
import type { NormalizedSqlInjectionFinding } from "../types/vulnerability.types.js";
import type { WorkflowResult, ScanMetadata } from "../types/workflow.types.js";
import { runWithConcurrency } from "../lib/concurrency.js";
import { logger } from "../lib/logger.js";
import * as Sentry from "@sentry/node";
import { currentInstallationId } from "../lib/cost-context.js";
import { getOrgSettingsForInstallation } from "../services/orgs.service.js";
import {
  passesOrgSettings,
  type OrgSettingsView,
  type FilterStats,
} from "../lib/org-settings-filter.js";
import { isSuppressedFindingType } from "../config/finding-suppressions.js";
import {
  llmCoverageSince,
  snapshotLlmCoverage,
} from "../lib/llm-coverage.js";
import { partitionFindingsByChangedLines } from "./changed-line-partition.js";

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

// Specialized detectors invoked alongside the central analyzer.
// Same id-allowlist pattern as src/cli/scan.ts; both share
// SHIPPING_DETECTOR_IDS from the registry as the single source of truth
// for "which detectors actually run and emit."
const phase5Detectors = DETECTORS.filter(
  (d) => SHIPPING_DETECTOR_IDS.has(d.id) && typeof d.detect === "function",
);

function dedupeNormalizedFindings(
  arr: NormalizedFinding[],
): NormalizedFinding[] {
  const seen = new Set<string>();
  const out: NormalizedFinding[] = [];
  for (const f of arr) {
    const key = `${f.file}:${f.startLine}:${f.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
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
  automationReady: boolean,
  llmCallsFailed: number
): string {
  // Degraded detection coverage dominates every other reason: whatever
  // else happened, the scan was partially blind and must not be acted
  // on as if it were complete.
  if (llmCallsFailed > 0) {
    return `Detection coverage degraded: ${llmCallsFailed} LLM call(s) failed — results are incomplete, do not treat as a clean scan`;
  }
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
  // Coverage snapshot for the whole run: any detection-path LLM failure
  // between here and the status computation marks the result degraded.
  // Auxiliary calls (fix-gen, risk explainer) are excluded by tag at the
  // callClaude chokepoint, so fix failures don't pollute this signal.
  const llmSnap = snapshotLlmCoverage();

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

  // Per-org settings are looked up once per workflow. Failure to read
  // them is non-fatal — we fall back to "no filter" (all findings pass)
  // and surface the error to Sentry so we notice. installationId comes
  // from costContext (set by the webhook handler).
  const installationId = currentInstallationId();
  let orgSettings: OrgSettingsView | null = null;
  if (installationId !== undefined) {
    try {
      orgSettings = await getOrgSettingsForInstallation(String(installationId));
    } catch (err) {
      Sentry.captureException(err, {
        tags: { "fixor.phase": "org_settings_lookup" },
        extra: { installationId: String(installationId) },
      });
      logger.warn(
        { installationId: String(installationId), err },
        "org settings lookup failed; running without filter",
      );
    }
  }

  const diffStr = extractDiffString(semgrepPayload);

  // H2 (whole-file scan input) side-channel: the webhook handler passes
  // the PR's changed-line map (drives the introduced/pre-existing
  // partition) and any whole-file fetch failures (degraded scan input —
  // surfaced as WorkflowErrors so the run can never present as a clean
  // success). Absent on CLI / legacy payloads → behavior unchanged.
  const payloadRecord =
    semgrepPayload &&
    typeof semgrepPayload === "object" &&
    !Array.isArray(semgrepPayload)
      ? (semgrepPayload as Record<string, unknown>)
      : null;
  const changedLinesByPath =
    payloadRecord &&
    payloadRecord.changedLinesByPath &&
    typeof payloadRecord.changedLinesByPath === "object" &&
    !Array.isArray(payloadRecord.changedLinesByPath)
      ? (payloadRecord.changedLinesByPath as Record<string, number[]>)
      : null;
  const scanInputErrors = payloadRecord && Array.isArray(payloadRecord.scanInputErrors)
    ? (payloadRecord.scanInputErrors as { path: string; reason: string }[])
    : [];

  let findings: NormalizedFinding[];
  /** SQL-shaped findings retained for the risk explainer (SQL-only today). */
  let sqlFindingsForExplainer: NormalizedSqlInjectionFinding[] = [];
  let legacyRoot: any = null;
  /** Aggregated per-reason filter counts, populated when orgSettings is set. */
  const filterStats: FilterStats = {
    droppedBySeverity: 0,
    droppedByGlob: 0,
    droppedByDetector: 0,
  };
  function tallyFilter(reason: "severity" | "glob" | "detector"): void {
    if (reason === "severity") filterStats.droppedBySeverity++;
    else if (reason === "glob") filterStats.droppedByGlob++;
    else filterStats.droppedByDetector++;
  }

  if (diffStr) {
    logger.debug("running specialized detectors on PR diff");

    // H3 (Phase H): the central analyzeCode pass was removed from this
    // path. Every finding type it emitted (sql/xss/cmdi/path-traversal)
    // is suppressed at the customer boundary
    // (src/config/finding-suppressions.ts), so after the suppression
    // filter its contribution to `findings` was provably empty — one
    // unconditional Sonnet call per diff paying for nothing. The
    // specialized detectors (which emit the 6 shipping, non-suppressed
    // types) are now the only producers on this path. analyzeCode stays
    // on disk; see analyze.ts for the re-enable conditions.
    //
    // Per-detector failure containment via allSettled (a thrown
    // detector becomes a logged warning, not a workflow failure), as
    // before.
    const detectorResults = await Promise.allSettled(
      phase5Detectors.map((d) =>
        d.detect
          ? d.detect({ diff: diffStr })
          : Promise.resolve([] as NormalizedFinding[]),
      ),
    );

    findings = [];

    // Per-detector containment + orgSettings filter + dedupe.
    const settings = orgSettings;
    for (let i = 0; i < detectorResults.length; i++) {
      const detector = phase5Detectors[i]!;
      const r = detectorResults[i]!;
      if (r.status === "rejected") {
        Sentry.captureException(r.reason, {
          tags: {
            "fixor.phase": "phase5_detector",
            "detector.id": detector.id,
          },
        });
        logger.warn(
          { err: r.reason, detector: detector.id },
          "phase 5 detector failed; continuing",
        );
        continue;
      }
      const filtered = settings
        ? r.value.filter((f) => {
            const r2 = passesOrgSettings(
              { file: f.file, type: f.type, severity: f.severity },
              settings,
            );
            if (!r2.passes) tallyFilter(r2.reason);
            return r2.passes;
          })
        : r.value;
      findings.push(...filtered);
    }
    findings = dedupeNormalizedFindings(findings);
    result.totalFindings = findings.length;

    // H2 partition: findings on code the PR did not touch are reported
    // detection-only (no fix generation, collapsed PR-comment section).
    // See workflows/changed-line-partition.ts for the product decision
    // and the fail-toward-introduced window semantics.
    if (changedLinesByPath) {
      const { introduced, preExisting } = partitionFindingsByChangedLines(
        findings,
        changedLinesByPath,
      );
      findings = introduced;
      if (preExisting.length > 0) {
        result.preExistingFindings = preExisting;
        logger.info(
          {
            preExisting: preExisting.length,
            introduced: introduced.length,
            files: [...new Set(preExisting.map((f) => f.file))],
          },
          "pre-existing findings partitioned out of fix generation",
        );
      }
    }

    logger.info(
      {
        totalFindings: result.totalFindings,
        filterStats,
      },
      "specialized detector findings extracted",
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

    // Apply settings filter to the legacy path too, on the SQL-shaped
    // array so the same array drives both `findings` and the
    // explainer (preserves positional alignment).
    if (orgSettings) {
      const settings = orgSettings;
      sqlFindingsForExplainer = sqlFindingsForExplainer.filter((f) => {
        const r = passesOrgSettings(
          {
            file: f.file,
            type: f.findingType,
            // Legacy SQL findings carry classificationConfidence but not
            // a severity field; we treat them as "high" since SQL
            // injection's default registry severity is high.
            severity: "high",
          },
          settings,
        );
        if (r.passes) return true;
        tallyFilter(r.reason);
        return false;
      });
    }

    findings = sqlFindingsForExplainer
      .map(sqlFindingToNormalized)
      .filter((f) => !isSuppressedFindingType(f.type));
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

  // SQL risk explanations are structurally unreachable since H3 and the
  // suppression gate: `generateSqlInjectionRiskExplanation` only fired
  // on fixes whose `findingType === "sql_injection_risk"`, but SQL
  // findings (from analyzeCode, now removed, or the legacy Semgrep path)
  // are suppressed BEFORE fix routing, so `result.fixes` can never
  // contain a SQL fix → `sqlFixesInOrder` was always empty → the
  // explainer guard never passed. The dead invocation block was removed
  // in H3. `exploits` stays on the result shape (consumed by the
  // comment builder / webhook server) as a constant empty map. To
  // re-enable: clear `sql_injection_risk` from
  // src/config/finding-suppressions.ts (which requires the SQL family
  // to earn a measured baseline per the audit's D2 rule), then restore
  // the explainer call here. risk-explainer.ts stays on disk.
  result.exploits = {};

  // H2: whole-file fetch failures degrade the scan input below the
  // baseline-measured conditions. Surfacing them as WorkflowErrors
  // keeps the status machine honest (a run with unfetchable files can
  // never be `no_action` or `success`), mirroring the LLM coverage
  // gate's fail-loud posture.
  for (const e of scanInputErrors) {
    result.errors.push({
      message: `Scan input degraded: ${e.path} could not be fetched at the PR head — judged without whole-file context`,
      details: e.reason,
    });
  }

  // Surface degraded detection coverage BEFORE computing the final
  // status. Pushing a WorkflowError here is load-bearing: the status
  // machine below requires errors.length === 0 for both `no_action` and
  // `success`, so a blind "0 findings" run becomes `failed` and a
  // partially-blind run with fixes becomes `partial_success` — never a
  // clean-looking result. (Previously every LLM failure was swallowed
  // as [] by the detectors; proven live in audit run 3 when 68 of 90
  // calls failed and the output still read as a clean scan.)
  const llmCoverage = llmCoverageSince(llmSnap);
  result.llmCoverage = llmCoverage;
  if (llmCoverage.failed > 0) {
    logger.error(
      {
        attempted: llmCoverage.attempted,
        failed: llmCoverage.failed,
        byReason: llmCoverage.byReason,
        byCaller: llmCoverage.byCaller,
      },
      "detection coverage degraded: LLM call(s) failed — result is NOT a clean scan",
    );
    result.errors.push({
      message: `Detection coverage degraded: ${llmCoverage.failed} of ${llmCoverage.attempted} LLM detection call(s) failed — findings are incomplete and "0 findings" must not be read as clean`,
      details: {
        byReason: llmCoverage.byReason,
        byCaller: llmCoverage.byCaller,
      },
    });
  }

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
    result.automationReady,
    llmCoverage.failed
  );

  return finalize(finalStatus);
}
