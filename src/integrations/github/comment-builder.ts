import { FIXOR_PR_COMMENT_MARKER } from "./comment-constants";
import type { GitHubRepoMetadata } from "./github-types";
import type { WorkflowResult } from "../../types/workflow.types";
import type { SqlInjectionExploit } from "../../services/risk-explainer";
import type { NormalizedFixSuggestion } from "../../analysis-engine/detector.types";
import { metadataFor } from "../../config/vulnerability-registry";

/** Maximum number of fixes rendered with full `<details>` (remainder summarized). */
export const DEFAULT_MAX_DETAILED_FIXES = 10;

export type BuildCommentOptions = {
  maxDetailedFixes?: number;
  /** SQL risk explanations keyed by the fix's `findingId`. */
  exploits?: Record<string, SqlInjectionExploit>;
};

/** Longest run of backticks in `s` plus one, for valid nested fences. */
function closingFenceLength(code: string): number {
  let max = 0;
  let run = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "`") {
      run++;
      max = Math.max(max, run);
    } else {
      run = 0;
    }
  }
  return Math.max(3, max + 1);
}

function fencedCodeBlock(code: string): string {
  const body = code.replace(/\r\n/g, "\n").trimEnd();
  const n = closingFenceLength(body);
  const fence = "`".repeat(n);
  return `${fence}text\n${body}\n${fence}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/** Avoid breaking GFM tables when text contains `|`. */
function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function severityEmoji(severity: SqlInjectionExploit["severity"]): string {
  if (severity === "critical") return "🔴";
  if (severity === "high") return "🟠";
  return "🟡";
}

/**
 * One aggregated markdown body for a pull request issue comment.
 */
export function buildPullRequestCommentMarkdown(
  metadata: GitHubRepoMetadata,
  workflow: WorkflowResult,
  fixes?: NormalizedFixSuggestion[],
  options?: BuildCommentOptions
): string {
  const maxDetailed =
    options?.maxDetailedFixes ?? DEFAULT_MAX_DETAILED_FIXES;
  const list = fixes ?? workflow.fixes;
  const repoSlug = `${metadata.owner}/${metadata.repo}`;
  const scanBits = [
    metadata.scanId ? `**Scan ID:** \`${metadata.scanId}\`` : null,
    metadata.commitSha ? `**Commit:** \`${truncate(metadata.commitSha, 40)}\`` : null,
    workflow.metadata?.scanId && workflow.metadata.scanId !== metadata.scanId
      ? `**Workflow scan:** \`${workflow.metadata.scanId}\``
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const lines: string[] = [
    "## 🛡️ Fixor Security Report",
    "",
    `**Repository:** \`${repoSlug}\` · **PR:** #${metadata.pullNumber}`,
  ];
  if (scanBits) {
    lines.push(scanBits);
  }
  if (workflow.status === "budget_exceeded" && workflow.budget) {
    const b = workflow.budget;
    const reasonText =
      b.reason === "monthly_exceeded"
        ? `$${b.monthlyCapUsd.toFixed(2)} monthly cap (spent $${b.monthlySpend.toFixed(2)} this month)`
        : `$${b.dailyCapUsd.toFixed(2)} daily cap (spent $${b.dailySpend.toFixed(2)} today)`;
    lines.push(
      "",
      "> ⏸️ **Fixor scan paused - budget reached**",
      ">",
      `> This installation has hit its ${reasonText}.`,
      "> Scans resume automatically next " +
        (b.reason === "monthly_exceeded" ? "month" : "day") +
        ".",
      "> To raise the cap or get instant resume, contact the Fixor admin or set" +
        " `FIXOR_MONTHLY_CAP_USD` / `FIXOR_DAILY_CAP_USD`.",
      "",
      FIXOR_PR_COMMENT_MARKER,
      `<sub>🔒 Analyzed by [Fixor](https://github.com/tornidomaroc-web/fixor) · ${workflow.timing.finishedAt || "—"}</sub>`
    );
    return lines.join("\n");
  }

  // 5E-5 soft nudge — rendered ABOVE the summary so it's the first
  // thing the reader sees, before they scroll into the findings.
  // Suppressed when the hard `budget_exceeded` block above already
  // owns the page (the early return makes that path exclusive).
  if (workflow.budgetWarning) {
    const w = workflow.budgetWarning;
    const pct = Math.round(w.ratio * 100);
    lines.push(
      "",
      `> ⚠️ **Heads-up — Fixor is at ${pct}% of this month's budget** ($${w.monthlySpend.toFixed(2)} of $${w.monthlyCapUsd.toFixed(2)}). New scans pause when the budget is fully spent until next month's reset.`,
    );
  }

  lines.push(
    "",
    "### Summary",
    "",
    "| | |",
    "|-|-|",
    `| **Workflow status** | \`${workflow.status}\` |`,
    `| **Findings scanned** | ${workflow.totalFindings} |`,
    `| **Vulnerabilities classified** | ${workflow.classifiedFindings} |`,
    `| **Findings reported** | ${workflow.fixesGenerated} |`,
    `| **Duration** | ${workflow.timing.durationMs} ms |`,
    ""
  );

  if (workflow.errors.length > 0) {
    lines.push("### Workflow errors", "");
    for (const e of workflow.errors.slice(0, 5)) {
      const id = e.findingId ? ` (\`${e.findingId}\`)` : "";
      lines.push(`- **${e.message}**${id}`);
    }
    if (workflow.errors.length > 5) {
      lines.push(`- _…and ${workflow.errors.length - 5} more_`);
    }
    lines.push("");
  }

  const pdfUrl = workflow.pdfUrl;
  const sarifUrl = workflow.sarifUrl;

  const renderDownloadsBlock = (): string[] => {
    if (!pdfUrl && !sarifUrl) return [];
    const block: string[] = ["", "---", "", "### 📥 Downloads", ""];
    if (pdfUrl) {
      block.push(`- [📄 **PDF report**](${pdfUrl}) — human-readable, sharable`);
    }
    if (sarifUrl) {
      block.push(
        `- [🧾 **SARIF 2.1.0 log**](${sarifUrl}) — feed into GitHub Code Scanning, IDE viewers, or security triage pipelines`
      );
    }
    block.push("");
    return block;
  };

  if (list.length === 0) {
    lines.push("_No findings in this run — no business-logic vulnerabilities detected._", "");
    lines.push(...renderDownloadsBlock());
    lines.push(
      FIXOR_PR_COMMENT_MARKER,
      `<sub>🔒 Analyzed by [Fixor](https://github.com/tornidomaroc-web/fixor) · ${workflow.timing.finishedAt || "—"}</sub>`
    );
    return lines.join("\n");
  }

  const omitted = Math.max(0, list.length - maxDetailed);
  const detailedList = list.slice(0, maxDetailed);

  lines.push(
    "### Findings",
    "",
    `_Expand a row for the affected code, detection confidence, and remediation guidance._`
  );
  if (omitted > 0) {
    lines.push(
      `_Showing **${detailedList.length}** of **${list.length}** findings with full detail._`
    );
  }
  lines.push("");

  detailedList.forEach((fix, i) => {
    const globalNum = list.indexOf(fix) + 1;
    const family = metadataFor(fix.findingType).name;
    const title = `${globalNum}. \`${fix.file}:${fix.line}\` · **${fix.confidence}** confidence · \`${family}\``;
    lines.push(`<details>`, `<summary><strong>${title}</strong></summary>`, "");
    const meta = fix.metadata;
    if (meta?.type === "sql_injection_risk") {
      lines.push(
        `- **Dialect:** \`${meta.dialect ?? "mysql"}\` · **Detection confidence:** \`${fix.confidence}\``
      );
      if ((meta.parameterValues ?? []).length > 0) {
        lines.push(
          `- **Parameter expressions:** \`${(meta.parameterValues ?? []).join("`, `")}\``
        );
      }
    } else {
      lines.push(`- **Detection confidence:** \`${fix.confidence}\``);
    }
    lines.push("");
    lines.push("**Affected code**", "", fencedCodeBlock(truncate(fix.originalCode, 4000)), "");
    if (fix.fixedCode.trim() !== fix.originalCode.trim()) {
      lines.push("**Suggested fix**", "", fencedCodeBlock(truncate(fix.fixedCode, 4000)), "");
    }
    const exploit = options?.exploits?.[fix.findingId];
    if (exploit) {
      const sev = severityEmoji(exploit.severity);
      const impactCell = cell(exploit.impact);
      lines.push(
        "",
        "**🛡️ Risk assessment**",
        "",
        "| | |",
        "|-|-|",
        `| **Severity** | ${sev} \`${exploit.severity}\` |`,
        `| **Potential impact** | ${impactCell} |`,
        "",
        "<details>",
        "<summary>Why this matters</summary>",
        "",
        exploit.attackDescription,
        "",
        "</details>",
        ""
      );
    }
    if (fix.patchWarnings.length > 0) {
      lines.push("**Remediation notes**", "");
      for (const w of fix.patchWarnings) {
        lines.push(`- ${w}`);
      }
      lines.push("");
    }
    lines.push("**Explanation**", "", fix.explanation, "");
    lines.push("", `</details>`, "");
  });

  if (omitted > 0) {
    lines.push(
      "",
      `> **…and ${omitted} more finding(s) omitted for brevity.**`,
      ""
    );
  }

  lines.push(...renderDownloadsBlock());
  lines.push(
    FIXOR_PR_COMMENT_MARKER,
    `<sub>🔒 Analyzed by [Fixor](https://github.com/tornidomaroc-web/fixor) · ${workflow.timing.finishedAt || "—"}</sub>`
  );

  return lines.join("\n");
}
