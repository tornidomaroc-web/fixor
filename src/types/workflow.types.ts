import type { SqlInjectionExploit } from "../services/risk-explainer.js";
import type { NormalizedFixSuggestion } from "../analysis-engine/detector.types.js";

export interface ScanMetadata {
  repoName?: string;
  commitId?: string;
  scanId?: string;
  [key: string]: any;
}

export interface WorkflowError {
  findingId?: string;
  message: string;
  details?: any;
}

export interface WorkflowResult {
  status:
    | "success"
    | "partial_success"
    | "failed"
    | "no_action"
    | "budget_exceeded";
  automationReady: boolean;
  /** Why automation is or is not allowed (patch quality + warnings + status). */
  automationDecisionReason: string;
  totalFindings: number;
  /**
   * SQL-injection findings specifically (kept for backwards-compatible
   * webhook response shape). For the total number of findings that had a
   * registered detector across all families, use `classifiedFindings`.
   */
  sqlInjectionFindings: number;
  /**
   * Findings that had a detector registered for their type across every
   * family (SQL, XSS, CMDi, Path Traversal). `classifiedFindings -
   * fixesGenerated === errors.length` when every failure is logged.
   */
  classifiedFindings: number;
  skippedFindings: number;
  fixesGenerated: number;
  highQualityPatches: number;
  mediumQualityPatches: number;
  lowQualityPatches: number;
  /**
   * All fixes produced this run, regardless of vulnerability family.
   * Consumers discriminate on `fix.findingType`; SQL-specific details
   * (dialect, parameterValues) live on `fix.metadata`.
   */
  fixes: NormalizedFixSuggestion[];
  /**
   * SQL-specific risk explanations keyed by the `findingId` of the fix
   * they belong to. Non-SQL fixes have no entry. Keying by id (rather
   * than array index) prevents exploit text from attaching to the
   * wrong fix when mixed-family runs interleave SQL and XSS fixes.
   */
  exploits?: Record<string, SqlInjectionExploit>;
  /** Optional URL to the PDF report uploaded for this run. */
  pdfUrl?: string | null;
  /** Optional URL to the SARIF log uploaded for this run. */
  sarifUrl?: string | null;
  errors: WorkflowError[];
  /**
   * Present only when status === "budget_exceeded": the live spend that
   * tripped the cap and the configured cap values. The handler renders
   * these into the PR comment.
   */
  budget?: {
    reason: "monthly_exceeded" | "daily_exceeded";
    monthlySpend: number;
    dailySpend: number;
    monthlyCapUsd: number;
    dailyCapUsd: number;
  };
  metadata: ScanMetadata;
  timing: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  };
}

export interface BatchInput {
  semgrepPayload: any;
  metadata: ScanMetadata;
}

export interface BatchReport {
  totalRepos: number;
  totalFindings: number;
  totalFixes: number;
  avgFixesPerRepo: number;
  highQualityPatches: number;
  mediumQualityPatches: number;
  lowQualityPatches: number;
  automationReadyRepos: number;
  reposNeedingReview: number;
  automationBlockReasons: {
    lowQuality: number;
    warnings: number;
    failedStatus: number;
  };
  warningSummaries: Record<string, number>;
  repoReports: WorkflowResult[];
}
