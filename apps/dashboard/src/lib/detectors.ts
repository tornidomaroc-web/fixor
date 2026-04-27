/**
 * Detector ids the org-settings allowlist understands.
 *
 * Mirrors the backend registry at src/analysis-engine/detectors/registry.ts
 * — when a new detector is added there, append its id here so the
 * settings UI can surface it. The PATCH validator rejects ids not in
 * this list to keep the allowlist column clean.
 */
export interface DetectorOption {
  id: string;
  label: string;
}

export const DETECTOR_OPTIONS: readonly DetectorOption[] = [
  { id: "sql-injection-js-ts", label: "SQL injection" },
  { id: "xss-js-ts", label: "Cross-site scripting (XSS)" },
  { id: "command-injection-js-ts", label: "Command injection" },
  { id: "path-traversal-js-ts", label: "Path traversal" },
];

export const DETECTOR_IDS: readonly string[] = DETECTOR_OPTIONS.map(
  (d) => d.id,
);

export const SEVERITY_OPTIONS = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITY_OPTIONS)[number];

export function isSeverity(s: string): s is Severity {
  return (SEVERITY_OPTIONS as readonly string[]).includes(s);
}
