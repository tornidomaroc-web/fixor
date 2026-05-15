/**
 * Detector module interface — the foundation for Phase 4A.
 *
 * A Detector owns detection and fix generation for one vulnerability
 * family. Keeping this interface stable lets us plug in additional
 * detectors (XSS, command injection, path traversal, and later
 * multi-language variants) without rewriting the workflow.
 *
 * The workflow (auditor-workflow.ts) still uses the SQL-specific pipeline
 * today. Phase 4A replaces that with an iteration over registered detectors.
 */

import type { FindingType } from "./types";
import type { PatchQuality, SqlDialect } from "../types/vulnerability.types";

export type Severity = "critical" | "high" | "medium" | "low";
export type Confidence = "high" | "medium" | "low";

/**
 * Discriminated metadata carried alongside a finding/fix. Each `FindingType`
 * owns its own optional payload. Keeping this a discriminated union (rather
 * than a loose `Record<string, unknown>`) prevents detectors from quietly
 * drifting into incompatible metadata shapes.
 */
export type FindingMetadata =
  | {
      type: "sql_injection_risk";
      /** MySQL vs Postgres changes placeholder syntax. */
      dialect?: SqlDialect;
      /** Ordered expressions the caller must bind to placeholders. */
      parameterValues?: string[];
    }
  | {
      type: "xss_risk";
      /** HTML/attribute/JS/URL context determines the correct encoder. */
      context?: "html" | "attribute" | "js" | "url";
      /** Library/framework-specific sink (e.g. "dangerouslySetInnerHTML"). */
      sink?: string;
    }
  | {
      type: "command_injection_risk";
      /** child_process API the vulnerable call uses. */
      sink?: "exec" | "execSync" | "spawn" | "spawnSync" | "execFile" | "shell";
      /** True when the fix replaces a shell form with an argv-array form. */
      argvFormApplied?: boolean;
    }
  | {
      type: "path_traversal_risk";
      /** Directory the resolved path must remain within. */
      baseDir?: string;
    };

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
  /** Family-specific payload, discriminated by `type`. */
  metadata?: FindingMetadata;
}

/** Universal fix suggestion shape, agnostic to vulnerability family. */
export interface NormalizedFixSuggestion {
  /** Back-reference to the finding this fixes — see `deriveFindingId`. */
  findingId: string;
  /** Which detector produced this fix. */
  detectorId: string;
  /** Carried through from the finding so downstream (SARIF/PDF) can discriminate. */
  findingType: FindingType;
  file: string;
  line: number;
  originalCode: string;
  fixedCode: string;
  explanation: string;
  confidence: Confidence;
  patchQuality: PatchQuality;
  patchWarnings: string[];
  /** Family-specific payload, discriminated by `findingType`. */
  metadata?: FindingMetadata;
}

export interface DetectorContext {
  /** Raw unified diff or file content chunk. */
  diff: string;
  /** Owner/repo (for logs / telemetry, not used for I/O). */
  repoSlug?: string;
  /**
   * Verified Prisma schema bodies keyed by the file path they apply to.
   * Kept for backwards compatibility with the Mass-Assignment
   * Phase 1a harness; new detectors should prefer `sidecarsByPath`.
   */
  prismaSchemasByPath?: Record<string, string>;
  /**
   * Generalized sidecar channel. Outer key = file path; inner key =
   * sidecar kind ("prisma-schema", "rls-policy", "middleware",
   * "config", ...); value = sidecar body. Detectors that opt in read
   * the kinds they care about and inject them into the LLM context
   * as labeled blocks. Production injection point: GitHub App reads
   * the corresponding repo files; harness mirrors via fixture
   * sidecars (`<fixture>.<kind>` files next to the fixture).
   *
   * Adding a new sidecar kind is a capability extension per
   * detector-test-rules.md R8, not a calibration iteration.
   */
  sidecarsByPath?: Record<string, Record<string, string>>;
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

  /** Generate a fix suggestion for one finding. */
  fix(finding: NormalizedFinding): Promise<NormalizedFixSuggestion>;

  /**
   * Optional per-detector detection pass. The central LLM analyzer
   * (analysis-engine/analyze.ts) already covers SQL/XSS/CMDi/PathTraversal
   * in a single call, so most detectors can skip this. Implement it only
   * when the detector wants to add regex/AST-based findings on top.
   */
  detect?(ctx: DetectorContext): Promise<NormalizedFinding[]>;
}

/**
 * Canonical `findingId` derivation. The shape is `detectorId:type:file:line`
 * so that two runs over the same commit produce the same id, and so that the
 * id is self-descriptive in logs. Detectors MUST use this helper instead of
 * rolling their own scheme.
 */
export function deriveFindingId(finding: NormalizedFinding): string {
  return `${finding.detectorId}:${finding.type}:${finding.file}:${finding.startLine}`;
}
