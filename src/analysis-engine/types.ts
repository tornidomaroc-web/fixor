export type FindingType =
  | "sql_injection_risk"
  | "xss_risk"
  | "command_injection_risk"
  | "path_traversal_risk";

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
}

export interface AnalysisResult {
  findings: Finding[];
}
