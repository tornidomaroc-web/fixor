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

  const autoEmoji = workflow.automationReady ? "✅" : "⛔";

  const lines: string[] = [
    "## 🛡️ Fixor Security Report",
    "",
    `**Repository:** \`${repoSlug}\` · **PR:** #${metadata.pullNumber}`,
  ];
  if (scanBits) {
    lines.push(scanBits);
  }
  lines.push(
    "",
    "### Summary",
    "",
    "| | |",
    "|-|-|",
    `| **Workflow status** | \`${workflow.status}\` |`,
    `| **Automation ready** | ${autoEmoji} \`${workflow.automationReady}\` |`,
    `| **Automation note** | ${cell(workflow.automationDecisionReason)} |`,
    `| **Findings scanned** | ${workflow.totalFindings} |`,
    `| **Vulnerabilities classified** | ${workflow.classifiedFindings} |`,
    `| **Fixes generated** | ${workflow.fixesGenerated} |`,
    `| **Patch quality** | high: ${workflow.highQualityPatches} · medium: ${workflow.mediumQualityPatches} · low: ${workflow.lowQualityPatches} |`,
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
    lines.push("_No vulnerability fixes produced in this run._", "");
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
    "### Suggested fixes",
    "",
    `_Expand a row for **original → suggested** code, warnings, and explanation._`
  );
  if (omitted > 0) {
    lines.push(
      `_Showing **${detailedList.length}** of **${list.length}** fixes with full detail._`
    );
  }
  lines.push("");

  detailedList.forEach((fix, i) => {
    const globalNum = list.indexOf(fix) + 1;
    const family = metadataFor(fix.findingType).name;
    const title = `${globalNum}. \`${fix.file}:${fix.line}\` · **${fix.patchQuality}** · \`${family}\``;
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
    lines.push("**Original**", "", fencedCodeBlock(truncate(fix.originalCode, 4000)), "");
    lines.push("**Suggested**", "", fencedCodeBlock(truncate(fix.fixedCode, 4000)), "");
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
      lines.push("**Patch warnings**", "");
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
      `> **…and ${omitted} more fix(es) omitted for brevity.**`,
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
