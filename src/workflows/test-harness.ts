import { runAuditorWorkflow } from "./auditor-workflow.js";

const FIXTURE_MALFORMED = {
  invalidField: "No results array here"
};

const FIXTURE_NO_FINDINGS = {
  results: []
};

const FIXTURE_SUCCESS = {
  results: [
    {
      check_id: "sql-injection",
      path: "src/api.js",
      start: { line: 42 },
      end: { line: 42 },
      extra: {
        message: "Found SQL injection",
        lines: "const query = 'SELECT * FROM users WHERE id = ' + req.body.id + ' LIMIT 1';"
      }
    },
    {
      check_id: "other-vuln",
      path: "src/util.js",
      start: { line: 10 },
      end: { line: 10 },
      extra: {
        message: "Some random issue",
        lines: "console.log('test');"
      }
    }
  ]
};

async function main() {
  console.log("=== Auditor AI Workflow Test Harness ===\n");

  console.log("--> Case 1: Malformed Payload");
  const result1 = await runAuditorWorkflow(FIXTURE_MALFORMED, { scanId: "scan-malformed-123" });
  console.log("\nFinal Result Case 1:\n", JSON.stringify(result1, null, 2));
  console.log("\n============================================\n");

  console.log("--> Case 2: No Findings (no_action)");
  const result2 = await runAuditorWorkflow(FIXTURE_NO_FINDINGS, { scanId: "scan-empty-456" });
  console.log("\nFinal Result Case 2:\n", JSON.stringify(result2, null, 2));
  console.log("\n============================================\n");

  console.log("--> Case 3: Successful fixes & skipping");
  const result3 = await runAuditorWorkflow(JSON.stringify(FIXTURE_SUCCESS), { scanId: "scan-success-789" });
  console.log("\nFinal Result Case 3:\n", JSON.stringify(result3, null, 2));
}

main().catch(console.error);
