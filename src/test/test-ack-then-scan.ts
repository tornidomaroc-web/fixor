/**
 * Witness: the webhook acknowledges a pull_request delivery once its
 * scan_runs row exists and scans afterwards; the budget is read before
 * the pull request is fetched; a delivery with no installation is refused
 * unless a caller says it is unpriced on purpose; a process death is
 * repaired by one retry and then said out loud; a hung scan closes its
 * row; shutdown waits for scans in flight.
 *
 * Pre-public queue item 5 (acknowledge-then-scan) and item 2a (the
 * unpriced no-installation branch).
 *
 * What runs: the real route (github-webhook-route.ts), the real accept
 * and run halves of the handler (pr-webhook-handler.ts), the sweeper
 * (scan-run-sweeper.ts), the in-flight tracker (lib/in-flight.ts) and the
 * production Drizzle store's SQL over a recording `pg` client. `fetch` is a
 * recorder; the scan is the regex-only secrets detector; the store is an
 * in-memory copy of the production rules (write-once final state,
 * pending-only `markRunning`).
 *
 * Fails on main: the route has no accept half (the response waits for the
 * scan), the diff is fetched before the budget, a no-installation delivery
 * runs unpriced, and nothing sweeps.
 *
 * Keyless and $0: no Anthropic key and no client exist in this process
 * (asserted first), the only detector that fires is regex-only, `fetch` is
 * replaced before any request, the App JWT is signed with a throwaway key,
 * DATABASE_URL is unset.
 */
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DATABASE_URL;
delete process.env.GITHUB_TOKEN;
delete process.env.FIXOR_BUDGET_EXEMPT_INSTALLATIONS;
delete process.env.FIXOR_PILOT_ENABLED;
delete process.env.CLOUDINARY_CLOUD_NAME;
delete process.env.CLOUDINARY_API_KEY;
delete process.env.CLOUDINARY_API_SECRET;
delete process.env.GITHUB_API_BASE_URL;
delete process.env.SENTRY_DSN;
process.env.GITHUB_APP_ID = "424242";

import { generateKeyPairSync, randomUUID } from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import { drizzle } from "drizzle-orm/node-postgres";

import { getAnthropicClient } from "../analysis-engine/anthropic-client";
import { db as productionDb } from "../db/client";
import { clearInstallationTokenCache } from "../integrations/github/app-auth.service";
import {
  acceptPullRequestDelivery,
  handlePullRequestWebhook,
  postInterruptedNotice,
  rerunRecordedScanRun,
  type HandlePullRequestWebhookOptions,
} from "../integrations/github/pr-webhook-handler";
import { InFlightTracker } from "../lib/in-flight";
import { routeGitHubWebhook } from "../server/github-webhook-route";
import type { BudgetCheck } from "../services/cost-store";
import {
  drizzleScanRunStore,
  SCAN_RUN_MESSAGES,
  type ScanRunCreateResult,
  type ScanRunOutcome,
  type ScanRunStart,
  type ScanRunStore,
  type ScanRunSweepStore,
  type UnfinishedScanRun,
} from "../services/scan-run-store";
import { sweepUnfinishedScanRuns } from "../services/scan-run-sweeper";

process.env.GITHUB_APP_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

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

// ---- the recorder that replaces fetch --------------------------------------

const requests: string[] = [];
const commentBodies: string[] = [];
const unexpected: string[] = [];
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}
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

