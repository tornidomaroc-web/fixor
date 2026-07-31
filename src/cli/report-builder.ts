import { relative } from "node:path";

import type { Finding } from "../analysis-engine/types.js";

export interface FileScanResult {
  filePath: string;
  findings: Finding[];
  /** LLM detection calls that failed while scanning this file. > 0 means
   *  the file was NOT fully analyzed — absence of findings for it is
   *  meaningless. Populated by scan.ts from per-file coverage deltas. */
  llmFailures?: number;
  /** Failure-reason breakdown for this file (e.g. { http_error: 2 }). */
  llmFailuresByReason?: Record<string, number>;
  /** Set when the file's analysis aborted before any detector could run:
   *  the read failed, the synthetic diff could not be built, or the route
   *  guard could not be resolved. The file contributed NOTHING; it was not
   *  analyzed and found clean. `stage` names where it died so an operator
   *  can tell a permissions problem from a bug. */
  notAnalyzed?: { stage: string; reason: string };
  /** Detectors that threw while analyzing this file. Each entry is one
   *  detector that contributed zero findings for a reason unrelated to the
   *  code under scan, so its silence carries no information. */
  detectorFailures?: Array<{ detectorId: string; reason: string }>;
}

/** Scan-wide detection-coverage summary, from the llm-coverage tally. */
export interface ScanCoverage {
  attempted: number;
  failed: number;
  byReason: Record<string, number>;
}

export interface ReportOptions {
  /** When true, omit the per-finding "Suggested fix" line and add a header
   *  note that automated remediation is out of scope. Used for artifacts
   *  scoped to DETECTION (e.g. the public proof corpus) where the
   *  remediation field is not part of what is being demonstrated. Product
   *  default is false (the field renders as before). */
  omitSuggestedFix?: boolean;
  /** When present, the report states its own coverage explicitly: a full
   *  run renders a positive "full coverage" line; any failed call renders
   *  a degraded-coverage banner plus a "Coverage gaps" section. A clean
   *  report and a blind report must never look the same. */
  coverage?: ScanCoverage;
}

/**
 * Every way this scan's coverage can be degraded, as one count.
 *
 * Three independent channels, deliberately NOT merged into the llm-coverage
 * tally: that tally means "detection calls attempted/failed" and is read by
 * the SARIF invocation record and by spend measurement, so an unreadable file
 * must never be laundered into it as a failed API call. They share a verdict,
 * not a counter.
 *
 *   1. an LLM detection call failed          (llm-coverage.ts)
 *   2. a file's analysis aborted             (FileScanResult.notAnalyzed)
 *   3. a detector threw                      (FileScanResult.detectorFailures)
 *
 * Any non-zero total means "0 findings" is not a clean result. Used for both
 * the report banner and the CLI exit code so the two can never disagree.
 */
export function countCoverageDegradations(
  results: FileScanResult[],
  coverage?: ScanCoverage,
): number {
  let n = coverage?.failed ?? 0;
  for (const r of results) {
    if (r.notAnalyzed) n++;
    n += r.detectorFailures?.length ?? 0;
  }
  return n;
}

/** True when this file cannot be read as "analyzed and found clean". */
function hasCoverageGap(r: FileScanResult): boolean {
  return (
    (r.llmFailures ?? 0) > 0 ||
    r.notAnalyzed !== undefined ||
    (r.detectorFailures?.length ?? 0) > 0
  );
}

