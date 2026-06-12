/**
 * H2 whole-file scan input test (deterministic, no LLM spend, no DB).
 *
 * Proves the webhook path now feeds detectors the SAME whole-file
 * synthetic-diff conditions every baseline was measured under, with
 * real file line anchors, and that the introduced/pre-existing
 * partition + degraded-input signals behave per the documented
 * product decision.
 *
 * The end-to-end case runs the REAL webhook handler with a mocked file
 * fetch and no ANTHROPIC_API_KEY: secrets-exposure's regex-only default
 * (Option G) produces genuine findings keylessly, so the assertion
 * chain handler → enrichment → detector → partition → PR comment is
 * exercised without a single token.
 *
 * Run via: npm run test:whole-file-input
 */

// Keyless on purpose: LLM-gated detectors fail fast to no_api_key (their
// failures surface via the coverage gate, which this test tolerates);
// secrets-exposure judges by regex alone.
delete process.env.ANTHROPIC_API_KEY;

import {
  buildWholeFileScanInput,
  parseScanDiff,
  splitDiffParts,
} from "../integrations/github/whole-file-scan-input";
import {
  partitionFindingsByChangedLines,
  POST_WINDOW,
  PRE_WINDOW,
} from "../workflows/changed-line-partition";
import { parseDiff } from "../analysis-engine/detectors/shared/diff-parser";
import { buildPullRequestCommentMarkdown } from "../integrations/github/comment-builder";
import { handlePullRequestWebhook } from "../integrations/github/pr-webhook-handler";
import { runAuditorWorkflow } from "../workflows/auditor-workflow";
import type { NormalizedFinding } from "../analysis-engine/detector.types";
import type { WorkflowResult } from "../types/workflow.types";
import * as fs from "fs";
import * as path from "path";

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    failures++;
  } else {
    console.log(`[PASS] ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${msg} (expected ${e}, got ${a})`);
}

// Fragmented so the repo's own secret scan never sees a whole key
// in source; the detector scans the RUNTIME-assembled content.
const FAKE_KEY = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_");

function makeFile(keyLine: number | null, keySuffix: string): string {
  const lines: string[] = [];
  for (let i = 1; i <= 40; i++) {
    if (i === keyLine) lines.push(`const key${keySuffix} = "${FAKE_KEY}${keySuffix}";`);
    else lines.push(`const filler${i} = ${i};`);
  }
  return lines.join("\n") + "\n";
}

// billing.ts: the PR ADDS a secret at line 2 (introduced).
// legacy.ts: the PR edits an innocent line 2; a secret sits UNCHANGED
// at line 30 — invisible to the legacy added-lines path, found only
// via whole-file context, and outside the partition window
// (30 - PRE_WINDOW > 2) → pre-existing.
//
// DISCOVERED COUPLING (documented, deliberately not worked around in
// product code): the one-finding-per-file ceiling (Phase H gap G3)
// applies to secrets-exposure too — a SAME-file introduced +
// pre-existing pair from the same detector collapses to one finding
// until H6 lifts the ceiling. Hence two files here; H6's multi-finding
// work should add the same-file pair as its proving fixture.
const FULL_FILE = makeFile(2, "A");
const LEGACY_FILE = makeFile(30, "B");

const PR_DIFF = [
  "diff --git a/src/config/billing.ts b/src/config/billing.ts",
  "index 1111111..2222222 100644",
  "--- a/src/config/billing.ts",
  "+++ b/src/config/billing.ts",
  "@@ -1,3 +1,3 @@",
  " const filler1 = 1;",
  `+const keyA = "${FAKE_KEY}A";`,
  " const filler3 = 3;",
  "diff --git a/src/config/legacy.ts b/src/config/legacy.ts",
  "index 5555555..6666666 100644",
  "--- a/src/config/legacy.ts",
  "+++ b/src/config/legacy.ts",
  "@@ -1,3 +1,3 @@",
  " const filler1 = 1;",
  "+const filler2 = 2;",
  " const filler3 = 3;",
].join("\n");

const FILE_BY_PATH: Record<string, string> = {
  "src/config/billing.ts": FULL_FILE,
  "src/config/legacy.ts": LEGACY_FILE,
};

const DELETION_ONLY_DIFF = [
  "diff --git a/src/guards.ts b/src/guards.ts",
  "index 3333333..4444444 100644",
  "--- a/src/guards.ts",
  "+++ b/src/guards.ts",
  "@@ -10,3 +10,2 @@",
  " function handler() {",
  "-  requireOwnership(req);",
  "   return db.get(id);",
].join("\n");

