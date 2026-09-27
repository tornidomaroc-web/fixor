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
 *   H. API: waiting in the queue does not count against the deadline.
 *
 * Added with tracker item 5e (the follow-up to #253):
 *   I. a queue task that settles with `undefined` (a slot released by a
 *      grace of zero) is the deadline path, never the caller's answer.
 *      (fails with the `value === undefined` branch of withScanDeadline
 *      deleted: the unit call resolves undefined, and the API call throws)
 *   J. a scan cancelled while a call waits to retry: the retry is refused
 *      before the transport. (fails with `attempt > 0 && scanCancelled()`
 *      deleted from callClaude: the retry reaches the transport)
 *   K. API: a workflow that never settles gives its slot up only after
 *      deadline + grace. (B's counterpart on the API path)
 *   L. a timed-out scan's row records the spend up to the deadline, read
 *      from the accumulator the ledger shares; a call in flight at the
 *      deadline completes later and reaches the ledger, never the row.
 *      (fails on main before this change: the row read 0)
 *
 * Added with tracker item 5f:
 *   M. a ledger write fails during the scan, then the deadline fires: the
 *      row is closed incomplete/spend_unrecorded, the more serious truth,
 *      not failed/timed_out, with cost_usd counting the call the ledger
 *      lacks. (fails on main before this change: failed/timed_out; also
 *      fails if the deadline reads only `run.spendUnrecorded`, which the
 *      workflow sets only on return)
 *
 * Keyless and $0: no key, no client (asserted first and last), dry-run
 * webhooks, stand-in workflows and a stand-in transport for F, J, L and M.
 * Timing assertions are lower bounds or loose upper bounds only, so a
 * slow runner makes them later, never wrong.
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
import { costContext, scanCancelled, type ScanCancel } from "../lib/cost-context";
import { withScanDeadline } from "../lib/scan-deadline";
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

interface MemRow extends ScanRunStart { id: string; status: string; code: string | null; costUsd: number; finishedAt: Date | null }
class MemoryStore implements ScanRunStore {
  rows = new Map<string, MemRow>();
  /** Every `finish` call, including any the store ignores: the handler must make exactly one. */
  finishCalls = 0;
  async createPending(s: ScanRunStart): Promise<ScanRunCreateResult> {
    const id = randomUUID();
    this.rows.set(id, { ...s, id, status: "pending", code: null, costUsd: 0, finishedAt: null });
    return { created: true, id };
  }
  async markRunning(id: string): Promise<void> {
    const r = this.rows.get(id);
    if (r && r.status === "pending") r.status = "running";
  }
  async finish(id: string, o: ScanRunOutcome, at: Date): Promise<void> {
    this.finishCalls++;
    const r = this.rows.get(id);
    if (!r || r.finishedAt !== null) return;
    Object.assign(r, { status: o.status, code: o.code, costUsd: o.costUsd, finishedAt: at });
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

// ---- sections added with tracker item 5e ---------------------------------------

const CANNED_OPTS: MessagesCallOptions = {
  model: "claude-sonnet-4-6",
  system: "scan deadline witness",
  messages: [{ role: "user", content: "canned" }],
  callerId: "test:scan-deadline",
};

/** A priced response: usage present and non-zero, so the call is a ledger write. */
function pricedMessage(): Message {
  return {
    id: "msg_scan_deadline_priced", type: "message", role: "assistant", model: "claude-sonnet-4-6",
    content: [{ type: "text", text: "canned" }], stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

/** One IDOR-shaped FastAPI file: clears the IDOR detector's prefilter, so the scan makes model calls for it. */
function idorFileDiff(relPath: string): string {
  const lines = [
    "from fastapi import APIRouter, Depends",
    "from app.db import get_session",
    "router = APIRouter()",
    '@router.get("/items/{item_id}")',
    "def read_item(item_id: int, session = Depends(get_session)):",
    "    item = session.get(Item, item_id)",
    "    return item",
  ];
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
const TWO_CALL_DIFF = idorFileDiff("app/routers/items.py") + idorFileDiff("app/routers/orders.py");

async function testUndefinedSettlementIsTheDeadlinePath(): Promise<void> {
  section("I. a queue task that settles with undefined (a slot released by a grace of zero) is the deadline path, never the caller's answer");
  // Unit, no timers: the scan promise settles with undefined at once.
  const cancel: ScanCancel = { cancelled: false };
  const answer = { timedOut: true as const };
  const unit = await withScanDeadline<typeof answer>({
    scan: Promise.resolve(undefined as unknown as typeof answer),
    deadlineMs: 10_000,
    cancel,
    onDeadline: () => answer,
    label: { section: "I" },
  });
  assertEq([unit === answer, cancel.cancelled], [true, true], "withScanDeadline: undefined from the scan resolves with onDeadline's answer and cancels the scan (fails with the value === undefined branch deleted)");

  // Integrated: the API path with a grace of zero and a workflow that never
  // settles. The slot's release and the deadline fall due together; the
  // caller must get the timed-out answer, never the released slot's undefined.
  const r = await runApiScan("7501", PR_DIFF, { repoName: "api/test", scanId: "i1" }, {
    checkBudget: async () => WITHIN,
    runWorkflow: () => new Promise<WorkflowResult>(() => {}),
    queue: new ScanQueue(1), deadlineMs: 50, slotGraceMs: 0,
  });
  assertEq([r.status, (r.body as { error?: string }).error, r.ran], [504, "scan_timed_out", true], "API, grace 0: answered 504 scan_timed_out (fails with the branch deleted: runApiScan reads a field of undefined and throws)");
}

async function testRetryPathRefusesWhenCancelled(): Promise<void> {
  section("J. a scan cancelled while a call waits to retry: the retry is refused before the transport");
  const cancel: ScanCancel = { cancelled: false };
  let creates = 0;
  setCallClaudeTestDeps({
    async create() {
      creates++;
      // The first attempt fails with a retryable status and Retry-After: 1
      // (a one-second backoff). The deadline passes during that wait.
      cancel.cancelled = true;
      throw Object.assign(new Error("rate limited (stand-in)"), { status: 429, headers: { "retry-after": "1" } });
    },
    async recordCost() { /* no ledger in this process */ },
  });
  try {
    const r = await costContext.run({ installationId: "7601", cancel }, () => callClaude(CANNED_OPTS));
    assertEq([r.ok, !r.ok ? r.reason : null, creates], [false, "scan_cancelled", 1], "after one failed attempt the retry is refused with reason scan_cancelled; the transport saw one call (fails with the retry-path check deleted: every retry reaches the transport)");
  } finally {
    setCallClaudeTestDeps(null);
  }
}

async function testApiGraceReleasesSlot(): Promise<void> {
  section("K. API: a workflow that never settles gives its slot up only after deadline + grace; the next request for the installation runs then");
  const queue = new ScanQueue(1);
  const t0 = Date.now();
  const seen = { secondStartedAt: -1 };
  const hung = runApiScan("7701", PR_DIFF, { repoName: "api/test", scanId: "k1" }, {
    checkBudget: async () => WITHIN,
    runWorkflow: () => new Promise<WorkflowResult>(() => {}),
    queue, deadlineMs: 50, slotGraceMs: 100,
  });
  await sleep(5);
  const next = runApiScan("7701", PR_DIFF, { repoName: "api/test", scanId: "k2" }, {
    checkBudget: async () => WITHIN,
    runWorkflow: async () => { seen.secondStartedAt = Date.now() - t0; return emptyWorkflow(); },
    queue, deadlineMs: 10_000,
  });
  const r1 = await hung;
  const r2 = await next;
  console.log(`       deadline 50 + grace 100; first answered ${r1.status}; second started at ${seen.secondStartedAt} ms and answered ${r2.status}`);
  assertEq([r1.status, (r1.body as { error?: string }).error], [504, "scan_timed_out"], "the hung request is answered 504 scan_timed_out");
  // Lower bound only: a slow runner fires timers later, never earlier.
  assert(seen.secondStartedAt >= 140, `the second request waited for the grace, not just the deadline (started at ${seen.secondStartedAt} ms; deadline 50 + grace 100)`);
  assert(seen.secondStartedAt < 10_000, `the slot was released after the grace, not pinned (started at ${seen.secondStartedAt} ms)`);
  assertEq(r2.status, 200, "the second request then ran normally");
}

async function testTimedOutRowKeepsSpendUpToDeadline(): Promise<void> {
  section("L. a timed-out scan's row records the spend up to the deadline; a call in flight at the deadline reaches the ledger, not the row");
  const queue = new ScanQueue(1);
  const store = new MemoryStore();
  const ledger: number[] = [];
  let creates = 0;
  let releaseSecond!: () => void;
  const secondReleased = new Promise<void>((r) => { releaseSecond = r; });
  setCallClaudeTestDeps({
    async create() {
      creates++;
      if (creates === 1) return pricedMessage(); // finished before the deadline
      await secondReleased; // in flight at the deadline, released by the test afterwards
      return pricedMessage();
    },
    async recordCost(_installationId, costUsd) { ledger.push(costUsd); },
  });
  try {
    const r1 = await handlePullRequestWebhook(delivery(store, 5401, {
      scanQueue: queue, scanDeadlineMs: 1_500, scanSlotGraceMs: 10_000,
      resolveSemgrep: async () => TWO_CALL_DIFF,
    }));
    const row = [...store.rows.values()][0];
    const atDeadline = { costUsd: row?.costUsd, ledger: [...ledger], creates, finishCalls: store.finishCalls };
    console.log(`       at the deadline: row ${row?.status}/${row?.code} cost_usd ${atDeadline.costUsd}; ledger ${JSON.stringify(atDeadline.ledger)}; calls started ${creates}`);
    assertEq([r1.ok, !r1.ok && r1.timedOut === true], [false, true], "the caller is answered as timed out");
    assertEq([row?.status, row?.code, atDeadline.finishCalls], ["failed", "timed_out", 1], "the row is failed/timed_out, finished once");
    // How many calls the detectors make for two files is theirs to decide;
    // what matters is that exactly one finished before the deadline and the
    // rest were in flight at it.
    assert(atDeadline.creates >= 2, `at least two model calls started before the deadline (${atDeadline.creates})`);
    assertEq(atDeadline.ledger.length, 1, "exactly one call finished and was ledgered before the deadline; the others are in flight");
    assert((atDeadline.ledger[0] ?? 0) > 0, "the finished call was priced");
    assertEq(atDeadline.costUsd?.toFixed(6), (atDeadline.ledger[0] ?? 0).toFixed(6), "the row's cost_usd is the spend up to the deadline, the same figure the ledger was given (fails on main before this change: the row read 0)");

    releaseSecond();
    // Generous wait for the in-flight call to land and the scan to settle.
    const until = Date.now() + 10_000;
    while (ledger.length < atDeadline.creates && Date.now() < until) await sleep(10);
    await sleep(50);
    assertEq(ledger.length, atDeadline.creates, "every in-flight call completed after the deadline and reached the ledger");
    assertEq([row?.costUsd?.toFixed(6), store.finishCalls], [(atDeadline.ledger[0] ?? 0).toFixed(6), 1], "the row is unchanged: finished once, cost_usd still the spend up to the deadline; the in-flight calls are in the ledger only");
    const ledgerTotal = ledger.reduce((sum, usd) => sum + usd, 0);
    assert(ledgerTotal > (row?.costUsd ?? 0), `the ledger's total for this scan (${ledgerTotal.toFixed(6)}) exceeds the row's (${row?.costUsd}) by the in-flight calls`);
  } finally {
    setCallClaudeTestDeps(null);
  }
}

async function testLedgerFailureThenDeadline(): Promise<void> {
  section("M. a ledger write fails during the scan, then the deadline fires: the row says spend_unrecorded, not timed_out");
  const queue = new ScanQueue(1);
  const store = new MemoryStore();
  const ledgerAttempts: number[] = [];
  let creates = 0;
  let budgetReads = 0;
  let releaseAll!: () => void;
  const released = new Promise<void>((r) => { releaseAll = r; });
  setCallClaudeTestDeps({
    async create() {
      creates++;
      if (creates === 1) return pricedMessage(); // finished; its ledger write fails below
      await released; // any call already in flight stays in flight past the deadline
      return pricedMessage();
    },
    async recordCost(_installationId, costUsd) {
      ledgerAttempts.push(costUsd);
      throw new Error("ledger insert refused (stand-in)");
    },
  });
  try {
    const r1 = await handlePullRequestWebhook(delivery(store, 5501, {
      scanQueue: queue, scanDeadlineMs: 1_500, scanSlotGraceMs: 10_000,
      resolveSemgrep: async () => TWO_CALL_DIFF,
      // The pre-scan read passes; the post-scan re-read never settles, so
      // the scan is past its deadline even if every later model call was
      // refused and the workflow returned at once.
      checkBudgetImpl: () => (++budgetReads === 1 ? Promise.resolve(WITHIN) : new Promise<BudgetCheck>(() => {})),
    }));
    const row = [...store.rows.values()][0];
    console.log(`       at the deadline: row ${row?.status}/${row?.code} cost_usd ${row?.costUsd}; ledger attempts ${JSON.stringify(ledgerAttempts)}, none succeeded; calls started ${creates}; budget reads ${budgetReads}`);
    assertEq([r1.ok, !r1.ok && r1.timedOut === true], [false, true], "the caller is still answered as timed out");
    assertEq([row?.status, row?.code, store.finishCalls], ["incomplete", "spend_unrecorded", 1], "the row is incomplete/spend_unrecorded, finished once (fails on main before this change: failed/timed_out)");
    assertEq(ledgerAttempts.length, 1, "exactly one ledger write was attempted, and it failed; every later model call was refused or held");
    assertEq(row?.costUsd?.toFixed(6), (ledgerAttempts[0] ?? 0).toFixed(6), "cost_usd counts the call whose ledger write failed: the row holds spend the ledger lacks, as a spend_unrecorded row does by design");
  } finally {
    releaseAll();
    setCallClaudeTestDeps(null);
  }
}

const EXPECTED_SECTIONS = 13;

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
    testUndefinedSettlementIsTheDeadlinePath,
    testRetryPathRefusesWhenCancelled,
    testApiGraceReleasesSlot,
    testTimedOutRowKeepsSpendUpToDeadline,
    testLedgerFailureThenDeadline,
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
