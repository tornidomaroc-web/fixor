/**
 * Witness: a scan's deadline answers the caller, CANCELS the scan's model
 * calls, and does NOT hand the scan's queue slot to the next scan while
 * the scan still runs (tracker items 5c and 5d; lib/scan-deadline.ts).
 *
 * Before this change:
 *   - the webhook deadline resolved the queued task, so the slot was
 *     released at the deadline and the timed-out scan kept running beside
 *     the next one: MAX_CONCURRENT_SCANS bounded tasks whose caller was
 *     still waiting, not running scans (5d);
 *   - POST /api/v1/scan had no deadline at all inside its queued task, so
 *     a hung API scan held its installation's chain and one global slot
 *     until the process restarted (5c);
 *   - nothing stopped a timed-out scan's later model calls.
 *
 * Sections:
 *   A. webhook: a scan that outlives its deadline; the next scan for another
 *      installation waits for it to SETTLE, not for the deadline. Its row
 *      is `failed/timed_out`. (fails on main: the second scan starts at
 *      the deadline)
 *   B. webhook: a scan that never settles; the slot is released only after
 *      deadline + grace, and the next scan starts then. (fails on main:
 *      starts at the deadline)
 *   C. control: a scan inside its deadline completes, is not cancelled and
 *      hands its slot on as soon as it finishes.
 *   D. API: a hung scan is answered 504 `scan_timed_out` at the deadline,
 *      its workflow observes the cancellation, and a second request for the
 *      same installation waits for it to settle. (fails on main: the first
 *      request waits out the whole workflow and answers 200)
 *   E. API control: a workflow inside its deadline answers 200, uncancelled.
 *   F. callClaude under a cancelled scan refuses before the transport with
 *      reason `scan_cancelled`; the same call uncancelled goes through.
 *      (fails on main: no such refusal exists)
 *   G. the webhook path hands its cancel flag to the workflow's cost
 *      context: read from the handler's source, because a keyless dry run
 *      reaches no model call through which to observe it. Structural, and
 *      said so.
 *
 * Keyless and $0: no key, no client (asserted first and last), dry-run
 * webhooks, stand-in workflows and a stand-in transport for F.
 */
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DATABASE_URL;
delete process.env.GITHUB_TOKEN;
delete process.env.FIXOR_BUDGET_EXEMPT_INSTALLATIONS;
delete process.env.FIXOR_PILOT_ENABLED;
delete process.env.CLOUDINARY_CLOUD_NAME;
delete process.env.CLOUDINARY_API_KEY;
delete process.env.CLOUDINARY_API_SECRET;

import { randomUUID } from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import type { Message } from "@anthropic-ai/sdk/resources/messages";

import {
  callClaude,
  getAnthropicClient,
  setCallClaudeTestDeps,
  type MessagesCallOptions,
} from "../analysis-engine/anthropic-client";
import {
  handlePullRequestWebhook,
  type HandlePullRequestWebhookOptions,
} from "../integrations/github/pr-webhook-handler";
import { costContext, scanCancelled } from "../lib/cost-context";
import { ScanQueue } from "../lib/scan-queue";
import { runApiScan } from "../server/api-scan";
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
    token: "unused",
    workflowMetadata: { scanId: "scan-deadline-witness" },
    deliveryId: randomUUID(),
    scanRunStore: store,
    checkBudgetImpl: async () => WITHIN,
    ...extra,
  };
}

/** A second delivery whose scan records when it started, relative to `t0`. */
function probe(store: ScanRunStore, installationId: number, queue: ScanQueue, t0: number) {
  const seen = { startedAt: -1 };
  const result = handlePullRequestWebhook(delivery(store, installationId, {
    scanQueue: queue,
    scanDeadlineMs: 5_000,
    resolveSemgrep: async () => {
      seen.startedAt = Date.now() - t0;
      return PR_DIFF;
    },
  }));
  return { seen, result };
}

