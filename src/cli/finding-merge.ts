import type { Finding } from "../analysis-engine/types.js";

/**
 * Collapse exact duplicates only: two findings of the SAME type at the SAME
 * (file, line) are the same finding reported twice. Distinct types at the same
 * line are distinct findings and are preserved — the dedup key includes `type`.
 */
export function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const key = `${f.file}:${f.line}:${f.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/**
 * Single public entry point for collapsing a file's raw detector findings into
 * the set that reaches the report.
 *
 * History — why this no longer suppresses across detector types:
 * A prior `suppressAdminCheckWhereAuthBypass` step dropped every admin_check
 * finding on any (file, line) where auth_bypass also fired, on the assumption
 * that "auth-bypass on a route with no auth at all subsumes the admin-check
 * signal." That assumption is FALSE for an authenticated-but-not-admin route
 * (an admin action gated only by a generic current-user dependency, no
 * superuser check). There, admin_check is the CORRECT, more-specific finding
 * and auth_bypass is a cross-fire — yet the suppression deleted the correct
 * finding and kept the mislabeled one, silently, with no trace in the report.
 * The real-shape FastAPI proof reproduced exactly this (admin role route).
 *
 * Silent loss of a true positive is the most dangerous scanner failure mode:
 * nobody sees it to question it. Visible cross-fire noise is self-announcing
 * and is addressed at the detector/prompt layer, not by deleting findings here.
 * So we collapse exact duplicates only and never drop a distinct vuln type.
 * Do NOT re-introduce cross-type suppression here — see test:finding-merge.
 */
export function collapseFindings(findings: Finding[]): Finding[] {
  return dedupeFindings(findings);
}
