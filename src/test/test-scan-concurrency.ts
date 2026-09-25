/**
 * Witness: scans for one installation run one at a time, so a second scan's
 * budget read sees the first scan's spend; at most MAX_CONCURRENT_SCANS run
 * at once overall; the API scan path shares the same rule; and a scan that
 * waits in the queue is not timed while it waits.
 *
 * Tracker item 5b. `checkBudget` sums the ledger, so before this change N
 * deliveries for one installation that arrived together all read the same
 * headroom before any of them spent, and a positive cap could be overshot by
 * up to N scans. The webhook now acknowledges before scanning (#248), so a
 * burst would also have started that many scans at once.
 *
 * What runs is the real handler (accept and run halves), the real API scan
 * path and the real queue (lib/scan-queue.ts). The "scan" is the regex-only
 * secrets detector on a fixed diff, run in dry-run with a placeholder token,
 * so nothing reaches GitHub or a model; the budget gate is a stub that
 * refuses once a shared counter says the first scan has spent.
 *
 * Fails on main: both scans run there (the counter reaches 2), five
 * deliveries run five at once, and the API path lets both requests through.
 *
 * Keyless and $0: no Anthropic key and no client (asserted first), no
 * database, no network.
 */
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DATABASE_URL;
delete process.env.GITHUB_TOKEN;
delete process.env.FIXOR_BUDGET_EXEMPT_INSTALLATIONS;
delete process.env.FIXOR_PILOT_ENABLED;
delete process.env.CLOUDINARY_CLOUD_NAME;
delete process.env.CLOUDINARY_API_KEY;
delete process.env.CLOUDINARY_API_SECRET;
delete process.env.SENTRY_DSN;

import { randomUUID } from "node:crypto";
import * as fs from "fs";
import * as path from "path";

import { getAnthropicClient } from "../analysis-engine/anthropic-client";
import {
  acceptPullRequestDelivery,
  handlePullRequestWebhook,
  type HandlePullRequestWebhookOptions,
} from "../integrations/github/pr-webhook-handler";
import { MAX_CONCURRENT_SCANS, ScanQueue, scanQueue } from "../lib/scan-queue";
import { runApiScan } from "../server/api-scan";
import { routeGitHubWebhook } from "../server/github-webhook-route";
import type { BudgetCheck } from "../services/cost-store";
import type {
  ScanRunCreateResult,
  ScanRunOutcome,
  ScanRunStart,
  ScanRunStore,
} from "../services/scan-run-store";
import type { WorkflowResult } from "../types/workflow.types";

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
const sectionsRun: string[] = [];
function section(name: string): void {
  sectionsRun.push(name);
  console.log(`\n--- ${name} ---`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- fixtures ------------------------------------------------------------------

const FAKE_KEY = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_");
const PR_DIFF = [
  "diff --git a/src/config/payments.ts b/src/config/payments.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/config/payments.ts",
  "@@ -0,0 +1,3 @@",
  '+export const region = "eu";',
  `+export const stripeKey = "${FAKE_KEY}W";`,
  "+export const retries = 3;",
  "",
].join("\n");
const SAMPLE = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "src/integrations/github/samples/pull_request.opened.sample.json"), "utf8"),
) as Record<string, unknown>;
const WITHIN: BudgetCheck = { withinBudget: true, monthlySpend: 0.1, dailySpend: 0.05, caps: { monthlyCapUsd: 5, dailyCapUsd: 2 } };
const EXCEEDED: BudgetCheck = { withinBudget: false, reason: "monthly_exceeded", monthlySpend: 5.04, dailySpend: 0.4, caps: { monthlyCapUsd: 5, dailyCapUsd: 2 } };

