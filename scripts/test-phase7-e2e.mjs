#!/usr/bin/env node
// scripts/test-phase7-e2e.mjs
// Phase 7 wiring smoke test.
//
// Feeds runAuditorWorkflow a 2-file synthetic diff (one auth-bypass
// positive + one secrets-exposure positive) and verifies the Phase 5
// detectors actually fire in the production webhook code path —
// surfaced via fix.detectorId.
//
// Cost: ~$0.014 typical (1 analyzeCode + 2 Phase 5 LLM hits + 1 SQL
// fix LLM call). Time: ~10-15s.
//
// Exit code: 0 on PASS, 1 on FAIL (chainable as a future test:real).

import { runAuditorWorkflow } from "../dist/workflows/auditor-workflow.js";

const PHASE5_IDS = new Set([
  "auth-bypass-multi",
  "secrets-exposure-multi",
  "webhook-unverified-multi",
  "env-exposure-multi",
  "admin-check-multi",
]);

// File 1: auth-bypass positive.
// Live runtime path (src/server/...) so it does NOT trip path filter.
// userId === "anonymous" causes the WHERE clause to drop the ownership
// predicate -> auth-bypass detector should flag HIGH.
const file1Lines = [
  'import { Request, Response } from "express";',
  'import { Pool } from "pg";',
  "const pool = new Pool();",
  "export async function deleteNote(req, res) {",
  '  const userId = req.session?.userId ?? "anonymous";',
  "  const id = req.params.id;",
  '  const where = userId === "anonymous" ? "" : `AND user_id=\'${userId}\'`;',
  "  await pool.query(`DELETE FROM notes WHERE id=$1 ${where}`, [id]);",
  "  res.json({ ok: true });",
  "}",
];

// File 2: secrets-exposure positive.
// "use client" + NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY -> service role
// key bundled into the client. Detector should flag HIGH.
const file2Lines = [
  '"use client";',
  'import { createClient } from "@supabase/supabase-js";',
  "const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;",
  "const KEY = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;",
  "const admin = createClient(URL, KEY);",
  "export default function AdminPanel() {",
  "  return null;",
  "}",
];

function buildSyntheticFile(path, lines) {
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => "+" + l),
  ].join("\n");
}

const diff =
  buildSyntheticFile("src/server/notes.ts", file1Lines) +
  "\n" +
  buildSyntheticFile("src/components/AdminPanel.tsx", file2Lines) +
  "\n";

const t0 = Date.now();
let result;
try {
  result = await runAuditorWorkflow(diff, {
    repoName: "phase7-e2e",
    scanId: "local",
  });
} catch (err) {
  process.stderr.write(
    `runAuditorWorkflow threw: ${(err && err.stack) || err}\n`,
  );
  process.exit(1);
}
const elapsedMs = Date.now() - t0;

const phase5Fixes = result.fixes.filter((f) => PHASE5_IDS.has(f.detectorId));
const authHit = result.fixes.some((f) => f.detectorId === "auth-bypass-multi");
const secretsHit = result.fixes.some(
  (f) => f.detectorId === "secrets-exposure-multi",
);
const PASS = authHit && secretsHit && result.totalFindings >= 2;

const report = {
  status: result.status,
  totalFindings: result.totalFindings,
  classifiedFindings: result.classifiedFindings,
  fixesGenerated: result.fixesGenerated,
  phase5FixCount: phase5Fixes.length,
  authBypassDetected: authHit,
  secretsExposureDetected: secretsHit,
  PASS,
  elapsedMs,
  allDetectorIds: result.fixes.map((f) => f.detectorId),
};

process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.exit(PASS ? 0 : 1);
