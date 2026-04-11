import type { NormalizedSqlInjectionFinding } from "../types/vulnerability.types";

type GitHubPrFile = { filename: string; status: string; patch?: string };

const RE_SQL_KW =
  /\b(SELECT|INSERT|UPDATE|DELETE|WHERE|FROM|INTO)\b/i;
const RE_SQL_VULN =
  /['"]\s*\+\s*\w+|\w+\s*\+\s*['"]|\$\{[^}]+\}/;

const HUNK_HEADER_RE =
  /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Fetch all files for a PR (handles GitHub pagination, 100 per page).
 */
async function fetchPrFiles(
  owner: string,
  repo: string,
  pullNumber: number,
  token: string
): Promise<GitHubPrFile[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
  const out: GitHubPrFile[] = [];
  let page = 1;
  for (;;) {
    const url = `https://api.github.com/repos/${encodeURIComponent(
      owner
    )}/${encodeURIComponent(repo)}/pulls/${pullNumber}/files?per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `GitHub pulls/files failed: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`
      );
    }
    const batch = (await res.json()) as GitHubPrFile[];
    out.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return out;
}

function parsePatchForSqli(
  filename: string,
  patch: string
): NormalizedSqlInjectionFinding[] {
  const findings: NormalizedSqlInjectionFinding[] = [];
  let newLine = 0;

  for (const rawLine of patch.split("\n")) {
    const hunk = rawLine.match(HUNK_HEADER_RE);
    if (hunk) {
      newLine = Number.parseInt(hunk[3], 10);
      continue;
    }
    if (rawLine.startsWith("diff --git ") || rawLine.startsWith("index ")) {
      continue;
    }
    if (
      rawLine.startsWith("--- ") ||
      rawLine.startsWith("+++ ") ||
      rawLine.startsWith("@@")
    ) {
      continue;
    }
    if (rawLine.length === 0) continue;

    const first = rawLine[0];
    if (first === "+") {
      if (rawLine.startsWith("+++")) continue;
      const content = rawLine.slice(1);
      if (RE_SQL_KW.test(content) && RE_SQL_VULN.test(content)) {
        findings.push({
          type: "SQL_INJECTION",
          file: filename,
          startLine: newLine,
          endLine: newLine,
          ruleId: "pr-diff-sqli-heuristic",
          message: "Potential SQL injection in added code",
          originalCode: content,
          explanation:
            "Added line contains SQL keyword with string concatenation or template literal",
          classificationConfidence: "medium",
          classificationScore: 20,
        });
      }
      newLine += 1;
    } else if (first === "-") {
      if (rawLine.startsWith("---")) continue;
      // removed line: old side only
    } else if (first === " " || first === "\t") {
      newLine += 1;
    } else if (first === "\\") {
      // e.g. "\ No newline at end of file"
      continue;
    }
  }

  return findings;
}

export async function analyzePrDiff(
  owner: string,
  repo: string,
  pullNumber: number,
  token: string
): Promise<NormalizedSqlInjectionFinding[]> {
  const files = await fetchPrFiles(owner, repo, pullNumber, token);
  const seen = new Set<string>();
  const results: NormalizedSqlInjectionFinding[] = [];

  for (const f of files) {
    if (f.status === "removed" || f.patch === undefined || f.patch.length === 0) {
      continue;
    }
    for (const finding of parsePatchForSqli(f.filename, f.patch)) {
      const key = `${finding.file}:${finding.startLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(finding);
    }
  }

  return results;
}
