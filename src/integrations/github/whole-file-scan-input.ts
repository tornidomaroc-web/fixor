/**
 * H2 (Phase H Tier 0): whole-file scan input for the webhook path.
 *
 * Every detector baseline was measured on whole-file synthetic diffs
 * (the CLI condition). The webhook path historically fed detectors the
 * added-lines slice of a real PR diff, so an unchanged handler
 * signature carrying the auth dependency was invisible — production
 * ran below the published baselines (gap G1/D6). This module upgrades
 * the real PR diff to baseline conditions:
 *
 *   raw PR diff ──→ changed paths + changed real lines (H1 parser)
 *               ──→ fetch full file at the PR head ref
 *               ──→ rebuild as the SAME synthetic whole-file diff
 *                   format the CLI uses (buildSyntheticDiff), so
 *                   detectors judge exactly the calibrated input shape
 *                   with identity line maps.
 *
 * Honesty rules:
 *   - Fetch FAILURE: fall back to the file's original diff slice (what
 *     production scanned before H2 — never lose it) AND record a
 *     scanInputError. The workflow surfaces it as a WorkflowError, so
 *     a scan with unfetchable files can never present as a clean
 *     success (same fail-loud posture as the LLM coverage gate).
 *   - OVER-CAP file (> maxFileBytes, default 200KB — the cap
 *     discipline the webhook detector already uses): fall back to the
 *     diff slice with a logged warning, no error. Changed lines are
 *     still scanned; only the context upgrade is skipped. This mirrors
 *     the established "pathologically large file → windowed payload"
 *     precedent.
 *   - Deletion-only files (a PR that removes code can introduce a
 *     vulnerability, e.g. deleting an ownership check) ARE upgraded
 *     when fetchable — the legacy added-lines path dropped them
 *     entirely. If their fetch fails there is nothing to fall back to;
 *     that is recorded as a scanInputError, not silently skipped.
 *
 * `changedLinesByPath` carries the REAL file lines the PR touched:
 * added lines plus a deletion anchor (the new-file line where removed
 * code used to sit). The workflow uses it to partition findings into
 * PR-introduced vs pre-existing — see
 * src/workflows/changed-line-partition.ts for that product decision.
 */

import { buildSyntheticDiff } from "../../cli/diff-builder";
import { parseDiff } from "../../analysis-engine/detectors/shared/diff-parser";
import { logger } from "../../lib/logger";
import {
  candidateLayoutPaths,
  resolveRemixRouteGuard,
  type GuardFs,
} from "../../analysis-engine/detectors/shared/route-guard-resolver";
import { SIDECAR_KINDS } from "../../analysis-engine/sidecar-kinds";

export interface ScanInputError {
  path: string;
  reason: string;
}

export interface WholeFileScanInput {
  /** Diff fed to the workflow/detectors (synthetic whole-file parts
   *  where the upgrade succeeded; original diff slices as fallback). */
  diff: string;
  /** Real target-file lines the PR touched, per path (added lines +
   *  deletion anchors). Drives the introduced/pre-existing partition. */
  changedLinesByPath: Record<string, number[]>;
  /** Files whose whole-file fetch failed — degraded scan input. */
  scanInputErrors: ScanInputError[];
  /** Paths successfully upgraded to whole-file context. */
  wholeFilePaths: string[];
  /** Paths scanned from their diff slice (over-cap or fetch failure). */
  fallbackPaths: string[];
}

const DEFAULT_MAX_FILE_BYTES = 200_000;

const HUNK_HEADER_RE = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/;

interface RawDiffPart {
  path: string;
  /** Original part text, re-prefixed with "diff --git " for fallback. */
  raw: string;
  changedLines: number[];
  hasAddedLines: boolean;
}

/**
 * Splits the raw diff into per-file parts, extracting for each the
 * changed-line set on the NEW file side: every added line's number plus
 * one anchor line per deletion run (where the removed code used to be).
 */
export function splitDiffParts(rawDiff: string): RawDiffPart[] {
  const out: RawDiffPart[] = [];
  const parts = rawDiff.split(/^diff --git /m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const lines = part.split(/\r?\n/);
    let path: string | null = null;
    let inHunk = false;
    let newLine = 0;
    let hasAddedLines = false;
    let inDeletionRun = false;
    const changed = new Set<number>();
    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        path = line.slice("+++ b/".length).trim();
      } else if (line.startsWith("@@")) {
        inHunk = true;
        inDeletionRun = false;
        const m = HUNK_HEADER_RE.exec(line);
        newLine = m ? parseInt(m[1]!, 10) : 1;
      } else if (inHunk && line.startsWith("+") && !line.startsWith("+++")) {
        changed.add(newLine);
        hasAddedLines = true;
        inDeletionRun = false;
        newLine++;
      } else if (inHunk) {
        if (line.startsWith("-")) {
          // Deletion: anchor the change at the new-side position where
          // the removed code used to live (one anchor per run).
          if (!inDeletionRun) {
            changed.add(Math.max(1, newLine));
            inDeletionRun = true;
          }
        } else if (!line.startsWith("\\")) {
          inDeletionRun = false;
          newLine++;
        }
      }
    }
    if (path && changed.size > 0) {
      out.push({
        path,
        raw: "diff --git " + part,
        changedLines: [...changed].sort((a, b) => a - b),
        hasAddedLines,
      });
    }
  }
  return out;
}

