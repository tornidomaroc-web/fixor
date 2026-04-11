/**
 * Local end-to-end demo: sample GitHub PR payload → Semgrep resolver → workflow → comment markdown (dry-run).
 *
 * Run from repo root: `npm run demo:github-pr-webhook`
 */
import * as fs from "fs";
import * as path from "path";
import { handlePullRequestWebhook } from "../pr-webhook-handler";

/** Minimal Semgrep-shaped payload for demo scoring (classifies as SQL injection). */
function sampleSemgrepPayload() {
  return {
    results: [
      {
        check_id: "javascript.lang.security.audit.sqli-nodejs-concat",
        path: "src/routes/users.js",
        start: { line: 14 },
        end: { line: 14 },
        extra: {
          message:
            "SQL injection: user input concatenated into query string",
          metadata: {
            category: "security",
            cwe: ["CWE-89: SQL Injection"],
            owasp: ["A03:2021 Injection"],
          },
          lines:
            "return db.query('SELECT * FROM profiles WHERE id = ' + userId + ' LIMIT 1');",
        },
      },
    ],
  };
}

async function main() {
  const samplePath = path.join(
    process.cwd(),
    "src",
    "integrations",
    "github",
    "samples",
    "pull_request.opened.sample.json"
  );

  if (!fs.existsSync(samplePath)) {
    console.error("Sample payload not found:", samplePath);
    process.exit(1);
  }

  const raw = fs.readFileSync(samplePath, "utf8");
  const payload = JSON.parse(raw) as unknown;

  const result = await handlePullRequestWebhook({
    rawBody: raw,
    payload,
    dryRun: true,
    skipSignatureVerification: true,
    resolveSemgrep: sampleSemgrepPayload,
    workflowMetadata: { scanId: "demo-local-scan" },
  });

  if (!result.ok) {
    console.error("Handler failed:", JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log("=== Fixor PR webhook demo (dry-run) ===\n");
  console.log(
    "Processed result:",
    JSON.stringify(
      {
        ok: result.ok,
        dryRun: result.dryRun,
        signatureState: result.signatureState,
        data: result.data,
        commentPosted: result.comment.commentPosted,
        commentAction: result.comment.commentAction,
        commentDryRun: result.comment.dryRun,
        workflowStatus: result.workflow.status,
        automationReady: result.workflow.automationReady,
        automationDecisionReason: result.workflow.automationDecisionReason,
        fixesGenerated: result.workflow.fixesGenerated,
      },
      null,
      2
    )
  );
  console.log("\n=== Markdown comment preview ===\n");
  console.log(result.comment.body);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