interface MemRow extends ScanRunStart { id: string; status: string; code: string | null; finishedAt: Date | null }
class MemoryStore implements ScanRunStore {
  rows = new Map<string, MemRow>();
  async createPending(s: ScanRunStart): Promise<ScanRunCreateResult> {
    const id = randomUUID();
    this.rows.set(id, { ...s, id, status: "pending", code: null, finishedAt: null });
    return { created: true, id };
  }
  async markRunning(id: string): Promise<void> {
    const r = this.rows.get(id);
    if (r && r.status === "pending") r.status = "running";
  }
  async finish(id: string, o: ScanRunOutcome, at: Date): Promise<void> {
    const r = this.rows.get(id);
    if (!r || r.finishedAt !== null) return;
    Object.assign(r, { status: o.status, code: o.code, finishedAt: at });
  }
  outcomes(): string[] {
    return [...this.rows.values()].map((r) => `${r.status}/${r.code ?? "-"}`).sort();
  }
}

/**
 * A cap of exactly one scan: the gate refuses once `spent` says a scan has
 * run. Whether the second scan sees that depends only on ordering.
 */
function oneScanCap() {
  const state = { spent: 0, peak: 0, inFlight: 0 };
  const checkBudgetImpl = async () => (state.spent >= 1 ? EXCEEDED : WITHIN);
  const resolveSemgrep = async () => {
    state.spent++;
    state.inFlight++;
    state.peak = Math.max(state.peak, state.inFlight);
    await sleep(30);
    state.inFlight--;
    return PR_DIFF;
  };
  return { state, checkBudgetImpl, resolveSemgrep };
}

function delivery(
  store: ScanRunStore,
  installationId: number,
  extra: Partial<HandlePullRequestWebhookOptions>,
): HandlePullRequestWebhookOptions {
  const payload = { ...SAMPLE, installation: { id: installationId } };
  return {
    rawBody: JSON.stringify(payload),
    payload,
    dryRun: true,
    skipSignatureVerification: true,
    updateExisting: true,
    // A placeholder token: dry-run never sends it, and no installation
    // token is minted.
    token: "unused",
    workflowMetadata: { scanId: "scan-concurrency-witness" },
    deliveryId: randomUUID(),
    scanRunStore: store,
    ...extra,
  };
}

// ---- sections ------------------------------------------------------------------

async function testSameInstallationSerial(): Promise<void> {
  section("A. two deliveries for one installation, a cap of one scan: exactly one scans");
  const store = new MemoryStore();
  const cap = oneScanCap();
  const opts = { checkBudgetImpl: cap.checkBudgetImpl, resolveSemgrep: cap.resolveSemgrep };
  const [r1, r2] = await Promise.all([
    handlePullRequestWebhook(delivery(store, 3101, opts)),
    handlePullRequestWebhook(delivery(store, 3101, opts)),
  ]);
  const statuses = [r1, r2].map((r) => (r.ok ? r.workflow.status : `not ok: ${r.error}`)).sort();
  console.log(`       scans run: ${cap.state.spent}; workflow statuses ${JSON.stringify(statuses)}; rows ${JSON.stringify(store.outcomes())}`);
  assertEq(cap.state.spent, 1, "the second scan never ran: its budget read saw the first scan's spend");
  assertEq(store.outcomes(), ["completed/-", "skipped/budget_exceeded"], "one row completed, one skipped as budget_exceeded");
  assert(statuses.includes("budget_exceeded"), "the refused delivery got the budget-reached outcome");
}

