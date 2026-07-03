/**
 * Customer-emission smoke test.
 *
 * Asserts that for a curated multi-pattern diff:
 *   A) workflow.fixes contains no entry of a SUPPRESSED_FINDING_TYPES type
 *      (since H3 this is structurally guaranteed — the central analyzeCode
 *      pass that produced sql/xss/cmdi/pt findings was removed; kept as a
 *      regression guard so a future re-wire can't silently emit them)
 *   B) workflow.fixes contains at least one of the measured Phase 5 types
 *      (idor_risk or auth_bypass_risk) — positive control that the pipeline
 *      actually executed end-to-end
 *   C) buildPullRequestCommentMarkdown output does not name any suppressed
 *      vulnerability family
 *   D) buildSarifLog output does not include rules for suppressed types
 *   E) generatePdfReport returns a non-trivial Buffer (renders without crash)
 *
 * Cost since H3: ~$0.30-0.50 per run (Phase 5 specialized detectors only;
 * the central analyzeCode Sonnet call per file was removed). NOT in
 * test:ci — paid, run manually with ANTHROPIC_API_KEY.
 */

import assert from "node:assert/strict";
import { runAuditorWorkflow } from "../workflows/auditor-workflow";
import { SUPPRESSED_FINDING_TYPES } from "../config/finding-suppressions";
import { buildPullRequestCommentMarkdown } from "../integrations/github/comment-builder";
import { buildSarifLog } from "../services/sarif-output.service";
import { generatePdfReport } from "../services/pdf-report.service";
import { metadataFor } from "../config/vulnerability-registry";

