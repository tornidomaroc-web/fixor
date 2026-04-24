import { generateSqlInjectionFix } from "../services/fix.service";
import type { NormalizedSqlInjectionFinding } from "../types/vulnerability.types";

async function main() {
  const finding: NormalizedSqlInjectionFinding = {
    type: "SQL_INJECTION",
    findingType: "sql_injection_risk",
    file: "test.js",
    startLine: 1,
    endLine: 1,
    classificationConfidence: "high",
    ruleId: "sql-injection",
    message: "SQL injection (test harness)",
    originalCode:
      "const sql = buildQuery('users', filters) + ' AND role = ' + userInput;",
    explanation: "Test harness finding for generateSqlInjectionFix.",
    classificationScore: 50,
  };

  const fix = await generateSqlInjectionFix(finding, { dialect: "mysql" });

  console.log("fixedCode:", fix.fixedCode);
  console.log("confidence:", fix.confidence);
  console.log("patchQuality:", fix.patchQuality);
  console.log(
    "patchWarnings:",
    fix.patchWarnings.length ? fix.patchWarnings : "(none)"
  );
}

main().catch(console.error);