(globalThis as { fetch: typeof fetch }).fetch = (async (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  requests.push(`${method} ${new URL(url).pathname}`);
  if (method === "POST" && /\/app\/installations\/\d+\/access_tokens$/.test(url)) {
    return json(201, { token: "from-installation", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
  }
  if (method === "GET" && /\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(url)) return text(200, PR_DIFF);
  if (method === "GET" && /\/repos\/[^/]+\/[^/]+\/contents\//.test(url)) return text(200, 'export const region = "eu";\n');
  if (method === "GET" && /\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments(\?|$)/.test(url)) return json(200, []);
  if (method === "POST" && /\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/.test(url)) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { body?: string };
    commentBodies.push(body.body ?? "");
    return json(201, { id: 901, html_url: "https://github.com/acme-corp/demo-app/pull/7#issuecomment-901" });
  }
  unexpected.push(`${method} ${url}`);
  return json(599, { message: "unexpected request in the witness" });
}) as typeof fetch;

// ---- the in-memory store, with the production rules -----------------------------

interface MemRow extends ScanRunStart {
  id: string;
  status: string;
  code: string | null;
  errorMessage: string | null;
  costUsd: number;
  finishedAt: Date | null;
}
class MemoryStore implements ScanRunStore, ScanRunSweepStore {
  rows = new Map<string, MemRow>();
  calls: string[] = [];
  finishCalls = 0;
  createThrows = false;
  seed(partial: Partial<MemRow> & { status: string; startedAt: Date }): MemRow {
    const row: MemRow = {
      id: partial.id ?? randomUUID(), installationId: "3101", deliveryId: partial.deliveryId ?? randomUUID(),
      repoFullName: "acme-corp/demo-app", pullNumber: 7, headSha: HEAD_SHA, code: null, errorMessage: null,
      costUsd: 0, finishedAt: partial.finishedAt ?? null, ...partial,
    };
    this.rows.set(row.id, row);
    return row;
  }
  async createPending(s: ScanRunStart): Promise<ScanRunCreateResult> {
    this.calls.push("create");
    if (this.createThrows) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    if (s.deliveryId !== null && [...this.rows.values()].some((r) => r.deliveryId === s.deliveryId)) {
      return { created: false, reason: "duplicate_delivery" };
    }
    const row = this.seed({ ...s, status: "pending" });
    return { created: true, id: row.id };
  }
  async markRunning(id: string): Promise<void> {
    this.calls.push("running");
    const r = this.rows.get(id);
    if (r && r.status === "pending" && r.finishedAt === null) r.status = "running";
  }
  async finish(id: string, o: ScanRunOutcome, at: Date): Promise<void> {
    this.calls.push("finish");
    this.finishCalls++;
    const r = this.rows.get(id);
    if (!r || r.finishedAt !== null) return;
    Object.assign(r, { status: o.status, code: o.code, errorMessage: o.code ? SCAN_RUN_MESSAGES[o.code] : null, costUsd: o.costUsd, finishedAt: at });
  }
  async listUnfinished(before: Date, limit: number): Promise<UnfinishedScanRun[]> {
    return [...this.rows.values()]
      .filter((r) => r.finishedAt === null && ["pending", "running", "retrying"].includes(r.status) && r.startedAt < before)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .slice(0, limit)
      .map((r) => ({ id: r.id, installationId: r.installationId, deliveryId: r.deliveryId, repoFullName: r.repoFullName, pullNumber: r.pullNumber, headSha: r.headSha, status: r.status as UnfinishedScanRun["status"], startedAt: r.startedAt }));
  }
  async markRetrying(id: string): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.finishedAt !== null || !["pending", "running"].includes(r.status)) return false;
    r.status = "retrying";
    return true;
  }
  only(): MemRow | undefined {
    return this.rows.size === 1 ? [...this.rows.values()][0] : undefined;
  }
}

// ---- the delivery ------------------------------------------------------------

const WITHIN: BudgetCheck = { withinBudget: true, monthlySpend: 0.1, dailySpend: 0.05, caps: { monthlyCapUsd: 5, dailyCapUsd: 2 } };
const EXCEEDED: BudgetCheck = { withinBudget: false, reason: "monthly_exceeded", monthlySpend: 5.04, dailySpend: 0.4, caps: { monthlyCapUsd: 5, dailyCapUsd: 2 } };
const UNVERIFIABLE: BudgetCheck = { withinBudget: false, reason: "budget_unverifiable", monthlySpend: 0, dailySpend: 0, caps: { monthlyCapUsd: 5, dailyCapUsd: 2 }, failure: { kind: "connection", attempts: 2 } };
const SAMPLE = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "src/integrations/github/samples/pull_request.opened.sample.json"), "utf8"),
) as Record<string, unknown>;
const HEAD_SHA = ((SAMPLE.pull_request as { head: { sha: string } }).head).sha;
const INSTALLATION_ID = 3101;