export async function buildWholeFileScanInput(
  rawDiff: string,
  fetchFile: (path: string) => Promise<string>,
  opts?: { maxFileBytes?: number },
): Promise<WholeFileScanInput> {
  const maxFileBytes = opts?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const parts = splitDiffParts(rawDiff);

  const diffPieces: string[] = [];
  const changedLinesByPath: Record<string, number[]> = {};
  const scanInputErrors: ScanInputError[] = [];
  const wholeFilePaths: string[] = [];
  const fallbackPaths: string[] = [];

  const results = await Promise.all(
    parts.map(async (part) => {
      try {
        const content = await fetchFile(part.path);
        return { part, content, error: null as string | null };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { part, content: null, error: reason };
      }
    }),
  );

  for (const { part, content, error } of results) {
    changedLinesByPath[part.path] = part.changedLines;

    if (content !== null) {
      if (Buffer.byteLength(content, "utf8") <= maxFileBytes) {
        diffPieces.push(buildSyntheticDiff(part.path, content));
        wholeFilePaths.push(part.path);
        continue;
      }
      // Over-cap: established fallback discipline — scan the slice.
      logger.warn(
        { path: part.path, bytes: Buffer.byteLength(content, "utf8") },
        "whole-file scan input: file over size cap; falling back to diff slice",
      );
    } else {
      scanInputErrors.push({
        path: part.path,
        reason: `whole-file fetch failed: ${error}`,
      });
      logger.error(
        { path: part.path, err: error },
        "whole-file scan input: fetch failed — scan input degraded",
      );
    }

    if (part.hasAddedLines) {
      // Fallback: the original diff slice (exactly what production
      // scanned pre-H2 — changed lines still covered, context degraded).
      diffPieces.push(part.raw.endsWith("\n") ? part.raw : part.raw + "\n");
      fallbackPaths.push(part.path);
    }
    // Deletion-only parts have no added lines: the legacy parser drops
    // them, so there is no slice to fall back to. The scanInputError
    // recorded above (fetch-failure case) is the honest signal; the
    // over-cap case for a deletion-only file simply isn't upgraded.
  }

  return {
    diff: diffPieces.join(""),
    changedLinesByPath,
    scanInputErrors,
    wholeFilePaths,
    fallbackPaths,
  };
}

export interface RouteGuardError {
  /** The ROUTE whose parent-layout guard could not be resolved (the file
   *  being judged), not merely the layout candidate that failed. */
  route: string;
  /** The ancestor `_layout.*` candidate whose fetch failed (non-404). */
  layout: string;
  /** Precise underlying reason, carried into the WorkflowError `details`. */
  reason: string;
}

export interface RouteGuardSidecars {
  /** Path -> { "route-guard": <resolved parent-layout guard body> }.
   *  Only routes with a PROVEN blocking ancestor layout appear. */
  sidecarsByPath: Record<string, Record<string, string>>;
  /** Routes whose parent-layout guard could NOT be resolved because an
   *  ancestor `_layout.*` fetch failed for a non-404 reason (rate-limit,
   *  5xx, network). Kept as a DISTINCT channel from H2's whole-file
   *  `scanInputErrors` so the operator-facing message points at layout
   *  resolution (and names the route), not whole-file scanning. The
   *  workflow surfaces these as WorkflowErrors — same fail-loud status
   *  effect, different (accurate) wording. */
  routeGuardErrors: RouteGuardError[];
}

/**
 * Distinguish "layout genuinely absent" (HTTP 404) from a real fetch
 * failure. `fetchFileAtRef` throws a `GitHubApiError` carrying
 * `details.status`; a genuine 404 is the normal "no guard here" case and
 * must stay silent, while any other status (403 rate-limit, 5xx) or a
 * non-HTTP throw (network/timeout) is a fetch error that must fail loud.
 * Duck-typed on `.details.status` / `.status` so test stubs can signal a
 * 404 without importing GitHubApiError.
 */
function isAbsent404(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const withDetails = err as { details?: { status?: unknown }; status?: unknown };
  const status = withDetails.details?.status ?? withDetails.status;
  return status === 404;
}

