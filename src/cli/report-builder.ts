import type { Finding } from "../analysis-engine/types.js";

export interface FileScanResult {
  filePath: string;
  findings: Finding[];
}

export function buildMarkdownReport(
  scannedPath: string,
  results: FileScanResult[],
): string {
  const allFindings = results.flatMap((r) => r.findings);
  const sev = severityBreakdown(allFindings);
  const filesWithFindings = results.filter((r) => r.findings.length > 0);

  const lines: string[] = [];
  lines.push(`# Fixor local scan report`);
  lines.push("");
  lines.push(`- Scanned path: \`${scannedPath}\``);
  lines.push(`- Total files scanned: ${results.length}`);
  lines.push(`- Files with findings: ${filesWithFindings.length}`);
  lines.push(`- Total findings: ${allFindings.length}`);
  lines.push(
    `- Severity breakdown: critical=${sev.critical}, high=${sev.high}, medium=${sev.medium}`,
  );
  lines.push("");

  for (const file of filesWithFindings) {
    lines.push(`## ${file.filePath}`);
    lines.push("");
    for (const f of file.findings) {
      lines.push(`### ${f.type} — ${f.severity} (confidence: ${f.confidence})`);
      lines.push("");
      lines.push(`- File: \`${f.file}\`:${f.line}`);
      lines.push(`- Description: ${f.explanation}`);
      lines.push(`- Why it matters: ${f.why_it_matters}`);
      lines.push(`- Suggested fix: ${f.suggested_fix}`);
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

function snippetWithContext(snippet: string): string {
  const lines = snippet.split(/\r?\n/);
  return lines.slice(0, 3).join("\n");
}