function reset(): void {
  requests.length = 0;
  commentBodies.length = 0;
  unexpected.length = 0;
  clearInstallationTokenCache();
}
function baseOptions(store: ScanRunStore, budget: BudgetCheck, payload: unknown): HandlePullRequestWebhookOptions {
  return {
    rawBody: JSON.stringify(payload),
    payload,
    dryRun: false,
    skipSignatureVerification: true,
    updateExisting: true,
    usePrDiffFallback: true,
    checkBudgetImpl: async () => budget,
    workflowMetadata: { scanId: "ack-then-scan-witness" },
    deliveryId: randomUUID(),
    scanRunStore: store,
  };
}
const withInstallation = () => ({ ...SAMPLE, installation: { id: INSTALLATION_ID } });
const pulls = () => requests.filter((r) => /^GET \/repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(r)).length;
const posts = () => requests.filter((r) => /^POST .*\/comments$/.test(r)).length;

// ---- sections ------------------------------------------------------------------

async function testAckBeforeScan(): Promise<void> {
  section("A. the route answers 202 once the row exists, and the scan runs afterwards");
  reset();
  const store = new MemoryStore();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let scanFinished = false;
  const background: Array<Promise<void>> = [];
  const payload = withInstallation();
  const routeCall = routeGitHubWebhook({
    rawBody: Buffer.from(JSON.stringify(payload)),
    eventHeader: "pull_request",
    signatureHeader: undefined,
    deliveryHeader: randomUUID(),
    webhookSecret: "",
    skipSignatureVerification: true,
    deps: {
      provisionOrg: async () => ({ orgId: "o", created: false }),
      // The synchronous path, for a route that does not know accept (main).
      handlePullRequest: async (a) =>
        handlePullRequestWebhook({ ...baseOptions(store, WITHIN, a.payload), deliveryId: a.deliveryId, resolveSemgrep: async () => { await gate; return PR_DIFF; } })
          .then((r) => { scanFinished = true; return r; }),
      acceptPullRequest: async (a) =>
        acceptPullRequestDelivery({ ...baseOptions(store, WITHIN, a.payload), deliveryId: a.deliveryId, resolveSemgrep: async () => { await gate; return PR_DIFF; } }),
      runInBackground: (_label, task) => { background.push(task().then((r) => { scanFinished = true; return r; }).then(() => undefined)); },
    },
  });
  // A route that waits for the scan never answers while the gate is shut.
  const answered = await Promise.race([routeCall.then((r) => ({ r })), sleep(1500).then(() => null)]);
  if (answered === null) {
    assert(false, "the route answered while the scan was still blocked (it waited for the scan instead)");
    release();
    const late = await routeCall;
    console.log(`       answered only after the scan: ${JSON.stringify(late)}; scan finished: ${scanFinished}`);
    return;
  }
  const response = answered.r;
  const rowAtResponse = store.only();
  console.log(`       response: ${JSON.stringify(response)}; scan finished at response time: ${scanFinished}; row status at response time: ${rowAtResponse?.status}`);
  assertEq(response.status, 202, "the route answered 202");
  assertEq((response.body as { status?: unknown }).status, "accepted", "body says accepted");
  assertEq((response.body as { scanRunId?: unknown }).scanRunId, rowAtResponse?.id, "body carries the row id");
  assertEq(scanFinished, false, "the scan had not finished when the route answered");
  assertEq(rowAtResponse?.status, "pending", "the row existed, pending, when the route answered");
  assertEq(posts(), 0, "no comment had been posted when the route answered");
  release();
  await Promise.all(background);
  await sleep(5);
  const row = store.only();
  console.log(`       after the background scan: status ${row?.status}, code ${row?.code}, comments posted ${posts()}, finish calls ${store.finishCalls}`);
  assertEq([row?.status, row?.code, posts(), store.finishCalls], ["completed", null, 1, 1], "the background scan completed the row, posted once, finished the row once");
  assertEq(unexpected, [], "no request outside the recorder's routes");
}