function emptyWorkflow(): WorkflowResult {
  return {
    status: "completed",
    automationReady: true,
    totalFindings: 0,
    classifiedFindings: 0,
    skippedFindings: 0,
    fixesGenerated: 0,
    fixes: [],
    errors: [],
    timing: { totalMs: 1 },
  } as unknown as WorkflowResult;
}

// ---- sections ------------------------------------------------------------------

async function testWebhookSlotHeldUntilSettled(): Promise<void> {
  section("A. webhook: a scan past its deadline keeps its slot until it settles; the next scan waits for that, not for the deadline");
  const queue = new ScanQueue(1);
  const store = new MemoryStore();
  const t0 = Date.now();
  // Scan 1 takes ~300 ms against a 60 ms deadline.
  const first = handlePullRequestWebhook(delivery(store, 5101, {
    scanQueue: queue, scanDeadlineMs: 60, scanSlotGraceMs: 2_000,
    resolveSemgrep: async () => { await sleep(300); return PR_DIFF; },
  }));
  await sleep(5);
  const second = probe(store, 5102, queue, t0);
  const r1 = await first;
  const answeredAt = Date.now() - t0;
  await second.result;
  console.log(`       scan 1 answered at ${answeredAt} ms (deadline 60); scan 2 started at ${second.seen.startedAt} ms; rows ${JSON.stringify(store.outcomes())}`);
  assertEq([r1.ok, !r1.ok && r1.timedOut === true], [false, true], "scan 1 is answered as timed out");
  assert(answeredAt < 250, `scan 1's caller was answered at the deadline, not when the scan settled (${answeredAt} ms)`);
  assert(second.seen.startedAt >= 280, `scan 2 started only after scan 1 settled (~300 ms), not at its deadline (started at ${second.seen.startedAt} ms)`);
  assertEq(store.outcomes(), ["completed/-", "failed/timed_out"], "scan 1's row is failed/timed_out; scan 2's is completed");
}

async function testWebhookGraceReleasesSlot(): Promise<void> {
  section("B. webhook: a scan that never settles gives its slot up only after deadline + grace");
  const queue = new ScanQueue(1);
  const store = new MemoryStore();
  const t0 = Date.now();
  const never = new Promise<string>(() => {});
  const first = handlePullRequestWebhook(delivery(store, 5201, {
    scanQueue: queue, scanDeadlineMs: 40, scanSlotGraceMs: 80,
    resolveSemgrep: () => never,
  }));
  await sleep(5);
  const second = probe(store, 5202, queue, t0);
  const r1 = await first;
  await second.result;
  console.log(`       deadline 40 + grace 80; scan 2 started at ${second.seen.startedAt} ms; rows ${JSON.stringify(store.outcomes())}`);
  assertEq(!r1.ok && r1.timedOut === true, true, "scan 1 is answered as timed out");
  assert(second.seen.startedAt >= 110, `scan 2 waited for the grace, not just the deadline (started at ${second.seen.startedAt} ms, deadline was 40)`);
  assert(second.seen.startedAt < 1_000, `the slot was released after the grace, not pinned forever (started at ${second.seen.startedAt} ms)`);
  assertEq(store.outcomes(), ["completed/-", "failed/timed_out"], "the hung scan's row is failed/timed_out; scan 2 completed");
}

async function testWebhookControl(): Promise<void> {
  section("C. control: a scan inside its deadline completes and hands its slot on when it finishes");
  const queue = new ScanQueue(1);
  const store = new MemoryStore();
  const t0 = Date.now();
  const first = handlePullRequestWebhook(delivery(store, 5301, {
    scanQueue: queue, scanDeadlineMs: 400, scanSlotGraceMs: 400,
    resolveSemgrep: async () => { await sleep(30); return PR_DIFF; },
  }));
  await sleep(5);
  const second = probe(store, 5302, queue, t0);
  const r1 = await first;
  await second.result;
  console.log(`       scan 1 ok ${r1.ok}; scan 2 started at ${second.seen.startedAt} ms; rows ${JSON.stringify(store.outcomes())}`);
  assertEq([r1.ok, store.outcomes()], [true, ["completed/-", "completed/-"]], "both scans completed");
  assert(second.seen.startedAt < 300, `scan 2 started as soon as scan 1 finished, well before any deadline (${second.seen.startedAt} ms)`);
}

