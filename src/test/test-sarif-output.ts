/**
 * Smoke test for SARIF output:
 *   1. Builds a synthetic WorkflowResult with two fixes.
 *   2. Runs buildSarifLog + sarifToJson.
 *   3. Parses the JSON back and asserts the structure we rely on for
 *      GitHub Code Scanning + IDE viewers.
 *
 * This test does NOT hit the network and is safe to run in CI.
 */

import { buildSarifLog, sarifToJson } from "../services/sarif-output.service";
import type { WorkflowResult } from "../types/workflow.types";
import type { SqlInjectionFixSuggestion } from "../types/vulnerability.types";

function fix(
  file: string,
  line: number,
  original: string,
  fixed: string
): SqlInjectionFixSuggestion {
  return {
    type: "SQL_INJECTION",
    findingType: "sql_injection_risk",
    file,
    line,
    originalCode: original,
    fixedCode: fixed,
    parameterValues: ["userId"],
    dialect: "mysql",
    explanation: "Replaced dynamic string concatenation with placeholders.",
    confidence: "high",
    patchQuality: "high",
    patchWarnings: [],
  };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
}

function run(): void {
  const workflow: WorkflowResult = {
    status: "success",
    automationReady: true,
    automationDecisionReason: "All patches high quality; no warnings",
    totalFindings: 2,
    sqlInjectionFindings: 2,
    skippedFindings: 0,
    fixesGenerated: 2,
    highQualityPatches: 2,
    mediumQualityPatches: 0,
    lowQualityPatches: 0,
    fixes: [
      fix(
        "src/users.js",
        42,
        "const q = `SELECT * FROM users WHERE id=${userId}`",
        "const q = 'SELECT * FROM users WHERE id = ?'"
      ),
      fix(
        "src/orders.js",
        17,
        "const q = \"SELECT * FROM orders WHERE id=\" + orderId",
        "const q = 'SELECT * FROM orders WHERE id = ?'"
      ),
    ],
    errors: [],
    metadata: { repoName: "acme/demo", commitId: "deadbeef" },
    timing: {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1234,
    },
  };

  const log = buildSarifLog(workflow, {
    repoSlug: "acme/demo",
    commitSha: "deadbeef",
  });
  const json = sarifToJson(log);
  const parsed = JSON.parse(json) as unknown as typeof log;

  assert(parsed.version === "2.1.0", "SARIF version must be 2.1.0");
  assert(parsed.runs.length === 1, "Expected exactly one run");
  const run = parsed.runs[0]!;
  assert(run.tool.driver.name === "Fixor", "Tool driver name must be Fixor");

  const rules = run.tool.driver.rules;
  assert(rules.length === 1, `Expected 1 rule, got ${rules.length}`);
  const rule = rules[0]!;
  assert(rule.id === "sql_injection_risk", "Rule id must match finding type");
  assert(rule.properties.cwe === "CWE-89", "SQL injection rule must map to CWE-89");
  assert(
    rule.properties.owaspTop10 === "A03:2021",
    "SQL injection rule must map to OWASP A03:2021"
  );
  assert(
    typeof rule.properties.cvssScore === "number" &&
      rule.properties.cvssScore > 0,
    "CVSS score must be present"
  );

  assert(run.results.length === 2, "Expected 2 results");
  const first = run.results[0]!;
  assert(first.ruleId === "sql_injection_risk", "result.ruleId mismatch");
  assert(
    first.locations[0]?.physicalLocation.region.startLine === 42,
    "startLine must match fix.line"
  );
  assert(
    first.fixes?.[0]?.artifactChanges[0]?.replacements[0]?.insertedContent.text.includes(
      "?"
    ),
    "SARIF fix must contain the parameterized rewrite"
  );
  assert(
    typeof first.partialFingerprints?.fixorFingerprintV1 === "string",
    "fingerprint missing"
  );

  console.log("[PASS] SARIF smoke test");
  console.log(`  rules: ${rules.length}, results: ${run.results.length}`);
}

run();