const DIFF = `diff --git a/src/api/legacy.js b/src/api/legacy.js
new file mode 100644
--- /dev/null
+++ b/src/api/legacy.js
@@ -0,0 +1,42 @@
+const express = require("express");
+const { exec } = require("child_process");
+const fs = require("fs");
+const app = express();
+app.use(express.json());
+
+// SQL injection — interpolated user input into raw query
+app.get("/users/:id", async (req, res) => {
+  const result = await db.query(\`SELECT * FROM users WHERE id = \${req.params.id}\`);
+  res.json(result.rows);
+});
+
+// XSS — unescaped user input into HTML response
+app.get("/greet", (req, res) => {
+  res.send("<h1>Hello " + req.query.name + "</h1>");
+});
+
+// Command injection — user input concatenated into shell exec
+app.get("/ping", (req, res) => {
+  exec("ping -c 1 " + req.query.host, (err, stdout) => {
+    res.send(stdout);
+  });
+});
+
+// Path traversal — user-controlled path joined into fs read
+app.get("/file", (req, res) => {
+  fs.readFile("/var/data/" + req.query.name, "utf8", (err, data) => {
+    res.send(data);
+  });
+});
+
+// Mass assignment — req.body spread into update
+app.put("/users/:id", async (req, res) => {
+  const user = await db.user.update({ where: { id: req.params.id }, data: req.body });
+  res.json(user);
+});
+
+// IDOR — no ownership check on resource lookup by client-supplied id
+app.get("/orders/:id", async (req, res) => {
+  const order = await db.order.findUnique({ where: { id: req.params.id } });
+  res.json(order);
+});
+
+// Auth bypass — destructive endpoint with no auth gate
+app.delete("/posts/:id", async (req, res) => {
+  await db.post.delete({ where: { id: req.params.id } });
+  res.json({ ok: true });
+});
`;

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stdout.write("SKIPPED: ANTHROPIC_API_KEY not set (opt-in live-LLM test). Set the key to run it live.\n");
    return;
  }

  process.stdout.write("[smoke] runAuditorWorkflow on curated multi-pattern diff...\n");
  const workflow = await runAuditorWorkflow(
    { diff: DIFF },
    {
      scanId: "smoke-suppression",
      repoName: "smoke/test",
      commitId: "smoketest0000",
    }
  );

  process.stdout.write(
    `[smoke] status=${workflow.status} totalFindings=${workflow.totalFindings} fixesGenerated=${workflow.fixesGenerated}\n`
  );
  const fixTypes = workflow.fixes.map((f) => f.findingType);
  process.stdout.write(`[smoke] fix types: ${fixTypes.join(", ") || "(none)"}\n`);

  if (workflow.status === "failed") {
    process.stderr.write(`[smoke] workflow failed: ${workflow.errors.map((e) => e.message).join("; ")}\n`);
    process.exit(1);
  }

  // A — workflow.fixes contains no suppressed type
  const fixTypeSet = new Set(fixTypes);
  for (const suppressed of SUPPRESSED_FINDING_TYPES) {
    assert(
      !fixTypeSet.has(suppressed),
      `[A] suppressed type ${suppressed} leaked into workflow.fixes`
    );
  }
  process.stdout.write("[smoke] A: workflow.fixes clean (no suppressed types)\n");

  // B — positive control: pipeline actually ran a Phase 5 detector
  const hasPositive = fixTypeSet.has("idor_risk") || fixTypeSet.has("auth_bypass_risk");
  assert(
    hasPositive,
    `[B] neither idor_risk nor auth_bypass_risk in fixes; Phase 5 pipeline did not exercise. Observed: ${[...fixTypeSet].join(", ") || "(empty)"}`
  );
  process.stdout.write("[smoke] B: positive control present (IDOR or auth-bypass detected)\n");

  // C — PR comment renders without crash and no fix-card title is a
  // suppressed family. (Substring match on the whole comment would be
  // wrong: an LLM-generated explanation can legitimately mention another
  // vuln family by analogy. The real leak surface is a fix-card section
  // for a suppressed type — that maps 1:1 to workflow.fixes via the
  // title `\`${family}\`` pattern, so checking workflow.fixes is enough.)
  const comment = buildPullRequestCommentMarkdown(
    { owner: "smoke", repo: "test", pullNumber: 1, commitSha: "smoketest0000" },
    workflow
  );
  assert(comment.length > 0, "[C] comment is empty");
  for (const suppressed of SUPPRESSED_FINDING_TYPES) {
    const familyName = metadataFor(suppressed).name;
    assert(
      !comment.includes("`" + familyName + "`"),
      `[C] suppressed family "${familyName}" rendered as fix-card title in PR comment`
    );
  }
  process.stdout.write(`[smoke] C: PR comment clean (${comment.length} chars)\n`);

  // D — SARIF rules array excludes suppressed types
  const sarif = buildSarifLog(workflow, {
    repoSlug: "smoke/test",
    commitSha: "smoketest0000",
  });
  const ruleIds = (sarif.runs[0]?.tool.driver.rules ?? []).map((r) => r.id);
  for (const suppressed of SUPPRESSED_FINDING_TYPES) {
    assert(
      !ruleIds.includes(suppressed),
      `[D] suppressed rule ${suppressed} appears in SARIF`
    );
  }
  process.stdout.write(`[smoke] D: SARIF clean (${ruleIds.length} rules: ${ruleIds.join(", ") || "none"})\n`);

  // E — PDF renders without crash, non-trivial size
  const pdf = await generatePdfReport(workflow, {
    owner: "smoke",
    repo: "test",
    pullNumber: 1,
    commitSha: "smoketest0000",
  });
  assert(Buffer.isBuffer(pdf), "[E] PDF is not a Buffer");
  assert(pdf.length > 1000, `[E] PDF length ${pdf.length}b is suspicious (<1KB)`);
  process.stdout.write(`[smoke] E: PDF renders (${pdf.length}b)\n`);

  process.stdout.write("\n[smoke] PASS\n");
}

main().catch((err) => {
  process.stderr.write(`[smoke] FAIL: ${(err as Error).message}\n`);
  if ((err as Error).stack) {
    process.stderr.write(`${(err as Error).stack}\n`);
  }
  process.exit(1);
});