/**
 * Resolve Phase-G parent-layout route-guard sidecars for the webhook /
 * GitHub App path (Engine B), bringing it to parity with the CLI (Engine
 * A), which resolves them synchronously via `resolveRemixRouteGuard(absPath)`
 * in `cli/scan.ts`. The webhook path has no local checkout — only an async
 * `fetchFile(path)` (GitHub contents at the PR head) — so we fetch the
 * candidate ancestor `_layout.*` files, build an in-memory `GuardFs`, and
 * call the UNCHANGED resolver (which alone decides PROVEN coverage).
 *
 * Additive and safe by construction:
 *   - Only paths under `/routes/` incur any fetches; every other changed
 *     file returns no candidates, so non-Remix PRs do zero extra work and
 *     get no sidecar (behavior unchanged).
 *   - Only a PROVEN, blocking ancestor layout yields a sidecar entry, so a
 *     route without one is judged exactly as before.
 *
 * Fail-loud policy (same status effect as H2's `scanInputErrors`, distinct
 * message):
 *   - a candidate fetch that 404s -> layout absent (normal; no guard, no
 *     noise).
 *   - a candidate fetch that fails for any OTHER reason -> a RouteGuardError
 *     is recorded against EACH route that layout was an ancestor of (a
 *     failed fetch means we cannot prove whether that layout would have
 *     cleared the route). The workflow surfaces it as a WorkflowError, so
 *     the scan can never read as a clean success while a parent-layout
 *     guard could not be resolved — F-001 cannot quietly reappear on an
 *     API blip (the route may re-flag, but never silently).
 */
export async function resolveRouteGuardSidecars(
  paths: string[],
  fetchFile: (path: string) => Promise<string>,
): Promise<RouteGuardSidecars> {
  const sidecarsByPath: Record<string, Record<string, string>> = {};
  const routeGuardErrors: RouteGuardError[] = [];

  const norm = (p: string) => p.replace(/\\/g, "/");
  const routePaths = paths.filter((p) => /(^|\/)routes\//.test(norm(p)));
  if (routePaths.length === 0) return { sidecarsByPath, routeGuardErrors };

  // Enumerate every candidate ancestor layout once — sibling routes under
  // the same layout share ancestors, so dedupe before fetching. Cache the
  // per-route candidate list so the attribution pass below doesn't recompute.
  const candidatesByRoute = new Map<string, string[]>();
  const wanted = new Set<string>();
  for (const rp of routePaths) {
    const cands = candidateLayoutPaths(rp);
    candidatesByRoute.set(rp, cands);
    for (const cand of cands) wanted.add(cand);
  }

  const contentByPath = new Map<string, string>();
  /** Candidate (normalized) -> reason, for NON-404 fetch failures only. */
  const failedCandidates = new Map<string, string>();
  await Promise.all(
    [...wanted].map(async (cand) => {
      try {
        const content = await fetchFile(cand);
        contentByPath.set(norm(cand), content);
      } catch (err) {
        if (isAbsent404(err)) return; // genuinely absent -> no guard, no noise
        const reason = err instanceof Error ? err.message : String(err);
        failedCandidates.set(norm(cand), reason);
        logger.error(
          { path: cand, err: reason },
          "route-guard resolution: layout fetch failed — parent-layout guard could not be resolved (scan input degraded)",
        );
      }
    }),
  );

  // In-memory GuardFs backed by the fetched layouts; the resolver queries
  // it with join()-produced paths (OS separators on Windows), so normalize
  // both sides. This reuses the validated resolver with ZERO changes.
  const memFs: GuardFs = {
    exists: (p) => contentByPath.has(norm(p)),
    read: (p) => contentByPath.get(norm(p)) ?? null,
  };

  for (const rp of routePaths) {
    // Fail-loud, attributed to THIS route: if any of its ancestor-layout
    // candidates failed to fetch (non-404), we could not prove coverage —
    // record one error naming the route (one is enough to force off-clean).
    for (const cand of candidatesByRoute.get(rp) ?? []) {
      const nc = norm(cand);
      if (failedCandidates.has(nc)) {
        routeGuardErrors.push({
          route: rp,
          layout: nc,
          reason: `route-guard layout fetch failed: ${failedCandidates.get(nc)}`,
        });
        break;
      }
    }

    const body = resolveRemixRouteGuard(rp, memFs);
    if (body) {
      sidecarsByPath[rp] = { [SIDECAR_KINDS.ROUTE_GUARD]: body };
    }
  }

  return { sidecarsByPath, routeGuardErrors };
}

/** Re-exported for tests asserting the detector-visible shape. */
export { parseDiff as parseScanDiff };
