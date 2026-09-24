/**
 * Witness: a scan that cannot record its spend stops spending.
 *
 * `checkBudget` sums `cost_ledger`, so a priced model call whose ledger
 * row was not written is spend the cap never sees. callClaude used to
 * catch that failure, warn and carry on. This is the write-side twin of
 * test-budget-fail-closed.ts, and it proves on the real code paths:
 *
 *   A. callClaude, one scan: after a ledger write fails, the paid call's
 *      result is still returned, and no later model call reaches the
 *      transport; the refused calls answer `spend_unrecorded`.
 *   B. callClaude, retry: a call already waiting to retry when another
 *      call's ledger write fails does not retry.
 *   C. The flag is per scan: a concurrent scan whose ledger works keeps
 *      calling; outside any scan (offline tools) nothing is recorded and
 *      nothing is refused, as before.
 *   D. The PR webhook handler: a failed scan_runs insert, or a failed
 *      `running` update, refuses the scan before any model call; the
 *      comment says the commit was not scanned. A ledger failure mid-scan
 *      stops later calls, finishes the row `incomplete` with code
 *      `spend_unrecorded` and the scan's full cost, and the comment is
 *      never a clean report. With a working ledger the same PR is scanned
 *      with more calls, so the cut above is real, not vacuous.
 *   E. POST /api/v1/scan (api-scan.ts): an org with no installation is
 *      refused before the workflow; a ledger failure mid-scan answers 503
 *      with no findings, never 200.
 *
 * Keyless and $0 by construction: no Anthropic key and no client exist in
 * this process (asserted before anything runs). callClaude's transport and
 * ledger writer are replaced through `setCallClaudeTestDeps`, so the real
 * callClaude control flow runs against a stand-in that never opens a
 * socket. DATABASE_URL is unset, dryRun keeps the GitHub comment local, and
 * Cloudinary is unconfigured.
 *
 * Run: npm run test:ledger-fail-closed
 */

// Before any import: nothing in this process may reach a paid or live
// service, whatever the shell environment holds.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.FIXOR_PARKED_KEY;
delete process.env.DATABASE_URL;
delete process.env.GITHUB_TOKEN;
delete process.env.FIXOR_BUDGET_EXEMPT_INSTALLATIONS;
delete process.env.FIXOR_PILOT_ENABLED;
delete process.env.FIXOR_ESCALATE_MEDIUM;
delete process.env.CLOUDINARY_CLOUD_NAME;
delete process.env.CLOUDINARY_API_KEY;
delete process.env.CLOUDINARY_API_SECRET;

import * as fs from "fs";
import * as path from "path";
import type { Message } from "@anthropic-ai/sdk/resources/messages";

import {
  callClaude,
  getAnthropicClient,
  setCallClaudeTestDeps,
  type MessagesCallOptions,
  type MessagesCallResult,
} from "../analysis-engine/anthropic-client";
import { costContext, type CostContextStore } from "../lib/cost-context";
import { handlePullRequestWebhook } from "../integrations/github/pr-webhook-handler";
import type { BudgetCheck } from "../services/cost-store";
import type {
  ScanRunCreateResult,
  ScanRunOutcome,
  ScanRunStart,
  ScanRunStore,
} from "../services/scan-run-store";
import { runApiScan } from "../server/api-scan";
import type { WorkflowResult } from "../types/workflow.types";

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    failures++;
  } else {
    console.log(`[ok]   ${msg}`);
  }
}
function assertEq<T>(actual: T, expected: T, msg: string): void {
  assert(
    Object.is(actual, expected),
    `${msg} (expected ${String(expected)}, got ${String(actual)})`,
  );
}
function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

// ---- the stand-in transport and ledger ----------------------------------

/** Ordered log of what reached the transport and the ledger. */
let events: string[] = [];
let ledgerRows = 0;
/** Ledger writes numbered from 1; this one and every later one throw. */
let failLedgerFromWrite = Infinity;
let ledgerWrites = 0;
/** Transport calls that throw a retryable 503 before succeeding. */
let transientFailuresLeft = 0;