async function testEnrichment(): Promise<void> {
  console.log("\n--- 1. enrichment: detectors receive whole files ---");

  const out = await buildWholeFileScanInput(PR_DIFF, async (p) => FILE_BY_PATH[p]!);
  const legacy = parseScanDiff(out.diff).find((f) => f.path === "src/config/legacy.ts");
  assert(legacy !== undefined, "enriched diff includes the legacy file");
  assertEq(
    legacy!.content.split("\n").length,
    40,
    "detector-visible content is the WHOLE 40-line file, not the 1-line slice",
  );
  assert(
    legacy!.content.includes(`keyB = "${FAKE_KEY}B"`),
    "unchanged code (line 30) is now visible to detectors",
  );
  assertEq(
    legacy!.lineMap[29],
    30,
    "identity lineMap: content line 30 IS file line 30 (baseline conditions)",
  );
  assertEq(out.changedLinesByPath["src/config/billing.ts"], [2], "changed lines = real file line 2");
  assertEq(
    out.wholeFilePaths.sort(),
    ["src/config/billing.ts", "src/config/legacy.ts"],
    "both files upgraded",
  );
  assertEq(out.scanInputErrors, [], "no degraded-input errors on success");
}

async function testFallbacks(): Promise<void> {
  console.log("\n--- 2. fetch failure / over-cap fallbacks ---");

  const failed = await buildWholeFileScanInput(PR_DIFF, async () => {
    throw new Error("404 not found");
  });
  const legacyView = parseDiff(PR_DIFF);
  const fallbackView = parseDiff(failed.diff);
  assertEq(
    fallbackView.map((f) => ({ path: f.path, content: f.content, lineMap: f.lineMap })),
    legacyView.map((f) => ({ path: f.path, content: f.content, lineMap: f.lineMap })),
    "fetch failure: scan falls back to the EXACT pre-H2 diff slice (nothing lost)",
  );
  assertEq(failed.scanInputErrors.length, 2, "every failed fetch recorded as degraded scan input");
  assert(
    failed.scanInputErrors[0]!.reason.includes("404"),
    "failure reason carried for diagnostics",
  );
  assertEq(
    failed.fallbackPaths.sort(),
    ["src/config/billing.ts", "src/config/legacy.ts"],
    "fallback paths recorded",
  );

  const overCap = await buildWholeFileScanInput(
    PR_DIFF,
    async (p) => FILE_BY_PATH[p]!,
    { maxFileBytes: 10 },
  );
  assertEq(overCap.scanInputErrors, [], "over-cap is a fallback, NOT a degraded-input error");
  assertEq(
    overCap.fallbackPaths.sort(),
    ["src/config/billing.ts", "src/config/legacy.ts"],
    "over-cap falls back to slice",
  );
}

async function testDeletionOnly(): Promise<void> {
  console.log("\n--- 3. deletion-only files ---");

  const parts = splitDiffParts(DELETION_ONLY_DIFF);
  assertEq(parts[0]!.changedLines, [11], "deletion anchored at the new-side line it vacated");
  assertEq(parts[0]!.hasAddedLines, false, "deletion-only part recognized");

  const guardsFile = 'function handler() {\n  return db.get(id);\n}\n';
  const ok = await buildWholeFileScanInput(DELETION_ONLY_DIFF, async () => guardsFile);
  const [file] = parseScanDiff(ok.diff);
  assert(
    file !== undefined && file.path === "src/guards.ts",
    "deletion-only file IS scanned whole-file (legacy path dropped it entirely)",
  );

  const failedDel = await buildWholeFileScanInput(DELETION_ONLY_DIFF, async () => {
    throw new Error("403");
  });
  assertEq(
    parseScanDiff(failedDel.diff).length,
    0,
    "deletion-only + fetch failure: nothing to scan (no slice exists)",
  );
  assertEq(
    failedDel.scanInputErrors.length,
    1,
    "…but the gap is recorded as degraded scan input, never silent",
  );
}

function sampleFinding(file: string, line: number): NormalizedFinding {
  return {
    detectorId: "secrets-exposure-multi",
    type: "secrets_exposure_risk",
    file,
    startLine: line,
    endLine: line,
    originalCode: "x",
    ruleId: "r",
    message: `finding at ${line}`,
    explanation: "e",
    confidence: "high",
    severity: "critical",
  };
}

