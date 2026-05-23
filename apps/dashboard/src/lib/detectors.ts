/**
 * Detector ids the org-settings allowlist understands.
 *
 * Mirrors the server-side source of truth at
 * src/analysis-engine/detectors/registry.ts (SHIPPING_DETECTOR_IDS).
 * The dashboard is a separate Next.js app and cannot import directly
 * from src/* without a shared package, so this list is hand-mirrored:
 * WHEN YOU ADD A DETECTOR TO SHIPPING_DETECTOR_IDS, ADD IT HERE TOO
 * with a user-facing label matching docs/detector-capabilities.md.
 * Drift between the two lists shipped a silent fail-closed bug once
 * (sql/xss/cmdi/pt ids listed here while the backend ran the real
 * six) — keep them aligned.
 *
 * The PATCH validator rejects ids not in this list to keep the
 * allowlist column clean.
 */
export interface DetectorOption {
  id: string;
  label: string;
}

export const DETECTOR_OPTIONS: readonly DetectorOption[] = [
  { id: "auth-bypass-multi",         label: "Authentication bypass" },
  { id: "admin-check-multi",         label: "Missing admin check" },
  { id: "idor-multi",                label: "IDOR" },
  { id: "env-exposure-multi",        label: "Environment-variable exposure" },
  { id: "secrets-exposure-multi",    label: "Hardcoded secrets" },
  { id: "webhook-unverified-multi",  label: "Unverified webhook handlers" },
];

export const DETECTOR_IDS: readonly string[] = DETECTOR_OPTIONS.map(
  (d) => d.id,
);

export const SEVERITY_OPTIONS = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITY_OPTIONS)[number];

export function isSeverity(s: string): s is Severity {
  return (SEVERITY_OPTIONS as readonly string[]).includes(s);
}
