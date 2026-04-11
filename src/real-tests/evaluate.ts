import * as path from "path";
import type { NormalizedSqlInjectionFinding } from "../types/vulnerability.types";
import type { SqlInjectionFixSuggestion } from "../types/vulnerability.types";
import type { GroundTruth, Hotspot } from "./cases";

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function pathMatches(findingFile: string, relativePath: string): boolean {
  const n = normalizePath(findingFile);
  const r = normalizePath(relativePath);
  return n === r || n.endsWith("/" + r);
}

/** Map Semgrep paths to repo-relative for hotspot checks. */
export function toRepoRelativePath(
  findingFile: string,
  repoRootAbs: string
): string {
  const norm = findingFile.replace(/\\/g, "/");
  if (!path.isAbsolute(findingFile)) {
    return norm;
  }
  const abs = path.resolve(findingFile);
  const root = path.resolve(repoRootAbs);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..")) {
    return norm;
  }
  return rel.replace(/\\/g, "/");
}

export function matchesHotspot(
  file: string,
  line: number,
  hotspot: Hotspot,
  repoRootAbs: string
): boolean {
  const rel = toRepoRelativePath(file, repoRootAbs);
  return pathMatches(rel, hotspot.relativePath) && line === hotspot.line;
}

export function isTruePositive(
  vuln: NormalizedSqlInjectionFinding,
  gt: GroundTruth,
  repoRootAbs: string
): boolean {
  return gt.vulnerableHotspots.some((h) =>
    matchesHotspot(vuln.file, vuln.startLine, h, repoRootAbs)
  );
}

/**
 * Basic 0–100 heuristic: placeholders, bound values, confidence; penalize obvious remaining concatenation in fix text.
 */
export function fixQualityHeuristic(fix: SqlInjectionFixSuggestion): number {
  let s = 45;
  const code = fix.fixedCode;
  if (/\?|\$[1-9]\d*/.test(code)) s += 28;
  if (fix.parameterValues.length > 0) s += 12;
  if (fix.patchQuality === "high") s += 12;
  else if (fix.patchQuality === "medium") s += 6;
  if (fix.confidence === "high") s += 10;
  else if (fix.confidence === "medium") s += 5;
  if (
    /['"]\s*\+\s*[^+]+\s*\+\s*['"]/.test(code) &&
    /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/i.test(code)
  ) {
    s -= 35;
  }
  if (/\$\{[^}]+\}/.test(code) && /\bSELECT\b/i.test(code)) s -= 25;
  return Math.max(0, Math.min(100, Math.round(s)));
}

export function averageFixQuality(fixes: SqlInjectionFixSuggestion[]): number {
  if (fixes.length === 0) return 0;
  const sum = fixes.reduce((a, f) => a + fixQualityHeuristic(f), 0);
  return Math.round(sum / fixes.length);
}

export function countMetrics(
  findings: NormalizedSqlInjectionFinding[],
  gt: GroundTruth,
  repoRootAbs: string
): { truePositives: number; falsePositives: number } {
  let tp = 0;
  let fp = 0;
  for (const v of findings) {
    if (isTruePositive(v, gt, repoRootAbs)) tp++;
    else fp++;
  }
  return { truePositives: tp, falsePositives: fp };
}
