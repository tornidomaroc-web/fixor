import { relative } from "node:path";

import type { Finding } from "../analysis-engine/types.js";

export interface FileScanResult {
  filePath: string;
  findings: Finding[];
}

export interface ReportOptions {
  /** When true, omit the per-finding "Suggested fix" line and add a header
   *  note that automated remediation is out of scope. Used for artifacts
   *  scoped to DETECTION (e.g. the public proof corpus) where the
   *  remediation field is not part of what is being demonstrated. Product
   *  default is false (the field renders as before). */
  omitSuggestedFix?: boolean;
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
  if (opts.omitSuggestedFix) {
    lines.push(
      `> This report is scoped to detection. Automated remediation is out of scope and not shown.`,
    );
    lines.push("");
  }
  lines.push(`- Scanned path: \`${displayPath(scannedPath)}\``);
  lines.push(`- Total files scanned: ${results.length}`);
  lines.push(`- Files with findings: ${filesWithFindings.length}`);
  lines.push(`- Total findings: ${allFindings.length}`);
  lines.push(
    `- Severity breakdown: critical=${sev.critical}, high=${sev.high}, medium=${sev.medium}`,
  );
  lines.push("");

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
