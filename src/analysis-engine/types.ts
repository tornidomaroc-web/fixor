export type FindingType =
  | "sql_injection_risk"
  | "xss_risk"
  | "command_injection_risk"
  | "path_traversal_risk"
  | "auth_bypass_risk"
  | "secrets_exposure_risk"
  | "webhook_unverified_risk"
  | "env_exposure_risk"
  | "admin_check_risk";

export interface Finding {
  type: FindingType;
  file: string;
  line: number;
  confidence: "high" | "medium" | "low";
  severity: "critical" | "high" | "medium";
  explanation: string;
  why_it_matters: string;
  suggested_fix: string;
  example_fix: string;
  original_snippet: string;
}

export interface AnalysisResult {
  findings: Finding[];
}