async function testBudgetBeforeFetch(): Promise<void> {
  section("B. the budget is read before the pull request is fetched");
  for (const [label, budget, wantPulls, wantStatus] of [
    ["cap reached", EXCEEDED, 0, "skipped"],
    ["unverifiable", UNVERIFIABLE, 0, "skipped"],
    ["within budget", WITHIN, 1, "completed"],
  ] as const) {
    reset();
    const store = new MemoryStore();
    // No resolveSemgrep: the diff comes from GET /pulls, as in production.
    const result = await handlePullRequestWebhook(baseOptions(store, budget, withInstallation()));
    const row = store.only();
    console.log(`       ${label}: GET /pulls ${pulls()}, comment posts ${posts()}, row ${row?.status}/${row?.code}, requests ${JSON.stringify(requests)}`);
    assertEq(pulls(), wantPulls, `${label}: the pull request was fetched ${wantPulls} time(s)`);
    assertEq([result.ok, posts(), row?.status], [true, 1, wantStatus], `${label}: notice or report posted once, row ${wantStatus}`);
  }
}

async function testUnpricedRefused(): Promise<void> {
  section("C. a delivery with no installation is refused unless explicitly unpriced");
  reset();
  const store = new MemoryStore();
  let resolverCalls = 0;
  const refused = await handlePullRequestWebhook({ ...baseOptions(store, WITHIN, SAMPLE), resolveSemgrep: () => { resolverCalls++; return PR_DIFF; } });
  console.log(`       without the flag: ${JSON.stringify(refused)}; resolver calls ${resolverCalls}; requests ${requests.length}; rows ${store.rows.size}`);
  assert(!refused.ok && refused.unpricedRefused === true, "refused with unpricedRefused");
  assertEq([resolverCalls, requests.length, store.rows.size, posts()], [0, 0, 0, 0], "nothing was fetched, scanned, recorded or posted");

  const response = await routeGitHubWebhook({
    rawBody: Buffer.from(JSON.stringify(SAMPLE)), eventHeader: "pull_request", signatureHeader: undefined,
    deliveryHeader: randomUUID(), webhookSecret: "", skipSignatureVerification: true,
    deps: {
      provisionOrg: async () => ({ orgId: "o", created: false }),
      handlePullRequest: async () => { throw new Error("not used"); },
      acceptPullRequest: async (a) => acceptPullRequestDelivery({ ...baseOptions(store, WITHIN, a.payload), deliveryId: a.deliveryId }),
    },
  });
  console.log(`       through the route: ${JSON.stringify(response)}`);
  assertEq(response.status, 502, "the route reports it as a failed delivery (502)");

  reset();
  const allowed = await handlePullRequestWebhook({ ...baseOptions(store, WITHIN, SAMPLE), allowUnpricedScan: true, token: "pat", resolveSemgrep: () => { resolverCalls++; return PR_DIFF; } });
  console.log(`       with allowUnpricedScan: ok ${allowed.ok}, resolver calls ${resolverCalls}, comment posts ${posts()}, rows ${store.rows.size}`);
  assertEq([allowed.ok, resolverCalls, posts(), store.rows.size], [true, 1, 1, 0], "control: with the flag it scans and posts, with no row (no installation to scope one to)");
}

