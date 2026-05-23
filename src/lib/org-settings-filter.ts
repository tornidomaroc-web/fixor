/**
 * Pure predicate + filter for applying `org_settings` to findings.
 *
 * Filter order (a finding must pass ALL three to survive):
 *   1. severity >= severityThreshold
 *   2. file does not match any ignoredGlob
 *   3. when enabledDetectors is non-null, the registry detector for
 *      the finding's type must be in the allowlist. Findings with no
 *      registered detector pass through (the workflow's existing
 *      "unsupportedByType" path counts them) so users don't accidentally
 *      hide future detectors by setting an allowlist now.
 */
import { minimatch } from "minimatch";
import {
  getDetectorFor,
  SHIPPING_DETECTOR_IDS,
} from "../analysis-engine/detectors/registry";
import type { Severity } from "../analysis-engine/detector.types";
import type { FindingType } from "../analysis-engine/types";

/** Lowest -> highest. Findings with rank below threshold are dropped. */
const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export interface OrgSettingsView {
  severityThreshold: Severity;
  ignoredGlobs: string[];
  enabledDetectors: string[] | null;
}

/** Minimal shape needed by the filter — both `Finding` and `NormalizedFinding` satisfy it. */
export interface FindingForFilter {
  file: string;
  type: FindingType;
  severity: Severity;
}

export type FilterReason = "severity" | "glob" | "detector";

export interface FilterStats {
  droppedBySeverity: number;
  droppedByGlob: number;
  droppedByDetector: number;
}

/**
 * Pure predicate. Returns whether a finding survives the settings, and
 * if not, which gate dropped it. Useful when the caller has multiple
 * arrays to filter and wants to keep them aligned.
 */
export function passesOrgSettings(
  finding: FindingForFilter,
  settings: OrgSettingsView,
): { passes: true } | { passes: false; reason: FilterReason } {
  if (
    SEVERITY_RANK[finding.severity] <
    SEVERITY_RANK[settings.severityThreshold]
  ) {
    return { passes: false, reason: "severity" };
  }
  if (settings.ignoredGlobs.length > 0) {
    for (const glob of settings.ignoredGlobs) {
      if (minimatch(finding.file, glob, { dot: true })) {
        return { passes: false, reason: "glob" };
      }
    }
  }
  if (settings.enabledDetectors !== null) {
    // Three-branch logic, with an asymmetric defensive guard:
    //
    //   [] (length 0)
    //     User's deliberate "scan nothing" choice. The validator
    //     explicitly accepts empty arrays (see settings-validation.ts:78
    //     comment: "empty array means 'no detectors run', which we
    //     accept even though it's an aggressive choice; the backend
    //     honors it."). Honor the choice — drop the finding.
    //
    //   non-empty, but NO id matches a shipping detector
    //     Stale allowlist — e.g. an org row written by the pre-fix
    //     dashboard when DETECTOR_OPTIONS pointed at suppressed
    //     sql/xss/cmdi/pt ids. Without this guard, every scan filters
    //     to zero findings — a silent fail-closed where customers see
    //     a clean scan on dirty code. Fail-safe: fall through, all
    //     detectors pass. The DB row is left untouched; a separate
    //     migration can clean it up.
    //
    //   non-empty, at least one recognized id
    //     Normal allowlist behavior on the recognized subset.
    if (settings.enabledDetectors.length === 0) {
      return { passes: false, reason: "detector" };
    }
    const recognized = settings.enabledDetectors.filter((id) =>
      SHIPPING_DETECTOR_IDS.has(id),
    );
    if (recognized.length > 0) {
      const detector = getDetectorFor(finding.type);
      // No-detector findings pass; the workflow's unsupportedByType
      // bucket already accounts for them. Only filter when the type
      // HAS a detector and that detector is not in the allowlist.
      if (detector && !recognized.includes(detector.id)) {
        return { passes: false, reason: "detector" };
      }
    }
    // recognized.length === 0 (but length > 0) → stale, fall through.
  }
  return { passes: true };
}

/** Apply the filter to an array; return survivors + per-reason counts. */
export function filterFindings<T extends FindingForFilter>(
  findings: T[],
  settings: OrgSettingsView,
): { kept: T[]; stats: FilterStats } {
  const kept: T[] = [];
  const stats: FilterStats = {
    droppedBySeverity: 0,
    droppedByGlob: 0,
    droppedByDetector: 0,
  };
  for (const f of findings) {
    const r = passesOrgSettings(f, settings);
    if (r.passes) {
      kept.push(f);
    } else if (r.reason === "severity") {
      stats.droppedBySeverity++;
    } else if (r.reason === "glob") {
      stats.droppedByGlob++;
    } else {
      stats.droppedByDetector++;
    }
  }
  return { kept, stats };
}