async function testDifferentInstallationsBounded(): Promise<void> {
  section("B. five deliveries for five installations run at most maxConcurrent at once");
  for (const [limit, wantPeak] of [[2, 2], [5, 5]] as const) {
    const store = new MemoryStore();
    const queue = new ScanQueue(limit);
    const state = { peak: 0, inFlight: 0 };
    const resolveSemgrep = async () => {
      state.inFlight++;
      state.peak = Math.max(state.peak, state.inFlight);
      await sleep(40);
      state.inFlight--;
      return PR_DIFF;
    };
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        handlePullRequestWebhook(delivery(store, 4000 + n, { checkBudgetImpl: async () => WITHIN, resolveSemgrep, scanQueue: queue })),
      ),
    );
    console.log(`       maxConcurrent ${limit}: peak concurrency ${state.peak}; completed ${results.filter((r) => r.ok).length}/5; rows ${JSON.stringify(store.outcomes())}`);
    assertEq(state.peak, wantPeak, `maxConcurrent ${limit}: peak concurrency is ${wantPeak}${limit === 5 ? " (control: the measurement sees real concurrency)" : ""}`);
    assertEq(results.filter((r) => r.ok).length, 5, `maxConcurrent ${limit}: all five complete`);
  }
  assertEq([scanQueue.maxConcurrent, MAX_CONCURRENT_SCANS], [3, 3], "the process-wide queue is bounded at 3");
}

async function testApiScanShares(): Promise<void> {
  section("C. POST /api/v1/scan: two requests for one installation, a cap of one scan");
  const state = { spent: 0 };
  const workflow: WorkflowResult = {
    status: "no_action", automationReady: false, automationDecisionReason: "", totalFindings: 0,
    sqlInjectionFindings: 0, classifiedFindings: 0, skippedFindings: 0, fixesGenerated: 0,
    highQualityPatches: 0, mediumQualityPatches: 0, lowQualityPatches: 0, fixes: [], errors: [],
    metadata: {}, timing: { startedAt: "", finishedAt: "", durationMs: 0 },
  };
  const deps = {
    checkBudget: async () => (state.spent >= 1 ? EXCEEDED : WITHIN),
    runWorkflow: async () => { state.spent++; await sleep(30); return workflow; },
  };
  const [a, b] = await Promise.all([
    runApiScan("5101", PR_DIFF, { scanId: "api-1" }, deps),
    runApiScan("5101", PR_DIFF, { scanId: "api-2" }, deps),
  ]);
  console.log(`       scans run: ${state.spent}; statuses ${a.status}/${b.status}; ran ${a.ran}/${b.ran}`);
  assertEq(state.spent, 1, "the second request never scanned: its budget read saw the first scan's spend");
  assertEq([a.ran, b.ran].sort(), [false, true], "one request ran, one was refused");

  // Control: two installations are independent.
  state.spent = 0;
  const [c, d] = await Promise.all([
    runApiScan("5102", PR_DIFF, { scanId: "api-3" }, deps),
    runApiScan("5103", PR_DIFF, { scanId: "api-4" }, deps),
  ]);
  assertEq([c.ran, d.ran], [true, true], "control: requests for two installations both run");
}

async function testAckNotDelayedByQueue(): Promise<void> {
  section("D. a full queue does not delay the 202: the delivery is accepted, its scan waits");
  const queue = new ScanQueue(1);
  let releaseBlocker!: () => void;
  const blocker = new Promise<void>((r) => { releaseBlocker = r; });
  const occupied = queue.run("other", () => blocker);
  await sleep(5);
  const store = new MemoryStore();
  let scanStarted = false;
  const started = Date.now();
  const background: Array<Promise<unknown>> = [];
  const response = await routeGitHubWebhook({
    rawBody: Buffer.from(JSON.stringify({ ...SAMPLE, installation: { id: 3101 } })),
    eventHeader: "pull_request", signatureHeader: undefined, deliveryHeader: randomUUID(),
    webhookSecret: "", skipSignatureVerification: true,
    deps: {
      provisionOrg: async () => ({ orgId: "o", created: false }),
      handlePullRequest: async () => { throw new Error("not used"); },
      acceptPullRequest: async (a) =>
        acceptPullRequestDelivery(delivery(store, 3101, {
          rawBody: a.rawBody, payload: a.payload, deliveryId: a.deliveryId, scanQueue: queue,
          checkBudgetImpl: async () => WITHIN, resolveSemgrep: async () => { scanStarted = true; return PR_DIFF; },
        })),
      runInBackground: (_l, task) => { background.push(task()); },
    },
  });
  const ackMs = Date.now() - started;
  console.log(`       202 after ${ackMs} ms with the only slot occupied; scan started at ack time: ${scanStarted}; queue active ${queue.active}`);
  assertEq([response.status, scanStarted], [202, false], "accepted at once, scan not started while the slot is taken");
  releaseBlocker();
  await occupied;
  await Promise.all(background);
  assertEq([scanStarted, store.outcomes()], [true, ["completed/-"]], "once the slot frees, the scan runs and completes");
}

