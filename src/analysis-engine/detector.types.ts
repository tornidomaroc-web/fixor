/**
 * Detector module interface — the foundation for Phase 3b/3c.
 *
 * A Detector owns detection and fix generation for one vulnerability
 * family. Keeping this interface stable lets us plug in additional
 * detectors (XSS, command injection, path traversal, and later
 * multi-language variants) without rewriting the workflow.
 *
 * The workflow (auditor-workflow.ts) still uses the SQL-specific pipeline
 * today. Phase 3c replaces that with an iteration over detectors.
 */

import type { FindingType } from "./types";
import type { PatchQuality } from "../types/vulnerability.types";

export type Severity = "critical" | "high" | "medium" | "low";
export type Confidence = "high" | "medium" | "low";

/** A normalized finding shape covering every vulnerability family. */
export interface NormalizedFinding {
  /** Which detector produced this finding. */
  detectorId: string;
  /** Finding type from analysis-engine/types.ts (registry key). */
  type: FindingType;
  file: string;
  startLine: number;
  endLine: number;
  originalCode: string;
  ruleId: string;
  message: string;
  explanation: string;
  confidence: Confidence;
  severity: Severity;
  /** Optional CWE override; registry default used when absent. */
  cwe?: string;
  /** Optional CVSS vector override; registry default used when absent. */
  cvssVector?: string;
  /** Optional extra context the detector wants to pass to its fixer. */
  metadata?: Record<string, unknown>;
}

/** Universal fix suggestion shape, agnostic to vulnerability family. */
export interface NormalizedFixSuggestion {
  /** Back-reference to the finding this fixes. */
  findingId: string;
  /** Which detector produced this fix. */
  detectorId: string;
  file: string;
  line: number;
  originalCode: string;
  fixedCode: string;
  explanation: string;
  confidence: Confidence;
  patchQuality: PatchQuality;
  patchWarnings: string[];
  /** Family-specific payload (e.g., SQL parameterValues + dialect). */
  metadata?: Record<string, unknown>;
}

export interface DetectorContext {
  /** Raw unified diff or file content chunk. */
  diff: string;
  /** Owner/repo (for logs / telemetry, not used for I/O). */
  repoSlug?: string;
}

export interface Detector {
  /** Stable identifier (e.g. "sql-injection-js", "xss-react"). */
  id: string;
  /** Pretty display name. */
  displayName: string;
  /** Finding types this detector can emit. */
  supports: readonly FindingType[];

  /** Languages this detector targets (file extensions w/o dot). */
  languages: readonly string[];

  /** Detect findings in the given context. */
  detect(ctx: DetectorContext): Promise<NormalizedFinding[]>;

  /** Generate a fix suggestion for one finding. */
  fix(finding: NormalizedFinding): Promise<NormalizedFixSuggestion>;
}