function testPartition(): void {
  console.log("\n--- 4. introduced/pre-existing partition ---");

  const changed = { "a.ts": [45], "b.ts": [200] };
  const anchoredAbove = sampleFinding("a.ts", 43); // change 2 lines below anchor
  const farAway = sampleFinding("b.ts", 10); // change 190 lines below
  const unmapped = sampleFinding("c.ts", 7); // file not in map

  const { introduced, preExisting } = partitionFindingsByChangedLines(
    [anchoredAbove, farAway, unmapped],
    changed,
  );
  assertEq(
    introduced.map((f) => f.file),
    ["a.ts", "c.ts"],
    `anchor-above-change (within +${POST_WINDOW}) and unmapped files fail toward INTRODUCED`,
  );
  assertEq(preExisting.map((f) => f.file), ["b.ts"], "far finding partitioned pre-existing");

  const justInside = sampleFinding("a.ts", 45 + PRE_WINDOW);
  const { introduced: i2 } = partitionFindingsByChangedLines([justInside], changed);
  assertEq(i2.length, 1, `finding ${PRE_WINDOW} below a changed line still introduced`);
}

async function testWorkflowDegradedInput(): Promise<void> {
  console.log("\n--- 5. degraded scan input reaches the status machine ---");

  const result = await runAuditorWorkflow({
    diff: PR_DIFF,
    changedLinesByPath: {},
    scanInputErrors: [{ path: "x.ts", reason: "404" }],
  });
  assert(
    result.errors.some((e) => /scan input degraded: x\.ts/i.test(e.message)),
    "scan-input error surfaced as WorkflowError",
  );
  assert(
    result.status !== "no_action" && result.status !== "success",
    `degraded scan input can never present clean (got "${result.status}")`,
  );
}

async function testEndToEndHandler(): Promise<void> {
  console.log("\n--- 6. end-to-end webhook handler (regex-only findings, $0) ---");

  const samplePath = path.join(
    process.cwd(),
    "src/integrations/github/samples/pull_request.opened.sample.json",
  );
  const raw = fs.readFileSync(samplePath, "utf8");
  const payload = JSON.parse(raw) as unknown;

  const result = await handlePullRequestWebhook({
    rawBody: raw,
    payload,
    dryRun: true,
    skipSignatureVerification: true,
    resolveSemgrep: () => PR_DIFF,
    fetchFileAtRefImpl: async (p) => FILE_BY_PATH[p]!,
    workflowMetadata: { scanId: "h2-deterministic-test" },
  });

  assert(result.ok, "handler completes");
  if (!result.ok) return;
  const wf: WorkflowResult = result.workflow;

  const pre = wf.preExistingFindings ?? [];
  assert(
    pre.some((f) => f.file === "src/config/legacy.ts" && f.startLine === 30),
    "UNCHANGED line-30 secret found via whole-file context and partitioned PRE-EXISTING at its true line",
  );
  assert(
    !pre.some((f) => f.file === "src/config/billing.ts"),
    "the PR-introduced billing.ts secret is NOT in the pre-existing bucket",
  );
  assert(
    wf.classifiedFindings >= 1,
    "introduced finding routed first-class (fix generation path)",
  );
  assert(
    result.comment.body.includes("pre-existing issue") &&
      result.comment.body.includes("src/config/legacy.ts:30"),
    "PR comment renders the collapsed pre-existing section with the true line anchor",
  );
}

function testCommentRendering(): void {
  console.log("\n--- 7. comment rendering caps and absence ---");

  const shell: WorkflowResult = {
    status: "no_action",
    automationReady: false,
    automationDecisionReason: "",
    totalFindings: 12,
    sqlInjectionFindings: 0,
    classifiedFindings: 0,
    skippedFindings: 0,
    fixesGenerated: 0,
    highQualityPatches: 0,
    mediumQualityPatches: 0,
    lowQualityPatches: 0,
    fixes: [],
    errors: [],
    preExistingFindings: Array.from({ length: 12 }, (_, i) =>
      sampleFinding("legacy.ts", i + 1),
    ),
    metadata: {},
    timing: { startedAt: "", finishedAt: "", durationMs: 0 },
  };
  const md = buildPullRequestCommentMarkdown(
    { owner: "o", repo: "r", pullNumber: 1 },
    shell,
  );
  assert(md.includes("12 pre-existing issues"), "count rendered");
  assert(md.includes("…and 2 more"), "render capped at 10 with remainder note");

  const clean = buildPullRequestCommentMarkdown(
    { owner: "o", repo: "r", pullNumber: 1 },
    { ...shell, preExistingFindings: undefined, totalFindings: 0 },
  );
  assert(!clean.includes("pre-existing"), "no block when nothing pre-existing");
}

async function main(): Promise<void> {
  await testEnrichment();
  await testFallbacks();
  await testDeletionOnly();
  testPartition();
  await testWorkflowDegradedInput();
  await testEndToEndHandler();
  testCommentRendering();

  console.log(
    failures === 0
      ? "\nWhole-file scan input test: PASS."
      : `\nWhole-file scan input test: ${failures} FAILURE(S).`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