async function testDeadlineStartsWhenScanStarts(): Promise<void> {
  section("E. a scan that waits longer than its deadline is not timed out for waiting");
  const queue = new ScanQueue(1);
  let releaseBlocker!: () => void;
  const blocker = new Promise<void>((r) => { releaseBlocker = r; });
  const occupied = queue.run("other", () => blocker);
  await sleep(5);
  const store = new MemoryStore();
  const result = handlePullRequestWebhook(delivery(store, 3101, {
    scanQueue: queue, scanDeadlineMs: 40,
    checkBudgetImpl: async () => WITHIN, resolveSemgrep: async () => PR_DIFF,
  }));
  await sleep(120); // well past the 40 ms deadline, still waiting
  releaseBlocker();
  await occupied;
  const r = await result;
  console.log(`       waited ~120 ms with a 40 ms deadline: ok ${r.ok}, timedOut ${!r.ok && r.timedOut === true}; rows ${JSON.stringify(store.outcomes())}`);
  assertEq([r.ok, store.outcomes()], [true, ["completed/-"]], "the scan completed: the deadline began when it started, not when it was queued");
}

async function testQueueRules(): Promise<void> {
  section("F. the queue itself: per-key order, global slots, a failing task frees its slot");
  const q = new ScanQueue(2);
  const log: string[] = [];
  const task = (name: string, ms: number, fail = false) => async () => {
    log.push(`start ${name}`);
    await sleep(ms);
    log.push(`end ${name}`);
    if (fail) throw new Error(name);
  };
  const results = await Promise.allSettled([
    q.run("a", task("a1", 30)),
    q.run("a", task("a2", 10)),
    q.run("b", task("b1", 10, true)),
    q.run("c", task("c1", 10)),
  ]);
  console.log(`       order: ${log.join(" > ")}; settled ${results.map((r) => r.status).join(",")}`);
  assert(log.indexOf("end a1") < log.indexOf("start a2"), "a2 waited for a1 (same key)");
  assert(log.indexOf("start c1") > log.indexOf("end b1") || log.indexOf("start c1") > log.indexOf("end a1"), "c1 waited for a free slot (two slots, three keys)");
  assertEq(results.map((r) => r.status), ["fulfilled", "fulfilled", "rejected", "fulfilled"], "a failing task rejects its own caller only");
  assertEq(q.active, 0, "every slot is released afterwards");
  let threw = false;
  try { new ScanQueue(0); } catch { threw = true; }
  assert(threw, "a bound below 1 is refused");
}

const EXPECTED_SECTIONS = 6;

async function main(): Promise<void> {
  if (getAnthropicClient() !== null) {
    console.error("[FAIL] an Anthropic client exists in this process; refusing to run");
    process.exit(1);
  }
  console.log("[PASS] no Anthropic client exists in this process");
  for (const run of [testSameInstallationSerial, testDifferentInstallationsBounded, testApiScanShares, testAckNotDelayedByQueue, testDeadlineStartsWhenScanStarts, testQueueRules]) {
    try {
      await run();
    } catch (err) {
      assert(false, `section threw: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    }
  }
  assertEq(sectionsRun.length, EXPECTED_SECTIONS, "every section ran");
  assert(getAnthropicClient() === null, "still no Anthropic client after the run");
  console.log(failures === 0 ? "\nScan-concurrency witness: PASS." : `\nScan-concurrency witness: ${failures} FAILURE(S).`);
  process.exit(failures > 0 ? 1 : 0);
}

void main();