async function testSweeper(): Promise<void> {
  section("D. the sweeper: one retry for pending and running, then interrupted; young and finished rows untouched");
  const store = new MemoryStore();
  const now = new Date("2026-09-25T12:00:00Z");
  const old = new Date(now.getTime() - 15 * 60_000);
  const young = new Date(now.getTime() - 2 * 60_000);
  const pendingOld = store.seed({ status: "pending", startedAt: old });
  const runningOld = store.seed({ status: "running", startedAt: old });
  const retryingOld = store.seed({ status: "retrying", startedAt: old });
  const pendingYoung = store.seed({ status: "pending", startedAt: young });
  const completedOld = store.seed({ status: "completed", startedAt: old, finishedAt: old });
  const reruns: string[] = [];
  const notices: string[] = [];
  const deps = {
    store,
    rerun: async (row: UnfinishedScanRun) => { reruns.push(`${row.id}:${store.rows.get(row.id)?.status}`); },
    notify: async (row: UnfinishedScanRun) => { notices.push(row.id); },
    now: () => now,
  };
  const first = await sweepUnfinishedScanRuns(deps);
  const status = (r: MemRow) => store.rows.get(r.id)?.status;
  console.log(`       first sweep: ${JSON.stringify(first)}; reruns ${JSON.stringify(reruns)}; notices ${JSON.stringify(notices)}`);
  assertEq(first.retried, [pendingOld.id, runningOld.id], "pending and running rows are retried, oldest first");
  assertEq(reruns, [`${pendingOld.id}:retrying`, `${runningOld.id}:retrying`], "each is marked retrying before its re-run");
  assertEq(first.abandoned, [retryingOld.id], "the row already retrying is abandoned");
  assertEq(notices, [retryingOld.id], "and its pull request gets the notice");
  assertEq([status(retryingOld), store.rows.get(retryingOld.id)?.code, store.rows.get(retryingOld.id)?.errorMessage], ["failed", "interrupted", SCAN_RUN_MESSAGES.interrupted], "abandoned row: failed / interrupted with the fixed message");
  assertEq([status(pendingYoung), status(completedOld)], ["pending", "completed"], "a young row and a finished row are left alone");
  assertEq(first.skipped, [], "nothing was skipped");

  // The re-runs above did not finish their rows (a second death). The
  // next start must not run them a third time.
  reruns.length = 0;
  notices.length = 0;
  const second = await sweepUnfinishedScanRuns(deps);
  console.log(`       second sweep: ${JSON.stringify(second)}; reruns ${JSON.stringify(reruns)}; notices ${JSON.stringify(notices)}`);
  assertEq(second.retried, [], "second sweep: no third attempt");
  assertEq(second.abandoned, [pendingOld.id, runningOld.id], "second sweep: both are abandoned");
  assertEq(notices, [pendingOld.id, runningOld.id], "second sweep: both pull requests get the notice");
  assertEq([status(pendingOld), status(runningOld)], ["failed", "failed"], "second sweep: both rows are failed");

  // A row finished between the listing and the update is left alone.
  const racing = store.seed({ status: "running", startedAt: old });
  const racingStore = Object.create(store) as MemoryStore;
  racingStore.markRetrying = async (id: string) => {
    if (id === racing.id) { await store.finish(id, { status: "completed", code: null, totalFindings: 0, findingsByFamily: {}, fixesGenerated: 0, costUsd: 0 }, now); return false; }
    return store.markRetrying(id);
  };
  const third = await sweepUnfinishedScanRuns({ ...deps, store: racingStore });
  console.log(`       third sweep (row finishes during the sweep): ${JSON.stringify(third)}`);
  assertEq([third.skipped, third.retried, status(racing)], [[racing.id], [], "completed"], "a row that finished meanwhile is skipped, not re-run");
}

async function testDeadline(): Promise<void> {
  section("E. a scan that outlives its deadline: row closed as timed_out once, the late result changes nothing");
  reset();
  const store = new MemoryStore();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const options = { ...baseOptions(store, WITHIN, withInstallation()), scanDeadlineMs: 30, resolveSemgrep: async () => { await gate; return PR_DIFF; } };
  const accepted = await acceptPullRequestDelivery(options);
  assert(accepted.accepted, "accepted");
  if (!accepted.accepted) return;
  const result = await accepted.run();
  const row = store.only();
  console.log(`       at the deadline: ${JSON.stringify({ ok: result.ok, timedOut: !result.ok && result.timedOut })}; row ${row?.status}/${row?.code}; finish calls ${store.finishCalls}`);
  assert(!result.ok && result.timedOut === true, "the run answered timedOut");
  assertEq([row?.status, row?.code, row?.errorMessage, store.finishCalls], ["failed", "timed_out", SCAN_RUN_MESSAGES.timed_out, 1], "row failed / timed_out, finished once");
  release();
  await sleep(50);
  const later = store.only();
  console.log(`       after the late scan settled: row ${later?.status}/${later?.code}; finish calls ${store.finishCalls}; comment posts ${posts()}`);
  assertEq([later?.status, later?.code, store.finishCalls], ["failed", "timed_out", 1], "the late result did not reopen or re-finish the row");
}

