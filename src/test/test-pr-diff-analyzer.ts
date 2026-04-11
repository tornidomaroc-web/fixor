import { analyzePrDiff } from "../services/pr-diff-analyzer";

async function main(): Promise<void> {
  (global as any).fetch = async () => ({
    ok: true,
    json: async () => [
      {
        filename: "src/routes/users.js",
        status: "modified",
        patch: [
          "@@ -10,7 +12,8 @@",
          " const express = require('express');",
          "-const old = 'removed line';",
          "+const query = 'SELECT * FROM users WHERE id = ' + req.params.id;",
          "+const safe = db.query('SELECT 1');",
        ].join("\n"),
      },
    ],
  });

  const findings = await analyzePrDiff("test-org", "test-repo", 1, "fake-token");

  console.log("findings count:", findings.length);
  for (const f of findings) {
    console.log({
      file: f.file,
      startLine: f.startLine,
      originalCode: f.originalCode,
      classificationConfidence: f.classificationConfidence,
    });
  }
}

main().catch(console.error);
