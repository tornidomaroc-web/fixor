import { runAuditorWorkflow } from "./auditor-workflow.js";
import type { BatchInput, BatchReport } from "../types/workflow.types.js";

/**
 * Executes the Auditor AI workflow on a list of inputs in sequence.
 * Aggregates the results into a high-level summary report.
 */
export async function runBatchAuditorWorkflow(
  inputs: BatchInput[],
  timeoutMsPerItem = 30000
): Promise<BatchReport> {
  const report: BatchReport = {
    totalRepos: inputs.length,
    totalFindings: 0,
    totalFixes: 0,
    avgFixesPerRepo: 0,
    highQualityPatches: 0,
    mediumQualityPatches: 0,
    lowQualityPatches: 0,
    automationReadyRepos: 0,
    reposNeedingReview: 0,
    automationBlockReasons: {
      lowQuality: 0,
      warnings: 0,
      failedStatus: 0
    },
    warningSummaries: {},
    repoReports: [],
  };

  console.log(`[Batch] Starting batch execution for ${inputs.length} inputs.`);

  for (const input of inputs) {
    const repoName = input.metadata.repoName || 'unknown-repo';
    console.log(`\n======================================================`);
    console.log(`[Batch] Executing workflow for repo: ${repoName}`);
    console.log(`======================================================`);

    const result = await runAuditorWorkflow(input.semgrepPayload, input.metadata, timeoutMsPerItem);
    
    // Log per-repo results briefly
    console.log(`[Batch] Repo ${repoName} completed with status: ${result.status}`);
    console.log(`[Batch] Contributed ${result.totalFindings} findings / ${result.fixesGenerated} fixes.`);

    // Aggregate metrics
    report.totalFindings += result.totalFindings;
    report.totalFixes += result.fixesGenerated;
    report.highQualityPatches += result.highQualityPatches;
    report.mediumQualityPatches += result.mediumQualityPatches;
    report.lowQualityPatches += result.lowQualityPatches;

    let hasWarnings = false;
    for (const fix of result.fixes) {
      if (fix.patchWarnings && fix.patchWarnings.length > 0) {
        hasWarnings = true;
        for (const warning of fix.patchWarnings) {
          report.warningSummaries[warning] = (report.warningSummaries[warning] || 0) + 1;
        }
      } else if (fix.patchQuality === "low") {
        const w = "Low patch quality (fallback or uncertain rewrite)";
        report.warningSummaries[w] = (report.warningSummaries[w] || 0) + 1;
      }
    }

    if (result.automationReady) {
      report.automationReadyRepos++;
    } else {
      report.reposNeedingReview++;
      
      if (result.lowQualityPatches > 0) report.automationBlockReasons.lowQuality++;
      if (hasWarnings) report.automationBlockReasons.warnings++;
      if (result.status === "failed") report.automationBlockReasons.failedStatus++;
    }

    report.repoReports.push(result);
  }

  if (report.totalRepos > 0) {
    report.avgFixesPerRepo = Number((report.totalFixes / report.totalRepos).toFixed(2));
  }

  console.log(`\n======================================================`);
  console.log(`[Batch] Batch execution completed.`);
  console.log(`[Batch] Total Repos scanned: ${report.totalRepos}`);
  console.log(`[Batch] Total Findings globally: ${report.totalFindings}`);
  console.log(`[Batch] Total Fixes generated: ${report.totalFixes}`);
  console.log(`[Batch] Avg Fixes per Repo: ${report.avgFixesPerRepo}`);
  console.log(`[Batch] Automation Ready Repos: ${report.automationReadyRepos}`);
  console.log(`[Batch] Repos Needing Review: ${report.reposNeedingReview}`);
  console.log(`[Batch]   -> Blocked by Low Quality patches: ${report.automationBlockReasons.lowQuality}`);
  console.log(`[Batch]   -> Blocked by Patch Warnings: ${report.automationBlockReasons.warnings}`);
  console.log(`[Batch]   -> Blocked by Failed Status: ${report.automationBlockReasons.failedStatus}`);
  console.log(`[Batch] Low-Quality Patches: ${report.lowQualityPatches}`);
  
  if (Object.keys(report.warningSummaries).length > 0) {
    console.log(`[Batch] Warning Summaries:`, report.warningSummaries);
  }
  console.log(`======================================================\n`);

  return report;
}