async function testDrain(): Promise<void> {
  section("F. shutdown waits for in-flight scans, up to a limit");
  const tracker = new InFlightTracker();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  void tracker.track("slow", () => gate);
  void tracker.track("failing", async () => { throw new Error("boom"); });
  await sleep(1);
  const early = await tracker.drain(20);
  console.log(`       drain with one task blocked: ${JSON.stringify(early)}`);
  assertEq(early, { drained: false, remaining: 1 }, "the drain times out with the blocked scan still counted; the failed one is gone");
  release();
  const late = await tracker.drain(1000);
  console.log(`       drain after release: ${JSON.stringify(late)}`);
  assertEq(late, { drained: true, remaining: 0 }, "the drain completes once the scan finishes");
}

async function testUnrecordedDelivery(): Promise<void> {
  section("G. the row insert fails: 503 not_recorded, and the run still posts the not-scanned notice");
  reset();
  const store = new MemoryStore();
  store.createThrows = true;
  const background: Array<Promise<unknown>> = [];
  const response = await routeGitHubWebhook({
    rawBody: Buffer.from(JSON.stringify(withInstallation())), eventHeader: "pull_request", signatureHeader: undefined,
    deliveryHeader: randomUUID(), webhookSecret: "", skipSignatureVerification: true,
    deps: {
      provisionOrg: async () => ({ orgId: "o", created: false }),
      handlePullRequest: async () => { throw new Error("not used"); },
      acceptPullRequest: async (a) => acceptPullRequestDelivery({ ...baseOptions(store, WITHIN, a.payload), deliveryId: a.deliveryId, resolveSemgrep: () => PR_DIFF }),
      runInBackground: (_l, task) => { background.push(task()); },
    },
  });
  await Promise.all(background);
  console.log(`       response: ${JSON.stringify(response)}; comment posts ${posts()}; notice: ${commentBodies[0]?.includes("Fixor did not scan this commit")}`);
  assertEq([response.status, (response.body as { status?: unknown }).status], [503, "not_recorded"], "503 not_recorded: GitHub shows a failed delivery the owner can redeliver");
  assert(posts() === 1 && commentBodies[0]?.includes("Fixor did not scan this commit"), "the not-scanned notice was still posted in the background");
}

async function testRealRerun(): Promise<void> {
  section("H. re-running a retrying row: no new row, the row stays marked as the retry, then completes");
  reset();
  const store = new MemoryStore();
  const row = store.seed({ status: "retrying", startedAt: new Date(Date.now() - 15 * 60_000) });
  const unfinished = (await store.listUnfinished(new Date(), 10))[0]!;
  const result = await rerunRecordedScanRun(unfinished, store, { resolveSemgrep: () => PR_DIFF, checkBudgetImpl: async () => WITHIN });
  const after = store.rows.get(row.id);
  console.log(`       result ok ${result.ok}; store calls ${JSON.stringify(store.calls)}; row ${after?.status}/${after?.code}; mint+comment requests ${JSON.stringify(requests)}`);
  assertEq(store.calls, ["running", "finish"], "no insert: the row already exists; running then finish");
  assertEq([result.ok, after?.status, after?.code, posts()], [true, "completed", null, 1], "the retry completed the row and posted the report");
  // Mid-retry, markRunning left the row retrying (pending-only), so a
  // death during the retry is still recognized as a second failure.
  const store2 = new MemoryStore();
  const row2 = store2.seed({ status: "retrying", startedAt: new Date(Date.now() - 15 * 60_000) });
  await store2.markRunning(row2.id);
  assertEq(store2.rows.get(row2.id)?.status, "retrying", "markRunning on a retrying row leaves it retrying");
}

async function testInterruptedNotice(): Promise<void> {
  section("I. the interrupted notice: did-not-scan wording, no Summary, posted with the installation token");
  reset();
  const store = new MemoryStore();
  store.seed({ status: "retrying", startedAt: new Date(Date.now() - 15 * 60_000) });
  const row = (await store.listUnfinished(new Date(), 10))[0]!;
  const posted = await postInterruptedNotice(row);
  const body = commentBodies[0] ?? "";
  console.log(`       posted: ${posted.commentAction}; requests ${JSON.stringify(requests)}`);
  assertEq(posted.commentAction, "created", "a comment was created");
  assert(requests.some((r) => /access_tokens$/.test(r)), "the installation token was minted for it");
  assert(body.includes("Fixor did not scan this commit") && body.includes("interrupted"), "the body says the commit was not scanned and why");
  assert(!body.includes("### Summary") && !body.includes("budget reached"), "no Summary table, no budget wording");
}