async function testApiDeadline(): Promise<void> {
  section("D. API: a hung scan is answered 504 at the deadline, its workflow sees the cancellation, and the next request waits for it to settle");
  const queue = new ScanQueue(1);
  const seen = { cancelledWhenWoken: null as boolean | null, secondStartedAt: -1 };
  const t0 = Date.now();
  const hung = runApiScan("7101", PR_DIFF, { repoName: "api/test", scanId: "d1" }, {
    checkBudget: async () => WITHIN,
    runWorkflow: async () => {
      await sleep(200);
      seen.cancelledWhenWoken = scanCancelled();
      return emptyWorkflow();
    },
    queue, deadlineMs: 60, slotGraceMs: 2_000,
  });
  await sleep(5);
  const next = runApiScan("7101", PR_DIFF, { repoName: "api/test", scanId: "d2" }, {
    checkBudget: async () => WITHIN,
    runWorkflow: async () => { seen.secondStartedAt = Date.now() - t0; return emptyWorkflow(); },
    queue, deadlineMs: 5_000,
  });
  const r1 = await hung;
  const answeredAt = Date.now() - t0;
  const r2 = await next;
  await sleep(50); // let the hung workflow wake and record what it saw
  console.log(`       first answered ${r1.status} at ${answeredAt} ms; workflow saw cancelled=${seen.cancelledWhenWoken}; second started at ${seen.secondStartedAt} ms and answered ${r2.status}`);
  assertEq([r1.status, (r1.body as { error?: string }).error, r1.ran], [504, "scan_timed_out", true], "the hung API scan is answered 504 scan_timed_out, ran=true");
  assert(answeredAt < 180, `answered at the deadline (60 ms), not after the workflow (${answeredAt} ms)`);
  assertEq(seen.cancelledWhenWoken, true, "the workflow's cost context was cancelled at the deadline");
  assert(seen.secondStartedAt >= 190, `the second request for the same installation waited for the first to settle (~200 ms), started at ${seen.secondStartedAt} ms`);
  assertEq(r2.status, 200, "the second request then ran normally");
}

async function testApiControl(): Promise<void> {
  section("E. API control: a workflow inside its deadline answers 200 and is not cancelled");
  const seen = { cancelled: null as boolean | null };
  const r = await runApiScan("7201", PR_DIFF, { repoName: "api/test", scanId: "e1" }, {
    checkBudget: async () => WITHIN,
    runWorkflow: async () => { await sleep(20); seen.cancelled = scanCancelled(); return emptyWorkflow(); },
    queue: new ScanQueue(1), deadlineMs: 400,
  });
  assertEq([r.status, r.ran, seen.cancelled], [200, true, false], "200, ran, and the workflow saw no cancellation");
}

