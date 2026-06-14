/**
 * Finding types suppressed from customer-facing output (PR comments,
 * scan reports, dashboard). The detector / analyzer may still emit
 * them internally; this gate strips them at the boundary between the
 * analysis layer and any user-facing surface.
 *
 * Rationale (2026-05-14): the xss/cmdi/path-traversal families have no
 * discrete accuracy fixture set and no stability-validated accuracy
 * claim, so we cannot honestly defend findings of these types to a
 * customer. The central LLM analyzer (analyzeCode) that once emitted
 * them was retired (H3) and deleted, so today there is no producer for
 * xss/cmdi/path-traversal; these entries are retained as defense in
 * depth — if a future maintainer re-adds a producer, the suppression
 * here still gates emission until the family clears the triage gate.
 *
 * sql_injection_risk is DIFFERENT: it still has live producers — the
 * pr-diff SQLi heuristic (`pr-diff-analyzer.ts`, reached by the live PR
 * webhook handler) and the semgrep-legacy path in `auditor-workflow.ts`.
 * This entry is load-bearing: removing it would leak unmeasured SQL
 * findings to customer-facing output. Do not remove it.
 *
 * mass_assignment_risk is also suppressed under the paused-at-
 * calibration tag (see fixtures/mass-assignment/META.md). This is
 * defense in depth: the MA detector is not currently registered in
 * the workflow / CLI detector allowlists, but if a future maintainer
 * adds it back, the suppression here still gates emission.
 *
 * Remove an entry only after the corresponding family clears the
 * Day 5 triage gate. Do not silently widen this set for ad-hoc
 * noise reduction; the right mechanism for that is org-settings
 * filtering, not global suppression.
 */

import type { FindingType } from "../analysis-engine/types";

export const SUPPRESSED_FINDING_TYPES: ReadonlySet<FindingType> = new Set<
  FindingType
>([
  "sql_injection_risk",
  "xss_risk",
  "command_injection_risk",
  "path_traversal_risk",
  "mass_assignment_risk",
]);

export function isSuppressedFindingType(type: FindingType): boolean {
  return SUPPRESSED_FINDING_TYPES.has(type);
}