// ---- the production store's SQL over a recording pg client -------------------

interface Stmt { text: string; params: unknown[] }
class FakePg {
  statements: Stmt[] = [];
  async query(config: string | { text: string; rowMode?: string }, params: unknown[] = []) {
    const textSql = typeof config === "string" ? config : config.text;
    this.statements.push({ text: textSql, params });
    const lower = textSql.toLowerCase();
    if (lower.startsWith('update "scan_runs"')) return { rows: lower.includes("returning") ? [[randomUUID()]] : [], rowCount: 1 };
    if (lower.startsWith("select")) return { rows: [], rowCount: 0 };
    throw new Error(`FakePg: unrecognized statement: ${textSql}`);
  }
}
type BackendDb = ReturnType<typeof productionDb>;

async function testDrizzleSweepSql(): Promise<void> {
  section("J. production store SQL: pending-only markRunning, the sweep listing and markRetrying");
  const pg = new FakePg();
  const store = drizzleScanRunStore(() => drizzle(pg as unknown as never) as unknown as BackendDb);
  const id = randomUUID();
  await store.markRunning(id);
  const running = pg.statements[0]!;
  const runningWhere = running.text.toLowerCase().slice(running.text.toLowerCase().indexOf(" where "));
  console.log(`       markRunning: ${running.text} ${JSON.stringify(running.params)}`);
  assert(/"status" = \$\d+/.test(runningWhere) && running.params.includes("pending"), "markRunning's WHERE requires status = 'pending'");
  assert(/"finished_at" is null/.test(runningWhere), "markRunning's WHERE requires finished_at IS NULL");

  pg.statements.length = 0;
  await store.listUnfinished(new Date("2026-09-25T11:50:00Z"), 20);
  const list = pg.statements[0]!;
  const lower = list.text.toLowerCase();
  console.log(`       listUnfinished: ${list.text}`);
  assert(/"finished_at" is null/.test(lower), "listUnfinished: finished_at IS NULL");
  assert(/"status" in \(/.test(lower) && ["pending", "running", "retrying"].every((s) => list.params.includes(s)), "listUnfinished: status IN (pending, running, retrying)");
  assert(/"started_at" < \$\d+/.test(lower), "listUnfinished: started_at before the cutoff");
  assert(/order by "scan_runs"\."started_at" asc/.test(lower) && /limit \$\d+/.test(lower), "listUnfinished: oldest first, limited");

  pg.statements.length = 0;
  const marked = await store.markRetrying(id);
  const retry = pg.statements[0]!;
  console.log(`       markRetrying: ${retry.text} ${JSON.stringify(retry.params)}`);
  assert(marked === true, "markRetrying reports the update");
  assert(retry.params.includes("retrying") && /"status" in \(/.test(retry.text.toLowerCase()) && ["pending", "running"].every((s) => retry.params.includes(s)), "markRetrying: set retrying where status IN (pending, running)");
  assert(/"finished_at" is null/.test(retry.text.toLowerCase()) && /returning/.test(retry.text.toLowerCase()), "markRetrying: only an unfinished row, and it returns the id");
}

const EXPECTED_SECTIONS = 10;

async function main(): Promise<void> {
  if (getAnthropicClient() !== null) {
    console.error("[FAIL] an Anthropic client exists in this process; refusing to run");
    process.exit(1);
  }
  console.log("[PASS] no Anthropic client exists in this process");

  const sections: Array<() => unknown> = [
    testAckBeforeScan, testBudgetBeforeFetch, testUnpricedRefused, testSweeper, testDeadline,
    testDrain, testUnrecordedDelivery, testRealRerun, testInterruptedNotice, testDrizzleSweepSql,
  ];
  for (const run of sections) {
    try {
      await run();
    } catch (err) {
      assert(false, `section threw: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    }
  }
  assertEq(sectionsRun.length, EXPECTED_SECTIONS, "every section ran");
  assert(getAnthropicClient() === null, "still no Anthropic client after the run");
  console.log(failures === 0 ? "\nAck-then-scan witness: PASS." : `\nAck-then-scan witness: ${failures} FAILURE(S).`);
  process.exit(failures > 0 ? 1 : 0);
}

void main();
