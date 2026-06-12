/**
 * SARIF 2.1.0 output for Fixor findings.
 *
 * GitHub Code Scanning, VS Code's SARIF viewer, Azure DevOps, and most
 * enterprise triage pipelines speak SARIF. Emitting it lets Fixor findings
 * show up in the native Security tab instead of living only in a PR
 * comment.
 *
 * Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */

import {
  VULNERABILITY_REGISTRY,
  severityToSarifLevel,
  type SeverityBand,
} from "../config/vulnerability-registry";
import type { FindingType } from "../analysis-engine/types";
import type { WorkflowResult } from "../types/workflow.types";
/**
 * Minimal shape SARIF needs from a fix. Any concrete fix type (SQL today,
 * XSS/CMDi/Path Traversal in Phase 4A) satisfies this structurally.
 */
interface SarifFixInput {
  findingType: FindingType;
  file: string;
  line: number;
  fixedCode: string;
  explanation: string;
}

const FIXOR_VERSION = "0.2.0";
const FIXOR_INFORMATION_URI = "https://github.com/tornidomaroc-web/fixor";

export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: SarifRun[];
}

export interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri: string;
      rules: SarifRule[];
    };
  };
  /** §3.14.11 — executionSuccessful is set false when detection coverage
   *  was degraded (LLM calls failed), so SARIF consumers never treat a
   *  partially-blind run's results as a complete clean scan. */
  invocations: Array<{
    executionSuccessful: boolean;
    toolExecutionNotifications?: Array<{
      level: "error" | "warning" | "note";
      message: { text: string };
    }>;
  }>;
  results: SarifResult[];
}

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  helpUri: string;
  defaultConfiguration: {
    level: "error" | "warning" | "note";
  };
  properties: {
    cwe: string;
    owaspTop10: string;
    cvssScore: number;
    cvssVector: string;
    tags: string[];
  };
}

export interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region: { startLine: number; endLine?: number };
    };
  }>;
  partialFingerprints?: Record<string, string>;
  fixes?: Array<{
    description: { text: string };
    artifactChanges: Array<{
      artifactLocation: { uri: string };
      replacements: Array<{
        deletedRegion: { startLine: number; endLine?: number };
        insertedContent: { text: string };
      }>;
    }>;
  }>;
}

/**
 * Maps a finding type to its SARIF rule definition.
 * Only types in VULNERABILITY_REGISTRY produce rules.
 */
function buildRules(usedTypes: ReadonlySet<FindingType>): SarifRule[] {
  const rules: SarifRule[] = [];
  for (const type of usedTypes) {
    const meta = VULNERABILITY_REGISTRY[type];
    rules.push({
      id: type,
      name: meta.name,
      shortDescription: { text: meta.shortDescription },
      fullDescription: { text: meta.fullDescription },
      helpUri: meta.helpUri,
      defaultConfiguration: {
        level: severityToSarifLevel(meta.defaultSeverity),
      },
      properties: {
        cwe: meta.cwe,
        owaspTop10: meta.owaspTop10,
        cvssScore: meta.defaultCvssScore,
        cvssVector: meta.defaultCvssVector,
        tags: ["security", meta.cwe, meta.owaspTop10],
      },
    });
  }
  return rules;
}

/**
 * Normalizes a severity string coming from a finding into a band we
 * recognize, falling back to the registry default when input is unknown.
 */
function resolveSeverity(
  raw: string | undefined,
  fallback: SeverityBand
): SeverityBand {
  if (raw === "critical" || raw === "high" || raw === "medium" || raw === "low") {
    return raw;
  }
  return fallback;
}

/** Stable fingerprint for a finding, so re-runs reuse the same SARIF id. */
function fingerprint(file: string, line: number, ruleId: string): string {
  return `${ruleId}:${file}:${line}`;
}

export interface SarifGenerationContext {
  /** Repository slug, e.g. "owner/repo". Used as run.originalUriBaseIds. */
  repoSlug?: string;
  /** Commit SHA (optional) for provenance in the log. */
  commitSha?: string;
}

/**
 * Builds a SARIF log from a Fixor WorkflowResult. Each fix becomes one
 * result; its suggested rewrite becomes a SARIF "fix" the IDE can apply.
 */
export function buildSarifLog(
  workflow: WorkflowResult,
  _context: SarifGenerationContext = {}
): SarifLog {
  const usedTypes = new Set<FindingType>();
  const results: SarifResult[] = [];

  for (const fix of workflow.fixes) {
    const ruleType = fix.findingType;
    usedTypes.add(ruleType);
    results.push(fixToSarifResult(fix, ruleType));
  }

  const cov = workflow.llmCoverage;
  const degraded = cov !== undefined && cov.failed > 0;
  const invocations: SarifRun["invocations"] = [
    {
      executionSuccessful: !degraded,
      ...(degraded
        ? {
            toolExecutionNotifications: [
              {
                level: "error" as const,
                message: {
                  text:
                    `Detection coverage degraded: ${cov.failed} of ${cov.attempted} LLM detection call(s) failed. ` +
                    `Results are incomplete; absence of findings must not be read as a clean scan.`,
                },
              },
            ],
          }
        : {}),
    },
  ];

  return {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Fixor",
            version: FIXOR_VERSION,
            informationUri: FIXOR_INFORMATION_URI,
            rules: buildRules(usedTypes),
          },
        },
        invocations,
        results,
      },
    ],
  };
}

function fixToSarifResult(
  fix: SarifFixInput,
  ruleType: FindingType
): SarifResult {
  const meta = VULNERABILITY_REGISTRY[ruleType];
  const severity = resolveSeverity(undefined, meta.defaultSeverity);
  const fp = fingerprint(fix.file, fix.line, ruleType);

  return {
    ruleId: ruleType,
    level: severityToSarifLevel(severity),
    message: { text: fix.explanation },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: fix.file },
          region: { startLine: fix.line },
        },
      },
    ],
    partialFingerprints: { fixorFingerprintV1: fp },
    fixes: [
      {
        description: { text: `Fixor suggested rewrite (${meta.name})` },
        artifactChanges: [
          {
            artifactLocation: { uri: fix.file },
            replacements: [
              {
                deletedRegion: { startLine: fix.line, endLine: fix.line },
                insertedContent: { text: fix.fixedCode },
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Serialize to SARIF JSON text (pretty-printed, stable). */
export function sarifToJson(log: SarifLog): string {
  return JSON.stringify(log, null, 2);
}