async function testCallClaudeRefusesWhenCancelled(): Promise<void> {
  section("F. callClaude under a cancelled scan refuses before the transport; uncancelled it goes through");
  let creates = 0;
  setCallClaudeTestDeps({
    async create() {
      creates++;
      return {
        id: "msg_scan_deadline", type: "message", role: "assistant", model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "canned" }], stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      } as unknown as Message;
    },
    async recordCost() { /* no ledger in this process */ },
  });
  const opts: MessagesCallOptions = {
    model: "claude-sonnet-4-6",
    system: "scan deadline witness",
    messages: [{ role: "user", content: "canned" }],
    callerId: "test:scan-deadline",
  };
  try {
    const refused = await costContext.run({ installationId: "7301", cancel: { cancelled: true } }, () => callClaude(opts));
    assertEq([refused.ok, !refused.ok ? refused.reason : null, creates], [false, "scan_cancelled", 0], "cancelled: refused with reason scan_cancelled and the transport was never called");
    const allowed = await costContext.run({ installationId: "7301", cancel: { cancelled: false } }, () => callClaude(opts));
    assertEq([allowed.ok, creates], [true, 1], "control: uncancelled, the transport is called once and the call succeeds");
    const outside = await callClaude(opts);
    assertEq([outside.ok, creates], [true, 2], "control: outside any scan context the call goes through");
  } finally {
    setCallClaudeTestDeps(null);
  }
}

async function testApiDeadlineStartsWhenScanStarts(): Promise<void> {
  section("H. API: a request that waits in the queue longer than its deadline is not timed out for waiting");
  const queue = new ScanQueue(1);
  let release!: () => void;
  const blocker = new Promise<void>((r) => { release = r; });
  const occupied = queue.run("7401", () => blocker);
  await sleep(5);
  const t0 = Date.now();
  // The request waits ~150 ms behind the blocker, then its 40 ms workflow
  // runs against a 100 ms deadline: it completes only if the wait did not
  // count. (Section E of test-scan-concurrency guards the webhook path.)
  const pending = runApiScan("7401", PR_DIFF, { repoName: "api/test", scanId: "h1" }, {
    checkBudget: async () => WITHIN,
    runWorkflow: async () => { await sleep(40); return emptyWorkflow(); },
    queue, deadlineMs: 100,
  });
  await sleep(150);
  release();
  await occupied;
  const r = await pending;
  console.log(`       waited ~150 ms with a 100 ms deadline, then a 40 ms workflow: status ${r.status} at ${Date.now() - t0} ms`);
  assertEq(r.status, 200, "the request completed: its deadline began when its scan started, not when it was queued");
}

function testWebhookPlumbsCancelFlag(): void {
  section("G. structural: the webhook handler hands its cancel flag to the workflow's cost context");
  const src = fs.readFileSync(path.join(process.cwd(), "src/integrations/github/pr-webhook-handler.ts"), "utf8");
  const ctxLiteral = /const scanCtx: CostContextStore = \{[\s\S]{0,400}?cancel: run\.cancel,?\s*\};/.test(src);
  assert(ctxLiteral, "scanCtx carries `cancel: run.cancel` (read from source: a keyless dry run reaches no model call to observe it through)");
  const deadlineUsesIt = /withScanDeadline<HandlePullRequestWebhookResult>\(\{[\s\S]*?cancel: run\.cancel/.test(src);
  assert(deadlineUsesIt, "the deadline race is given the same `run.cancel` (read from source)");
}

const EXPECTED_SECTIONS = 8;

async function main(): Promise<void> {
  if (getAnthropicClient() !== null) {
    console.error("[FAIL] an Anthropic client exists in this process; refusing to run");
    process.exit(1);
  }
  console.log("[PASS] no Anthropic client exists in this process");
  for (const run of [
    testWebhookSlotHeldUntilSettled,
    testWebhookGraceReleasesSlot,
    testWebhookControl,
    testApiDeadline,
    testApiControl,
    testCallClaudeRefusesWhenCancelled,
    testApiDeadlineStartsWhenScanStarts,
    testWebhookPlumbsCancelFlag,
  ]) {
    try {
      await run();
    } catch (err) {
      assert(false, `section threw: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    }
  }
  assertEq(sectionsRun.length, EXPECTED_SECTIONS, "every section ran");
  assert(getAnthropicClient() === null, "still no Anthropic client after the run");
  console.log(failures === 0 ? "\nScan-deadline witness: PASS." : `\nScan-deadline witness: ${failures} FAILURE(S).`);
  process.exit(failures > 0 ? 1 : 0);
}

void main();