export function buildMarkdownReport(
  scannedPath: string,
  results: FileScanResult[],
  opts: ReportOptions = {},
): string {
  const allFindings = results.flatMap((r) => r.findings);
  const sev = severityBreakdown(allFindings);
  const filesWithFindings = results.filter((r) => r.findings.length > 0);

  const lines: string[] = [];
  lines.push(`# Fixor local scan report`);
  lines.push("");
  const cov = opts.coverage;
  const notAnalyzed = results.filter((r) => r.notAnalyzed);
  const detectorFailures = results.flatMap((r) =>
    (r.detectorFailures ?? []).map((d) => ({ filePath: r.filePath, ...d })),
  );
  const llmFailed = cov?.failed ?? 0;
  // Any channel degrades the whole scan. Previously only channel 1 could,
  // so a run that read no files at all still rendered the positive
  // "full coverage" line — an affirmative false assurance, not a silence.
  const degraded =
    llmFailed > 0 || notAnalyzed.length > 0 || detectorFailures.length > 0;
  // Nothing was analyzed at all: strictly worse than a partial gap.
  const nothingAnalyzed =
    results.length > 0 && notAnalyzed.length === results.length;

  if (degraded) {
    const parts: string[] = [];
    if (llmFailed > 0 && cov) {
      parts.push(
        `${llmFailed} of ${cov.attempted} LLM detection calls failed (${formatReasons(cov.byReason)})`,
      );
    }
    if (notAnalyzed.length > 0) {
      parts.push(
        `${notAnalyzed.length} of ${results.length} file(s) were never analyzed`,
      );
    }
    if (detectorFailures.length > 0) {
      parts.push(`${detectorFailures.length} detector run(s) failed`);
    }
    const summary = parts.join("; ");
    if (nothingAnalyzed) {
      lines.push(
        `> 🛑 **SCAN BLIND — NO FILE WAS ANALYZED** (${summary}).`,
        `> This report contains NO results and MUST NOT be used as evidence of a clean codebase.`,
        `> Fix the cause (file permissions, deleted or locked files) and re-run.`,
      );
    } else if (cov && llmFailed > 0 && llmFailed >= cov.attempted) {
      lines.push(
        `> 🛑 **SCAN BLIND — ALL ${cov.attempted} LLM detection calls failed** (${formatReasons(cov.byReason)}).`,
        `> This report contains NO LLM-verified results and MUST NOT be used as evidence of a clean codebase.`,
        `> Fix the cause (API key, network, rate limits) and re-run.`,
      );
    } else {
      lines.push(
        `> ⚠️ **DEGRADED COVERAGE — NOT A CLEAN SCAN.** ${summary}.`,
        `> Files under "Coverage gaps" below were NOT fully analyzed; absence of findings there is meaningless.`,
        `> Findings that ARE listed remain real. Fix the cause and re-run for full coverage.`,
      );
    }
    lines.push("");
  }
  if (opts.omitSuggestedFix) {
    lines.push(
      `> This report is scoped to detection. Automated remediation is out of scope and not shown.`,
    );
    lines.push("");
  }
  lines.push(`- Scanned path: \`${displayPath(scannedPath)}\``);
  // "Total files scanned" counted files the scan never opened, because the
  // per-file result is recorded whether or not the analysis got anywhere.
  // Enumerated and analyzed are different facts and are now reported as two.
  lines.push(`- Total files enumerated: ${results.length}`);
  lines.push(
    `- Files fully analyzed: ${results.length - notAnalyzed.length} of ${results.length}`,
  );
  lines.push(`- Files with findings: ${filesWithFindings.length}`);
  lines.push(`- Total findings: ${allFindings.length}`);
  lines.push(
    `- Severity breakdown: critical=${sev.critical}, high=${sev.high}, medium=${sev.medium}`,
  );
  if (cov) {
    lines.push(
      cov.failed > 0
        ? `- LLM detection coverage: **DEGRADED** — ${cov.failed} of ${cov.attempted} calls failed (${formatReasons(cov.byReason)})`
        : degraded
          ? `- LLM detection coverage: ${cov.attempted}/${cov.attempted} calls succeeded, but scan coverage is **DEGRADED** (see Coverage gaps)`
          : `- LLM detection coverage: full — ${cov.attempted}/${cov.attempted} calls succeeded`,
    );
  }
  if (notAnalyzed.length > 0) {
    lines.push(`- Files NOT analyzed: ${notAnalyzed.length}`);
  }
  if (detectorFailures.length > 0) {
    lines.push(`- Detector runs that failed: ${detectorFailures.length}`);
  }
  lines.push("");

  const gapFiles = results.filter(hasCoverageGap);
  if (gapFiles.length > 0) {
    lines.push(`## Coverage gaps (NOT fully analyzed)`);
    lines.push("");
    lines.push(
      `The following files were not fully analyzed. "No findings" for these files is a coverage gap, not a clean result. Each casualty is listed by name.`,
    );
    lines.push("");
    for (const r of gapFiles) {
      const name = fwdSlash(r.filePath);
      if (r.notAnalyzed) {
        lines.push(
          `- \`${name}\` — NOT ANALYZED (aborted at ${r.notAnalyzed.stage}): ${r.notAnalyzed.reason}`,
        );
        // A file that never reached the detectors has no per-detector or
        // per-call casualties to list; naming it once is the whole fact.
        continue;
      }
      if ((r.llmFailures ?? 0) > 0) {
        const reasons = r.llmFailuresByReason
          ? ` (${formatReasons(r.llmFailuresByReason)})`
          : "";
        lines.push(
          `- \`${name}\` — ${r.llmFailures} failed call(s)${reasons}`,
        );
      }
      for (const d of r.detectorFailures ?? []) {
        lines.push(
          `- \`${name}\` — detector \`${d.detectorId}\` failed: ${d.reason}`,
        );
      }
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  for (const file of filesWithFindings) {
    lines.push(`## ${fwdSlash(file.filePath)}`);
    lines.push("");
    for (const f of file.findings) {
      lines.push(`### ${f.type} — ${f.severity} (confidence: ${f.confidence})`);
      lines.push("");
      lines.push(`- File: \`${fwdSlash(f.file)}\`:${f.line}`);
      lines.push(`- Description: ${f.explanation}`);
      // "Why it matters" is rendered only when it adds something beyond the
      // description. Several detectors set both fields to the same verdict
      // reasoning; rendering identical text twice reads as templated filler.
      if (f.why_it_matters && f.why_it_matters.trim() !== f.explanation.trim()) {
        lines.push(`- Why it matters: ${f.why_it_matters}`);
      }
      if (!opts.omitSuggestedFix) {
        lines.push(`- Suggested fix: ${f.suggested_fix}`);
      }
      lines.push("");
      lines.push("```");
      lines.push(snippetWithContext(f.original_snippet));
      lines.push("```");
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

function formatReasons(byReason: Record<string, number>): string {
  const parts = Object.entries(byReason).map(([r, n]) => `${r}: ${n}`);
  return parts.length > 0 ? parts.join(", ") : "no breakdown available";
}

function severityBreakdown(findings: Finding[]): {
  critical: number;
  high: number;
  medium: number;
} {
  const out = { critical: 0, high: 0, medium: 0 };
  for (const f of findings) {
    if (f.severity === "critical") out.critical++;
    else if (f.severity === "high") out.high++;
    else if (f.severity === "medium") out.medium++;
  }
  return out;
}

/** Normalize Windows backslash paths to forward slashes for display. The
 *  scanner runs cross-platform; a published artifact should not leak the
 *  host OS through `app\routers\admin.py`-style paths. */
function fwdSlash(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Render the scanned path as a repo-relative path so a published report
 *  never leaks an absolute host path (e.g. a user's home/drive layout, which
 *  is both a privacy leak and a "ran on a laptop, not reproducible" tell).
 *  Falls back to the forward-slashed basename if the target is outside cwd. */
function displayPath(p: string): string {
  const rel = relative(process.cwd(), p);
  if (!rel || rel.startsWith("..") || /^[A-Za-z]:/.test(rel)) {
    const parts = fwdSlash(p).split("/").filter(Boolean);
    return parts.slice(-2).join("/");
  }
  return fwdSlash(rel);
}

function snippetWithContext(snippet: string): string {
  const lines = snippet.split(/\r?\n/);
  while (lines.length > 0 && (lines[0] ?? "").trim() === "") lines.shift();
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") {
    lines.pop();
  }
  // Cap matches extractReportSnippet's 10-line evidence budget (the producer
  // side in detectors/shared/route-def-pattern.ts) so report rendering never
  // silently truncates the snippet the detector chose to show.
  return lines.slice(0, 10).join("\n");
}
