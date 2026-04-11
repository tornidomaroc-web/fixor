import type { SqlInjectionExploit } from "../services/risk-explainer.js";
import { SqlInjectionFixSuggestion } from "./vulnerability.types.js";

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
  status: "success" | "partial_success" | "failed" | "no_action";
  automationReady: boolean;
  /** Why automation is or is not allowed (patch quality + warnings + status). */
  automationDecisionReason: string;
  totalFindings: number;
  sqlInjectionFindings: number;
  skippedFindings: number;
  fixesGenerated: number;
  highQualityPatches: number;
  mediumQualityPatches: number;
  lowQualityPatches: number;
  fixes: SqlInjectionFixSuggestion[];
  exploits?: SqlInjectionExploit[];
  errors: WorkflowError[];
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
