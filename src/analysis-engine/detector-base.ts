/**
 * Phase 1 prep: shared utilities for upcoming detectors.
 *
 * Re-uses the existing Finding shape from ./types and the Severity union
 * from ./detector.types so new detectors integrate with the existing
 * NormalizedFinding pipeline without churn.
 */

import type { Finding, FindingType } from "./types";

export interface DetectorContext {
  filePath: string;
  content: string;
  language: string;
  diff?: string;
  repoSlug?: string;
}

export function extractCodeSnippet(
  content: string,
  lineNumber: number,
  contextLines: number,
): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, lineNumber - 1 - contextLines);
  const end = Math.min(lines.length, lineNumber + contextLines);
  return lines.slice(start, end).join("\n");
}

export function createFinding(
  type: FindingType,
  file: string,
  line: number,
  severity: Finding["severity"],
  description: string,
  snippet: string,
): Finding {
  return {
    type,
    file,
    line,
    severity,
    confidence: "medium",
    explanation: description,
    why_it_matters: "",
    suggested_fix: "",
    example_fix: "",
    original_snippet: snippet,
  };
}

export const DEFAULT_SEVERITY_FOR_TYPE: Record<FindingType, Finding["severity"]> = {
  sql_injection_risk: "critical",
  xss_risk: "critical",
  command_injection_risk: "critical",
  path_traversal_risk: "critical",
  auth_bypass_risk: "critical",
  secrets_exposure_risk: "critical",
  webhook_unverified_risk: "critical",
  env_exposure_risk: "critical",
  admin_check_risk: "critical",
};
