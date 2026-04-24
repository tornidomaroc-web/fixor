/**
 * SQL injection detector — wraps the existing SQL fix service behind the
 * Detector interface. Detection itself is handled by the central LLM
 * analyzer (analyze.ts); this detector is invoked only to generate fixes
 * for findings whose `type === "sql_injection_risk"`.
 */

import type {
  Detector,
  NormalizedFinding,
  NormalizedFixSuggestion,
} from "../detector.types";
import { deriveFindingId } from "../detector.types";
import { generateSqlInjectionFix } from "../../services/fix.service";
import type { NormalizedSqlInjectionFinding } from "../../types/vulnerability.types";

const DETECTOR_ID = "sql-injection-js-ts";

export class SqlInjectionDetector implements Detector {
  readonly id = DETECTOR_ID;
  readonly displayName = "SQL Injection (JS/TS)";
  readonly supports = ["sql_injection_risk"] as const;
  readonly languages = ["js", "jsx", "ts", "tsx"] as const;

  async fix(finding: NormalizedFinding): Promise<NormalizedFixSuggestion> {
    const sqlFinding: NormalizedSqlInjectionFinding = {
      type: "SQL_INJECTION",
      findingType: "sql_injection_risk",
      file: finding.file,
      startLine: finding.startLine,
      endLine: finding.endLine,
      ruleId: finding.ruleId,
      message: finding.message,
      originalCode: finding.originalCode,
      explanation: finding.explanation,
      classificationConfidence: finding.confidence,
      classificationScore:
        finding.confidence === "high"
          ? 90
          : finding.confidence === "medium"
            ? 50
            : 20,
    };

    const suggestion = await generateSqlInjectionFix(sqlFinding);

    return {
      findingId: deriveFindingId(finding),
      detectorId: DETECTOR_ID,
      findingType: "sql_injection_risk",
      file: suggestion.file,
      line: suggestion.line,
      originalCode: suggestion.originalCode,
      fixedCode: suggestion.fixedCode,
      explanation: suggestion.explanation,
      confidence: suggestion.confidence,
      patchQuality: suggestion.patchQuality,
      patchWarnings: suggestion.patchWarnings,
      metadata: {
        type: "sql_injection_risk",
        dialect: suggestion.dialect,
        parameterValues: suggestion.parameterValues,
      },
    };
  }
}