function cannedMessage(): Message {
  return {
    id: "msg_ledger_fail_closed",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text: "canned" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    // Priced: a non-zero cost, so every call is a ledger write.
    usage: {
      input_tokens: 1000,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as unknown as Message;
}

function resetStandIn(opts: { failLedgerFrom?: number; transient?: number } = {}): void {
  events = [];
  ledgerRows = 0;
  ledgerWrites = 0;
  failLedgerFromWrite = opts.failLedgerFrom ?? Infinity;
  transientFailuresLeft = opts.transient ?? 0;
}

function installStandIn(): void {
  setCallClaudeTestDeps({
    async create() {
      events.push("create");
      if (transientFailuresLeft > 0) {
        transientFailuresLeft--;
        throw Object.assign(new Error("overloaded"), { status: 503 });
      }
      // One macrotask, so concurrent calls interleave the way network
      // calls do.
      await new Promise((r) => setTimeout(r, 5));
      return cannedMessage();
    },
    async recordCost() {
      ledgerWrites++;
      if (ledgerWrites >= failLedgerFromWrite) {
        events.push("ledger-fail");
        throw new Error("ledger insert refused (stand-in)");
      }
      events.push("ledger-ok");
      ledgerRows++;
    },
  });
}

/** Model calls that reached the transport after the first ledger failure. */
function createsAfterFirstFailure(): number {
  const at = events.indexOf("ledger-fail");
  if (at < 0) return 0;
  return events.slice(at + 1).filter((e) => e === "create").length;
}
function creates(): number {
  return events.filter((e) => e === "create").length;
}

const OPTS: MessagesCallOptions = {
  model: "claude-sonnet-4-6",
  system: "ledger fail-closed witness",
  messages: [{ role: "user", content: "canned" }],
  callerId: "test:ledger-fail-closed",
};

// ---- preconditions -------------------------------------------------------

function testPreconditions(): void {
  section("0. keyless: no key, no client, no replay");
  assert(process.env.ANTHROPIC_API_KEY === undefined, "ANTHROPIC_API_KEY is unset");
  assert(process.env.FIXOR_PARKED_KEY === undefined, "FIXOR_PARKED_KEY is unset");
  assert(!process.env.FIXOR_REPLAY && !process.env.FIXOR_RECORD, "FIXOR_REPLAY and FIXOR_RECORD are unset");
  setCallClaudeTestDeps(null);
  assertEq(getAnthropicClient(), null, "no Anthropic client can be constructed in this process");
}

// ---- A. one scan ---------------------------------------------------------

async function testSequentialStop(): Promise<void> {
  section("A. callClaude: the call after a failed ledger write is refused");
  resetStandIn({ failLedgerFrom: 2 });
  const store: CostContextStore = { installationId: "42", scanSpend: { usd: 0 } };
  const results: MessagesCallResult[] = [];
  await costContext.run(store, async () => {
    for (let i = 0; i < 4; i++) results.push(await callClaude(OPTS));
  });
  assert(results[0]?.ok === true, "call 1: ledger written, result returned");
  assert(results[1]?.ok === true, "call 2: paid, so its result is returned though its ledger write failed");
  const refused = results.slice(2);
  assert(
    refused.length === 2 && refused.every((r) => !r.ok && r.reason === "spend_unrecorded"),
    "calls 3 and 4 are refused with reason spend_unrecorded",
  );
  assertEq(creates(), 2, "exactly two model calls reached the transport");
  assertEq(createsAfterFirstFailure(), 0, "no model call reached the transport after the ledger failed");
  assertEq(ledgerRows, 1, "one ledger row written");
  assertEq(store.ledgerWriteFailed, true, "the scan's store is marked");
  assert((store.scanSpend?.usd ?? 0) > 0, "the scan's own total still counts the unrecorded call");
}

// ---- B. retry --------------------------------------------------------------

async function testRetryStops(): Promise<void> {
  section("B. callClaude: a call waiting to retry does not retry once the ledger failed");
  resetStandIn({ failLedgerFrom: 1, transient: 1 });
  const store: CostContextStore = { installationId: "42", scanSpend: { usd: 0 } };
  let retrying: MessagesCallResult | undefined;
  let other: MessagesCallResult | undefined;
  await costContext.run(store, async () => {
    // The first create throws a retryable 503 and backs off about 1 s;
    // meanwhile the second call is paid and its ledger write fails.
    const a = callClaude(OPTS).then((r) => (retrying = r));
    const b = callClaude(OPTS).then((r) => (other = r));
    await Promise.all([a, b]);
  });
  assert(other?.ok === true, "the paid call returns its result");
  assert(
    retrying !== undefined && !retrying.ok && retrying.reason === "spend_unrecorded",
    "the waiting call answers spend_unrecorded instead of retrying",
  );
  assertEq(creates(), 2, "two transport calls: the failed attempt and the paid call, no retry");
  assertEq(createsAfterFirstFailure(), 0, "no model call reached the transport after the ledger failed");
}

// ---- C. scope --------------------------------------------------------------

async function testScope(): Promise<void> {
  section("C. the flag stops one scan only; outside a scan nothing changes");
  resetStandIn();
  const broken: CostContextStore = { installationId: "42", ledgerWriteFailed: true };
  const healthy: CostContextStore = { installationId: "43" };
  const [b, h] = await Promise.all([
    costContext.run(broken, () => callClaude(OPTS)),
    costContext.run(healthy, () => callClaude(OPTS)),
  ]);
  assert(!b.ok && b.reason === "spend_unrecorded", "the marked scan is refused");
  assert(h.ok, "a concurrent scan with a working ledger is not affected");
  assertEq(creates(), 1, "only the healthy scan reached the transport");
  assertEq(healthy.ledgerWriteFailed, undefined, "the healthy scan's store is not marked");

  resetStandIn({ failLedgerFrom: 1 });
  const offline = await callClaude(OPTS);
  const again = await callClaude(OPTS);
  assert(offline.ok && again.ok, "outside any scan, calls proceed (offline tools)");
  assertEq(ledgerWrites, 0, "outside any scan, nothing is written to the ledger");
}

// ---- D. the PR webhook handler ---------------------------------------------

const FIXTURES = [
  "fixtures/webhook-unverified/positive/01-stripe-no-sig.ts",
  "fixtures/env-exposure/positive/01-debug-env-route.ts",
  "fixtures/auth-bypass/positive/01-anon-bypass-delete.ts",
  "fixtures/webhook-unverified/positive/02-github-no-sig.ts",
  "fixtures/env-exposure/positive/02-error-handler-leaks-env.ts",
];

function newFileDiff(relPath: string, content: string): string {
  const lines = content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  return [
    `diff --git a/${relPath} b/${relPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${relPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
    "",
  ].join("\n");
}

const PR_DIFF = FIXTURES.map((f) => {
  const content = fs.readFileSync(path.join(process.cwd(), f), "utf8");
  const assumed = /ASSUMED-PATH:\s*(\S+)/.exec(content)?.[1] ?? `src/${path.basename(f)}`;
  return newFileDiff(assumed, content);
}).join("");

class FakeStore implements ScanRunStore {
  createThrows = false;
  runningThrows = false;
  created = 0;
  finished: ScanRunOutcome[] = [];
  async createPending(_start: ScanRunStart): Promise<ScanRunCreateResult> {
    if (this.createThrows) throw new Error("scan_runs insert refused (stand-in)");
    this.created++;
    return { created: true, id: "00000000-0000-4000-8000-000000000001" };
  }
  async markRunning(_id: string): Promise<void> {
    if (this.runningThrows) throw new Error("scan_runs update refused (stand-in)");
  }
  async finish(_id: string, outcome: ScanRunOutcome): Promise<void> {
    this.finished.push(outcome);
  }
}

const withinBudget = async (): Promise<BudgetCheck> => ({
  withinBudget: true,
  monthlySpend: 0,
  dailySpend: 0,
  caps: { monthlyCapUsd: 5, dailyCapUsd: 2 },
});

async function runHandler(store: FakeStore) {
  const samplePath = path.join(
    process.cwd(),
    "src/integrations/github/samples/pull_request.opened.sample.json",
  );
  const sample = JSON.parse(fs.readFileSync(samplePath, "utf8")) as Record<string, unknown>;
  const payload = { ...sample, installation: { id: 4242 } };
  return handlePullRequestWebhook({
    rawBody: JSON.stringify(payload),
    payload,
    dryRun: true,
    skipSignatureVerification: true,
    token: "unused",
    resolveSemgrep: () => PR_DIFF,
    workflowMetadata: { scanId: "ledger-fail-closed-witness" },
    checkBudgetImpl: withinBudget,
    scanRunStore: store,
    deliveryId: "11111111-2222-4333-8444-555555555555",
  });
}

function assertNotScannedComment(body: string, label: string): void {
  assert(body.includes("Fixor did not scan this commit"), `${label}: comment says the commit was not scanned`);
  assert(body.includes("could not record this scan's usage"), `${label}: comment names the cause`);
  assert(body.includes("This is not a clean result"), `${label}: comment says it is not a clean result`);
  assert(!body.includes("### Summary"), `${label}: no Summary table`);
  assert(!/database|DATABASE_URL|postgres|insert refused|stand-in/i.test(body), `${label}: no internal detail leaks`);
}

async function testHandler(): Promise<void> {
  section("D1. handler: scan_runs insert fails -> refused before any model call");
  resetStandIn();
  const s1 = new FakeStore();
  s1.createThrows = true;
  const r1 = await runHandler(s1);
  assert(r1.ok, "handler completes");
  assertEq(creates(), 0, "no model call reached the transport");
  if (r1.ok) {
    assertEq(r1.workflow.status, "spend_unrecordable", "workflow status is spend_unrecordable");
    assertNotScannedComment(r1.comment.body, "insert failed");
  }
  assertEq(s1.finished.length, 0, "no row to finish: the insert never happened");

  section("D2. handler: the `running` update fails -> refused before any model call");
  resetStandIn();
  const s2 = new FakeStore();
  s2.runningThrows = true;
  const r2 = await runHandler(s2);
  assertEq(creates(), 0, "no model call reached the transport");
  if (r2.ok) {
    assertEq(r2.workflow.status, "spend_unrecordable", "workflow status is spend_unrecordable");
    assertNotScannedComment(r2.comment.body, "running update failed");
  }
  assertEq(s2.finished.length, 1, "the row is finished once");
  assertEq(s2.finished[0]?.status, "skipped", "row status skipped");
  assertEq(s2.finished[0]?.code, "spend_unrecordable", "row code spend_unrecordable");
  assertEq(s2.finished[0]?.costUsd, 0, "row cost 0");

  section("D3. handler control: a working ledger scans the same PR");
  resetStandIn();
  const s3 = new FakeStore();
  const r3 = await runHandler(s3);
  const controlCreates = creates();
  assert(r3.ok, "handler completes");
  assert(controlCreates >= 2, `the PR makes at least two model calls (${controlCreates})`);
  assert(s3.finished[0]?.code !== "spend_unrecorded", "row code is not spend_unrecorded");

  section("D4. handler: the first ledger write fails -> later calls stop");
  resetStandIn({ failLedgerFrom: 1 });
  const s4 = new FakeStore();
  const r4 = await runHandler(s4);
  assert(r4.ok, "handler completes");
  const cutCreates = creates();
  assertEq(createsAfterFirstFailure(), 0, "no model call reached the transport after the ledger failed");
  assert(cutCreates < controlCreates, `fewer model calls than the control (${cutCreates} < ${controlCreates})`);
  assertEq(ledgerRows, 0, "no ledger row was written");
  assertEq(s4.finished.length, 1, "the row is finished once");
  assertEq(s4.finished[0]?.status, "incomplete", "row status incomplete");
  assertEq(s4.finished[0]?.code, "spend_unrecorded", "row code spend_unrecorded");
  assert((s4.finished[0]?.costUsd ?? 0) > 0, "row cost counts the unrecorded calls");
  if (r4.ok) {
    const wf = r4.workflow;
    assert(wf.status !== "success" && wf.status !== "no_action", `workflow is not a clean result (${wf.status})`);
    assert(
      (wf.llmCoverage?.byReason?.["spend_unrecorded"] ?? 0) > 0 ||
        (wf.detectorFailures?.length ?? 0) > 0,
      "the refused calls surface as degraded coverage",
    );
  }
}

// ---- E. POST /api/v1/scan --------------------------------------------------

async function threeCallWorkflow(): Promise<WorkflowResult> {
  for (let i = 0; i < 3; i++) await callClaude(OPTS);
  const now = new Date().toISOString();
  return {
    status: "no_action",
    automationReady: false,
    automationDecisionReason: "witness",
    totalFindings: 0,
    sqlInjectionFindings: 0,
    classifiedFindings: 0,
    skippedFindings: 0,
    fixesGenerated: 0,
    highQualityPatches: 0,
    mediumQualityPatches: 0,
    lowQualityPatches: 0,
    fixes: [],
    errors: [],
    metadata: {},
    timing: { startedAt: now, finishedAt: now, durationMs: 0 },
  };
}

async function testApiScan(): Promise<void> {
  const deps = {
    checkBudget: withinBudget,
    runWorkflow: () => threeCallWorkflow(),
  };

  section("E1. api scan: org with no installation -> refused before the workflow");
  resetStandIn();
  let ran = false;
  const e1 = await runApiScan(null, "diff", { scanId: "t" }, {
    checkBudget: withinBudget,
    runWorkflow: async () => {
      ran = true;
      return threeCallWorkflow();
    },
  });
  assertEq(e1.status, 503, "answers 503");
  assertEq((e1.body as { error?: string }).error, "spend_unrecordable", "error spend_unrecordable");
  assertEq(ran, false, "the workflow never ran");
  assertEq(creates(), 0, "no model call reached the transport");

  section("E2. api scan: a ledger failure mid-scan -> 503, no findings, later calls stopped");
  resetStandIn({ failLedgerFrom: 1 });
  const e2 = await runApiScan("4242", "diff", { scanId: "t" }, deps);
  assertEq(e2.status, 503, "answers 503, never 200");
  assertEq((e2.body as { error?: string }).error, "spend_unrecorded", "error spend_unrecorded");
  assert(!("fixes" in (e2.body as object)), "no findings in the body");
  assertEq(creates(), 1, "one model call, then the rest refused");
  assertEq(createsAfterFirstFailure(), 0, "no model call reached the transport after the ledger failed");

  section("E3. api scan control: a working ledger answers 200");
  resetStandIn();
  const e3 = await runApiScan("4242", "diff", { scanId: "t" }, deps);
  assertEq(e3.status, 200, "answers 200");
  assertEq(creates(), 3, "all three model calls ran");
  assertEq(ledgerRows, 3, "three ledger rows written");
}

async function main(): Promise<void> {
  testPreconditions();
  installStandIn();
  const sections: Array<[string, () => Promise<void>]> = [
    ["A", testSequentialStop],
    ["B", testRetryStops],
    ["C", testScope],
    ["D", testHandler],
    ["E", testApiScan],
  ];
  for (const [name, fn] of sections) {
    try {
      await fn();
    } catch (err) {
      failures++;
      console.error(`[FAIL] section ${name} threw: ${err instanceof Error ? err.stack : String(err)}`);
    }
  }
  setCallClaudeTestDeps(null);
  console.log(failures === 0 ? "\nPASS test-ledger-fail-closed" : `\nFAIL test-ledger-fail-closed: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
