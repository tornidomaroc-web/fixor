/**
 * H2 product decision: what Fixor does when whole-file context surfaces
 * a vulnerability in code the PR did NOT touch.
 *
 * Decision (2026-06-12, founder-delegated): partition, don't suppress
 * and don't flatten.
 *
 *   - PR-INTRODUCED findings (on or near changed lines) are first-class:
 *     they go through fix generation and render prominently in the PR
 *     comment — identical to pre-H2 behavior and to what the baselines
 *     measure (per-file detection accuracy).
 *   - PRE-EXISTING findings are reported DETECTION-ONLY in a collapsed
 *     secondary section of the PR comment, capped, with NO fix
 *     generation. Rationale: silently dropping them is "we saw it and
 *     said nothing" — unacceptable for a security tool; reporting them
 *     as first-class blames the PR author for debt they didn't write
 *     and spends fix-generation calls on code this PR shouldn't change.
 *
 * Classification is deliberately FAIL-TOWARD-INTRODUCED: a finding
 * counts as PR-introduced when ANY changed line falls within
 * [startLine - PRE_WINDOW, startLine + POST_WINDOW]. Findings anchor at
 * the route declaration (anchor-at-verdict-route), which is often an
 * UNCHANGED line above an added vulnerable body — exact line matching
 * would misfile genuinely introduced findings as pre-existing, which
 * buries the PR's own bug. Over-attributing a pre-existing finding to
 * the PR is the cheaper error (slightly noisy), so the window is
 * generous. POST_WINDOW covers a typical handler body below the anchor;
 * PRE_WINDOW covers decorator/comment edits just above it.
 *
 * Known accepted downsides (named, not hidden):
 *   - Pre-existing findings recur on every PR touching the file until
 *     fixed (visibility-by-design, but repetitive on legacy codebases).
 *   - The first PR into an old file may carry a long collapsed list
 *     (capped at render time by the comment builder).
 *   - The window is a heuristic; it can over-attribute. It cannot
 *     under-attribute silently except when a vulnerable handler spans
 *     more than POST_WINDOW lines between its anchor and the changed
 *     body line.
 *
 * When no changedLinesByPath is supplied (CLI scans, direct workflow
 * calls, legacy payloads) everything is "introduced" — pre-H2 behavior,
 * unchanged.
 */

import type { NormalizedFinding } from "../analysis-engine/detector.types";

export const PRE_WINDOW = 5;
export const POST_WINDOW = 40;

export interface PartitionedFindings {
  introduced: NormalizedFinding[];
  preExisting: NormalizedFinding[];
}

export function partitionFindingsByChangedLines(
  findings: NormalizedFinding[],
  changedLinesByPath: Record<string, number[]>,
): PartitionedFindings {
  const introduced: NormalizedFinding[] = [];
  const preExisting: NormalizedFinding[] = [];

  for (const f of findings) {
    const changed = changedLinesByPath[f.file];
    if (!changed || changed.length === 0) {
      // File not in the map (defensive — every scanned file should be):
      // fail toward prominent.
      introduced.push(f);
      continue;
    }
    const lo = f.startLine - PRE_WINDOW;
    const hi = Math.max(f.startLine, f.endLine) + POST_WINDOW;
    const touchesPr = changed.some((line) => line >= lo && line <= hi);
    if (touchesPr) {
      introduced.push(f);
    } else {
      preExisting.push(f);
    }
  }

  return { introduced, preExisting };
}
