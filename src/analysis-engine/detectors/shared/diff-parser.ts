/**
 * Shared unified-diff parser for all detectors.
 *
 * Replaces six byte-identical per-detector `parseDiff` copies (G7) and
 * fixes the live production defect (G1/H1): the old parser collected
 * added (+) lines but numbered them against the CONCATENATED added-line
 * text, ignoring `@@ -a,b +c,d` hunk offsets. The CLI was immune (its
 * synthetic diffs are one new-file hunk starting at +1, where content
 * numbering and file numbering coincide), but the webhook path feeds
 * genuine multi-hunk PR diffs — so every production finding's line
 * number, PR-comment anchor, SARIF region, and `file:line:type` dedupe
 * key was wrong on real PRs.
 *
 * Contract (load-bearing for the measured baselines):
 *   - `content` is the SAME concatenated added-lines text the old
 *     parser produced, byte for byte. Prefilters, context windows,
 *     prompts, and snippets all keep operating on it unchanged — no
 *     judgment input shifts, so no detector baseline shifts.
 *   - `lineMap[i]` is the 1-indexed TARGET-FILE line number of content
 *     line i+1, derived from the hunk headers. Detectors translate
 *     finding line numbers through it at emit time
 *     (`remapFindingLines`). For the CLI's synthetic whole-file diffs
 *     (`@@ -0,0 +1,N @@`, every line added) the map is the identity,
 *     which is exactly why the synthetic path stays byte-identical.
 *
 * Scope boundary (H1 vs H2): this fixes WHERE findings point for what
 * is scanned (added lines). It does NOT give detectors visibility into
 * unchanged context lines on real PR diffs — that is H2 (whole-file
 * fetch for changed paths), a separate product decision about scanning
 * code the PR did not touch.
 */

import type { NormalizedFinding } from "../../detector.types";

export interface DiffFile {
  path: string;
  /** Concatenated added-line text — one line per added line, in order. */
  content: string;
  /**
   * lineMap[i] = 1-indexed target-file line number of content line
   * i+1. Always the same length as content's line count.
   */
  lineMap: number[];
}

const HUNK_HEADER_RE = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/;

/**
 * Parse a unified diff into per-file added-line content plus a real
 * file line map.
 *
 * Behavior preserved from the legacy per-detector parser:
 *   - files split on `^diff --git `
 *   - path read from `+++ b/<path>` (deleted files have `+++ /dev/null`
 *     and are skipped because path stays null)
 *   - only added lines are collected; collection starts after the first
 *     `@@` line of the part
 *   - parts with no path or no added lines are dropped
 *
 * New (numbering) semantics:
 *   - `@@ -a,b +c,d @@` resets the new-file cursor to c
 *   - context lines (and any non-`+`/non-`-` body line) advance the
 *     cursor; removed (`-`) lines do not (they exist only on the old
 *     side); `\ No newline at end of file` markers are ignored
 *   - a malformed hunk header still opens a hunk (legacy behavior) and
 *     degrades to monotonic numbering from the last assigned line, so
 *     a broken header can misnumber but never throws and never drops
 *     content the legacy parser kept
 */
export function parseDiff(diff: string): DiffFile[] {
  const out: DiffFile[] = [];
  const parts = diff.split(/^diff --git /m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const lines = part.split(/\r?\n/);
    let path: string | null = null;
    let inHunk = false;
    let newLine = 0;
    const content: string[] = [];
    const lineMap: number[] = [];
    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        path = line.slice("+++ b/".length).trim();
      } else if (line.startsWith("@@")) {
        inHunk = true;
        const m = HUNK_HEADER_RE.exec(line);
        if (m) {
          newLine = parseInt(m[1]!, 10);
        } else {
          // Malformed header: keep collecting (legacy behavior), number
          // monotonically from wherever we are.
          newLine =
            lineMap.length > 0 ? lineMap[lineMap.length - 1]! + 1 : 1;
        }
      } else if (inHunk && line.startsWith("+") && !line.startsWith("+++")) {
        content.push(line.slice(1));
        lineMap.push(newLine);
        newLine++;
      } else if (inHunk) {
        if (line.startsWith("-") || line.startsWith("\\")) {
          // Removed line (old side only) or "\ No newline" marker:
          // the new-file cursor does not move.
          continue;
        }
        // Context line: present in the new file, advances the cursor.
        newLine++;
      }
    }
    if (path && content.length > 0) {
      out.push({ path, content: content.join("\n"), lineMap });
    }
  }
  return out;
}

/**
 * Translate content-relative finding line numbers (1-indexed lines of
 * DiffFile.content — what analyzeFile computes) into real target-file
 * line numbers via the file's lineMap. Defensive: an out-of-range
 * content line keeps its original number rather than throwing — wrong
 * is recoverable, crashed is not.
 */
export function remapFindingLines(
  findings: NormalizedFinding[],
  lineMap: number[],
): NormalizedFinding[] {
  const map = (contentLine: number): number =>
    lineMap[contentLine - 1] ?? contentLine;
  return findings.map((f) => ({
    ...f,
    startLine: map(f.startLine),
    endLine: map(f.endLine),
  }));
}
