/**
 * Witness: every pull_request delivery Fixor acts on leaves exactly one
 * scan_runs row, in the right final state, and the dashboard shows a row
 * only to a user who can see its repository.
 *
 * Until this change nothing wrote scan_runs, so every installation's scan
 * history was empty while the Privacy Policy described it as recorded.
 * This test drives the real handler and the real route, with `fetch`
 * replaced by a recorder, and proves:
 *
 *   - the row and final state for: budget cap reached, budget
 *     unverifiable, PR fetch refused, comment refused, a regex-only scan
 *     that posts (findings_by_family {"secrets-exposure-multi": 1}, $0),
 *     and an exception mid-handler; the final state is written once;
 *   - a repeated X-GitHub-Delivery is not scanned twice, through the
 *     in-memory store AND through the production Drizzle store, whose
 *     guard is its ON CONFLICT clause;
 *   - a failed insert still scans (history is observability here);
 *   - error_message holds only fixed messages;
 *   - cost_usd comes from the scan's own async-local total, and
 *     recordCost writes scan_run_id, model and the token columns;
 *   - the dashboard's scan_runs queries, loaded from
 *     apps/dashboard/src/lib/scan-queries.ts itself, return no row for a
 *     repository outside the user's visible list.
 *
 * No Postgres runs here or in CI. The production SQL goes to a recording
 * `pg` client that enforces the one unique index as Postgres does (a
 * duplicate delivery_id inserts nothing under ON CONFLICT DO NOTHING and
 * raises SQLSTATE 23505 without it) and evaluates the WHERE clauses the
 * dashboard queries produce. Unrecognized SQL fails the test rather than
 * passing silently.
 *
 * Keyless and $0 by construction: no Anthropic key and no client exist in
 * this process (asserted before anything runs), the only detector that
 * produces a finding is the regex-only secrets check, `fetch` is replaced
 * before any request, Sentry keeps every event in memory, the App JWT is
 * signed with a throwaway RSA key, DATABASE_URL is unset, and Cloudinary
 * is unconfigured.
 */

// Before any import: nothing in this process may reach a paid or live
// service, whatever the shell environment holds.
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
import * as Sentry from "@sentry/node";
import * as ts from "typescript";
import { drizzle } from "drizzle-orm/node-postgres";

import { getAnthropicClient } from "../analysis-engine/anthropic-client";
import { db as productionDb } from "../db/client";
import { clearInstallationTokenCache } from "../integrations/github/app-auth.service";
import { handlePullRequestWebhook } from "../integrations/github/pr-webhook-handler";
import { addScanSpend, costContext } from "../lib/cost-context";
import { logger } from "../lib/logger";
import { routeGitHubWebhook } from "../server/github-webhook-route";
import { recordCost, type BudgetCheck } from "../services/cost-store";
import {
  drizzleScanRunStore,
  outcomeFromWorkflow,
  SCAN_RUN_MESSAGES,
  type ScanRunCreateResult,
  type ScanRunOutcome,
  type ScanRunStart,
  type ScanRunStore,
} from "../services/scan-run-store";
import type { WorkflowResult } from "../types/workflow.types";

// Signs the App JWT in place of the real key, which this test never reads.
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

// ---- observers: the error log and Sentry ------------------------------------

interface LoggedError { fields: Record<string, unknown>; msg: string }
const errorLogs: LoggedError[] = [];
const realError = logger.error.bind(logger);
(logger as unknown as { error: (...args: unknown[]) => void }).error = (...args: unknown[]) => {
  const [first, second] = args;
  errorLogs.push({
    fields: first && typeof first === "object" ? (first as Record<string, unknown>) : {},
    msg: typeof first === "string" ? first : String(second ?? ""),
  });
  (realError as (...a: unknown[]) => void)(...args);
};

const sentryEvents: Sentry.Event[] = [];
Sentry.init({
  dsn: "https://witness@o0.ingest.sentry.io/0",
  beforeSend(event) {
    sentryEvents.push(event);
    return null;
  },
  transport: () => ({ send: async () => ({}), flush: async () => true }),
  defaultIntegrations: false,
});

// ---- the recorder that replaces fetch --------------------------------------

interface Scenario { diffStatus: number; postStatus: number }
let scenario: Scenario = { diffStatus: 200, postStatus: 201 };
const requests: string[] = [];
const unexpected: string[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

// Fragmented so the repo's own secret scan never sees a whole key.
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
  requests.push(`${method} ${url}`);
  if (method === "POST" && /\/app\/installations\/\d+\/access_tokens$/.test(url)) {
    return json(201, { token: "from-installation", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
  }
  if (method === "GET" && /\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(url)) {
    return scenario.diffStatus === 200 ? text(200, PR_DIFF) : json(scenario.diffStatus, { message: "Not Found" });
  }
  if (method === "GET" && /\/repos\/[^/]+\/[^/]+\/contents\//.test(url)) {
    return text(200, 'export const region = "eu";\n');
  }
  if (method === "GET" && /\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments(\?|$)/.test(url)) {
    return json(200, []);
  }
  if (method === "POST" && /\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/.test(url)) {
    return scenario.postStatus === 201
      ? json(201, { id: 901, html_url: "https://github.com/acme-corp/demo-app/pull/7#issuecomment-901" })
      : json(scenario.postStatus, { message: "Resource not accessible by integration" });
  }
  unexpected.push(`${method} ${url}`);
  return json(599, { message: "unexpected request in the witness" });
}) as typeof fetch;

// ---- the in-memory store ------------------------------------------------------

interface MemRow extends ScanRunStart {
  id: string;
  status: string;
  code: string | null;
  errorMessage: string | null;
  totalFindings: number;
  findingsByFamily: Record<string, number>;
  fixesGenerated: number;
  costUsd: number;
  finishedAt: Date | null;
}

class MemoryStore implements ScanRunStore {
  rows = new Map<string, MemRow>();
  calls: string[] = [];
  finishCalls = 0;
  async createPending(s: ScanRunStart): Promise<ScanRunCreateResult> {
    this.calls.push("create");
    if (s.deliveryId !== null && [...this.rows.values()].some((r) => r.deliveryId === s.deliveryId)) {
      return { created: false, reason: "duplicate_delivery" };
    }
    const id = `run-${this.rows.size + 1}`;
    this.rows.set(id, {
      ...s, id, status: "pending", code: null, errorMessage: null,
      totalFindings: 0, findingsByFamily: {}, fixesGenerated: 0, costUsd: 0, finishedAt: null,
    });
    return { created: true, id };
  }
  async markRunning(id: string): Promise<void> {
    this.calls.push("running");
    const r = this.rows.get(id);
    if (r) r.status = "running";
  }
  async finish(id: string, o: ScanRunOutcome, at: Date): Promise<void> {
    this.calls.push("finish");
    this.finishCalls++;
    const r = this.rows.get(id);
    if (!r || r.finishedAt !== null) return;
    Object.assign(r, {
      status: o.status,
      code: o.code,
      errorMessage: o.code ? SCAN_RUN_MESSAGES[o.code] : null,
      totalFindings: o.totalFindings,
      findingsByFamily: o.findingsByFamily,
      fixesGenerated: o.fixesGenerated,
      costUsd: o.costUsd,
      finishedAt: at,
    });
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
const SECRETS_ONLY = { "secrets-exposure-multi": 1 };
const FIXED_MESSAGES = new Set(Object.values(SCAN_RUN_MESSAGES));

interface DeliverOpts {
  store: ScanRunStore;
  budget?: BudgetCheck;
  diffStatus?: number;
  postStatus?: number;
  injectDiff?: boolean;
  deliveryId?: string | null;
  resolveThrows?: boolean;
}

async function deliver(o: DeliverOpts) {
  scenario = { diffStatus: o.diffStatus ?? 200, postStatus: o.postStatus ?? 201 };
  errorLogs.length = 0;
  sentryEvents.length = 0;
  requests.length = 0;
  unexpected.length = 0;
  clearInstallationTokenCache();
  const payload = { ...SAMPLE, installation: { id: INSTALLATION_ID } };
  const budget = o.budget ?? WITHIN;
  const resolveSemgrep = o.resolveThrows
    ? () => { throw new Error("resolver exploded with internal detail db.internal:5432"); }
    : () => PR_DIFF;
  const result = await handlePullRequestWebhook({
    rawBody: JSON.stringify(payload),
    payload,
    dryRun: false,
    skipSignatureVerification: true,
    updateExisting: true,
    usePrDiffFallback: true,
    ...(o.injectDiff === false ? {} : { resolveSemgrep }),
    checkBudgetImpl: async () => budget,
    workflowMetadata: { scanId: "scan-runs-witness" },
    deliveryId: o.deliveryId === undefined ? randomUUID() : o.deliveryId,
    scanRunStore: o.store,
  });
  await Sentry.flush(1000);
  assertEq(unexpected, [], "no request outside the recorder's routes");
  return result;
}

function assertRow(
  store: MemoryStore,
  expected: { status: string; code: string | null; totalFindings: number; findingsByFamily: Record<string, number>; fixesGenerated: number; calls: string[] },
  label: string,
): void {
  const row = store.only();
  assert(row !== undefined, `${label}: exactly one row`);
  if (!row) return;
  assertEq(
    [row.installationId, row.repoFullName, row.pullNumber, row.headSha],
    [String(INSTALLATION_ID), "acme-corp/demo-app", 7, HEAD_SHA],
    `${label}: row carries the installation and pull request coordinates`,
  );
  assertEq([row.status, row.code], [expected.status, expected.code], `${label}: final status and code`);
  assertEq(
    row.errorMessage,
    expected.code ? SCAN_RUN_MESSAGES[expected.code as keyof typeof SCAN_RUN_MESSAGES] : null,
    `${label}: error_message is the fixed message for the code`,
  );
  assertEq([row.totalFindings, row.findingsByFamily, row.fixesGenerated, row.costUsd], [expected.totalFindings, expected.findingsByFamily, expected.fixesGenerated, 0], `${label}: counts and $0 cost`);
  assert(row.finishedAt instanceof Date, `${label}: finished_at is set`);
  assertEq(store.calls, expected.calls, `${label}: lifecycle calls, final state written once`);
}

async function testCapReached(): Promise<void> {
  section("A. budget cap reached -> skipped / budget_exceeded");
  const store = new MemoryStore();
  const result = await deliver({ store, budget: EXCEEDED });
  assert(result.ok, "handler completes and posts the budget notice");
  assertRow(store, { status: "skipped", code: "budget_exceeded", totalFindings: 0, findingsByFamily: {}, fixesGenerated: 0, calls: ["create", "finish"] }, "cap");
}

async function testUnverifiable(): Promise<void> {
  section("B. budget unverifiable -> skipped / budget_unverifiable");
  const store = new MemoryStore();
  const result = await deliver({ store, budget: UNVERIFIABLE });
  assert(result.ok, "handler completes and posts the did-not-scan notice");
  assertRow(store, { status: "skipped", code: "budget_unverifiable", totalFindings: 0, findingsByFamily: {}, fixesGenerated: 0, calls: ["create", "finish"] }, "unverifiable");
}

async function testPrFetchRefused(): Promise<void> {
  section("C. PR fetch refused -> failed / pr_fetch_refused");
  const store = new MemoryStore();
  const result = await deliver({ store, diffStatus: 404, injectDiff: false });
  assert(!result.ok && result.githubError?.status === 404, "handler reports the refused fetch");
  assertRow(store, { status: "failed", code: "pr_fetch_refused", totalFindings: 0, findingsByFamily: {}, fixesGenerated: 0, calls: ["create", "finish"] }, "pr fetch");
}

async function testCommentRefused(): Promise<void> {
  section("D. comment refused -> failed / comment_refused, with the scan's counts");
  const store = new MemoryStore();
  const result = await deliver({ store, postStatus: 403 });
  assert(!result.ok && result.githubError?.status === 403, "handler reports the refused comment");
  assertRow(store, { status: "failed", code: "comment_refused", totalFindings: 1, findingsByFamily: SECRETS_ONLY, fixesGenerated: 1, calls: ["create", "running", "finish"] }, "comment");
}

async function testSuccess(): Promise<void> {
  section("E. regex-only scan that posts -> completed, secrets-exposure-multi: 1, $0");
  const store = new MemoryStore();
  const result = await deliver({ store });
  assert(result.ok && result.comment.commentPosted, "comment posted");
  assertRow(store, { status: "completed", code: null, totalFindings: 1, findingsByFamily: SECRETS_ONLY, fixesGenerated: 1, calls: ["create", "running", "finish"] }, "success");
}

async function testThrowMidHandler(): Promise<void> {
  section("F. exception mid-handler -> failed / internal_error, raw text never stored");
  const store = new MemoryStore();
  let threw = false;
  try {
    await deliver({ store, resolveThrows: true });
  } catch {
    threw = true;
  }
  assert(threw, "the handler still throws to its caller");
  assertRow(store, { status: "failed", code: "internal_error", totalFindings: 0, findingsByFamily: {}, fixesGenerated: 0, calls: ["create", "finish"] }, "throw");
  assert(!/exploded|5432/.test(store.only()?.errorMessage ?? ""), "the exception's text is not in error_message");
}

async function testDuplicateDeliveryThroughRoute(): Promise<void> {
  section("G. the same X-GitHub-Delivery twice through the route -> scanned once");
  const store = new MemoryStore();
  const deliveryId = randomUUID();
  const payload = { ...SAMPLE, installation: { id: INSTALLATION_ID } };
  const raw = Buffer.from(JSON.stringify(payload));
  const route = async () => {
    requests.length = 0;
    clearInstallationTokenCache();
    return routeGitHubWebhook({
      rawBody: raw,
      eventHeader: "pull_request",
      signatureHeader: undefined,
      deliveryHeader: deliveryId.toUpperCase(),
      webhookSecret: "",
      skipSignatureVerification: true,
      deps: {
        provisionOrg: async () => ({ orgId: "o", created: false }),
        handlePullRequest: async (a) =>
          handlePullRequestWebhook({
            rawBody: a.rawBody,
            payload: a.payload,
            dryRun: false,
            skipSignatureVerification: true,
            updateExisting: true,
            resolveSemgrep: () => PR_DIFF,
            checkBudgetImpl: async () => WITHIN,
            deliveryId: a.deliveryId,
            scanRunStore: store,
          }),
      },
    });
  };
  scenario = { diffStatus: 200, postStatus: 201 };
  const first = await route();
  const firstRequests = requests.length;
  const second = await route();
  assertEq(first.status, 200, "first delivery answered 200");
  assert(firstRequests > 0, "first delivery reached GitHub (token, comment)");
  assertEq(store.only()?.deliveryId, deliveryId, "the header reached the row, normalized to lower case");
  assertEq(second.status, 200, "second delivery answered 200, not a failure");
  assertEq((second.body as { duplicateDelivery?: unknown }).duplicateDelivery, true, "second delivery marked as a duplicate");
  assertEq(requests.length, 0, "second delivery made no GitHub request: nothing ran");
  assertEq(store.calls, ["create", "running", "finish", "create"], "one scan, one final state");
}

// ---- the production Drizzle store over a recording pg client ----------------

interface Stmt { text: string; params: unknown[] }

/**
 * Enough of `pg` for Drizzle's node-postgres session, backed by a
 * scan_runs table keyed by delivery_id with Postgres's unique-index
 * behaviour. Any statement it does not recognize throws.
 */
class FakePg {
  statements: Stmt[] = [];
  deliveries = new Set<string>();
  async query(config: string | { text: string; rowMode?: string }, params: unknown[] = []) {
    const textSql = typeof config === "string" ? config : config.text;
    this.statements.push({ text: textSql, params });
    const lower = textSql.toLowerCase();
    if (lower.startsWith('insert into "installations"')) return { rows: [], rowCount: 1 };
    if (lower.startsWith('insert into "cost_ledger"')) return { rows: [], rowCount: 1 };
    if (lower.startsWith('update "scan_runs"')) return { rows: [], rowCount: 1 };
    if (lower.startsWith('insert into "scan_runs"')) {
      const cols = [...textSql.slice(textSql.indexOf("(") + 1, textSql.indexOf(")")).matchAll(/"(\w+)"/g)].map((m) => m[1]);
      const valuesPart = textSql.slice(lower.indexOf(" values ") + 8);
      const values = valuesPart.slice(valuesPart.indexOf("(") + 1, valuesPart.indexOf(")")).split(",").map((v) => v.trim());
      const token = values[cols.indexOf("delivery_id")];
      const deliveryId = token && token.startsWith("$") ? params[Number(token.slice(1)) - 1] : null;
      if (typeof deliveryId === "string" && this.deliveries.has(deliveryId)) {
        if (/on conflict \("delivery_id"\) do nothing/.test(lower)) return { rows: [], rowCount: 0 };
        throw Object.assign(new Error('duplicate key value violates unique constraint "scan_runs_delivery_id_idx"'), { code: "23505", severity: "ERROR" });
      }
      if (typeof deliveryId === "string") this.deliveries.add(deliveryId);
      return { rows: [[randomUUID()]], rowCount: 1 };
    }
    throw new Error(`FakePg: unrecognized statement: ${textSql}`);
  }
}

type BackendDb = ReturnType<typeof productionDb>;
function fakeDb(pg: FakePg): BackendDb {
  return drizzle(pg as unknown as never) as unknown as BackendDb;
}

async function testDrizzleStore(): Promise<void> {
  section("H. production Drizzle store: SQL, conflict guard, write-once final state");
  const pg = new FakePg();
  const store = drizzleScanRunStore(() => fakeDb(pg));
  const start: ScanRunStart = {
    installationId: "3101", deliveryId: randomUUID(), repoFullName: "acme-corp/demo-app",
    pullNumber: 7, headSha: HEAD_SHA, startedAt: new Date(),
  };
  const first = await store.createPending(start);
  assert(first.created, "first insert creates a row");
  const [ensure, insert] = pg.statements;
  assert(/^insert into "installations"/i.test(ensure?.text ?? ""), "installations upserted before the scan_runs insert");
  assert(/on conflict \("id"\) do update/i.test(ensure?.text ?? ""), "the installations upsert keeps an existing row");
  assert(/^insert into "scan_runs"/i.test(insert?.text ?? ""), "then scan_runs is inserted");
  assert(/on conflict \("delivery_id"\) do nothing/i.test(insert?.text ?? ""), "the insert carries ON CONFLICT (delivery_id) DO NOTHING");
  assert(/returning "id"/i.test(insert?.text ?? ""), "the insert returns the new id");
  assert((insert?.params ?? []).includes("pending"), "the row starts pending");

  const again = await store.createPending(start);
  assertEq(again, { created: false, reason: "duplicate_delivery" }, "the same delivery_id inserts nothing and reports a duplicate");

  pg.statements.length = 0;
  if (first.created) {
    await store.finish(first.id, {
      status: "failed", code: "comment_refused", totalFindings: 1,
      findingsByFamily: SECRETS_ONLY, fixesGenerated: 0, costUsd: 0.0123,
    }, new Date());
  }
  const upd = pg.statements[0];
  assert(/^update "scan_runs" set/i.test(upd?.text ?? ""), "finish is one UPDATE");
  assert(/"finished_at" is null/i.test(upd?.text ?? ""), "finish only applies to a row not yet finished");
  assert((upd?.params ?? []).includes(SCAN_RUN_MESSAGES.comment_refused), "error_message is the fixed message");
  assert((upd?.params ?? []).includes("0.012300"), "cost_usd written from the outcome");
  const strings = (upd?.params ?? []).filter((p): p is string => typeof p === "string");
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const messageish = strings.filter((s) => s.length > 30 && !s.startsWith("{") && !UUID.test(s) && Number.isNaN(Date.parse(s)));
  assert(messageish.every((s) => FIXED_MESSAGES.has(s)), "no free text other than a fixed message in the UPDATE");
}

async function testDrizzleStoreThroughHandler(): Promise<void> {
  section("I. handler + production Drizzle store: a redelivery is not scanned twice");
  const pg = new FakePg();
  const store = drizzleScanRunStore(() => fakeDb(pg));
  const deliveryId = randomUUID();
  const first = await deliver({ store, deliveryId });
  assert(first.ok && first.workflow.classifiedFindings === 1, "first delivery scanned");
  const second = await deliver({ store, deliveryId });
  assert(!second.ok && second.duplicateDelivery === true, "second delivery reported as a duplicate");
  assertEq(requests.length, 0, "second delivery made no GitHub request: no scan, no charge");
  assertEq(errorLogs.filter((l) => l.fields.phase === "scan_run_record").length, 0, "no insert failure was logged: the guard, not an error, stopped it");
}

async function testInsertFailureStillScans(): Promise<void> {
  section("J. scan_runs insert fails -> logged, sent to Sentry, scanned anyway");
  const failing: ScanRunStore = {
    createPending: async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); },
    markRunning: async () => { throw new Error("markRunning must not be called without a row"); },
    finish: async () => { throw new Error("finish must not be called without a row"); },
  };
  const result = await deliver({ store: failing });
  assert(result.ok && result.workflow.classifiedFindings === 1, "the scan ran and found the planted secret");
  const logs = errorLogs.filter((l) => l.fields.phase === "scan_run_record");
  assertEq(logs.map((l) => l.fields.step), ["create"], "one error line for the failed insert, none after");
  assertEq(sentryEvents.filter((e) => e.tags?.["fixor.phase"] === "scan_run_record").length, 1, "one Sentry event for it");
}

async function testCostAndLedger(): Promise<void> {
  section("K. per-scan cost is async-local; recordCost writes scan_run_id, model, tokens");
  const a = { usd: 0 };
  const b = { usd: 0 };
  const tick = () => new Promise((r) => setTimeout(r, 1));
  await Promise.all([
    costContext.run({ installationId: 1, scanSpend: a }, async () => { addScanSpend(0.01); await tick(); addScanSpend(0.02); }),
    costContext.run({ installationId: 2, scanSpend: b }, async () => { await tick(); addScanSpend(0.5); }),
  ]);
  assertEq([a.usd.toFixed(6), b.usd.toFixed(6)], ["0.030000", "0.500000"], "two concurrent scans keep separate totals");
  addScanSpend(9);
  assertEq([a.usd.toFixed(6), b.usd.toFixed(6)], ["0.030000", "0.500000"], "spend outside a scan is attributed to none");

  const pg = new FakePg();
  const runId = randomUUID();
  await recordCost("3101", 0.0123, {
    scanRunId: runId, model: "claude-opus-5-5", inputTokens: 1200, outputTokens: 80,
    cacheCreationInputTokens: 300, cacheReadInputTokens: 900,
  }, fakeDb(pg));
  const ins = pg.statements.find((s) => /^insert into "cost_ledger"/i.test(s.text));
  assert(ins !== undefined, "one cost_ledger insert");
  for (const col of ["scan_run_id", "model", "input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) {
    assert(new RegExp(`"${col}"`).test(ins?.text ?? ""), `cost_ledger insert names ${col}`);
  }
  assertEq(
    [runId, "claude-opus-5-5", 1200, 80, 300, 900].every((v) => (ins?.params ?? []).includes(v)),
    true,
    "and binds the scan id, model and all four token counts",
  );
}

function testOutcomeMapping(): void {
  section("L. workflow status -> row status");
  const base = {
    status: "failed", automationReady: false, automationDecisionReason: "", totalFindings: 2,
    sqlInjectionFindings: 0, classifiedFindings: 2, skippedFindings: 0, fixesGenerated: 0,
    highQualityPatches: 0, mediumQualityPatches: 0, lowQualityPatches: 0, fixes: [], errors: [{ message: "Failed to generate fix" }],
    metadata: {}, timing: { startedAt: "", finishedAt: "", durationMs: 0 },
    findingsByDetector: { "idor-multi": 2 },
    llmCoverage: { attempted: 4, failed: 0, byReason: {}, byCaller: {} },
  } as unknown as WorkflowResult;
  const pick = (o: ScanRunOutcome) => [o.status, o.code];
  assertEq(pick(outcomeFromWorkflow(base, 0.4, false)), ["completed", null], "findings with no fix: detection completed");
  assertEq(outcomeFromWorkflow(base, 0.4, false).costUsd, 0.4, "cost comes from the scan's own total");
  assertEq(pick(outcomeFromWorkflow({ ...base, llmCoverage: { ...base.llmCoverage!, failed: 1 } }, 0, false)), ["incomplete", "coverage_degraded"], "a failed detection call: incomplete");
  assertEq(pick(outcomeFromWorkflow({ ...base, detectorFailures: [{ detectorId: "idor-multi", reason: "x" }] }, 0, false)), ["incomplete", "coverage_degraded"], "a thrown detector: incomplete");
  assertEq(pick(outcomeFromWorkflow(base, 0, true)), ["incomplete", "coverage_degraded"], "degraded scan input: incomplete");
  assertEq(pick(outcomeFromWorkflow({ ...base, llmCoverage: undefined }, 0, false)), ["failed", "scan_failed"], "never reached detection: failed");
}

// ---- the dashboard queries, loaded from the dashboard's own source -------------

interface TableRow {
  id: string; installation_id: string; repo_full_name: string; pull_number: number; head_sha: string;
  status: string; total_findings: number; fixes_generated: number; cost_usd: string;
  started_at: string; finished_at: string | null; error_message: string | null;
}

/** Loads a dashboard .ts file as CommonJS under dist/, so `drizzle-orm` resolves to this package's copy. */
function loadDashboardModule(relFromSrc: string, deps: string[]): unknown {
  const outRoot = path.join(process.cwd(), "dist", "test", "dashboard-src");
  for (const rel of [relFromSrc, ...deps]) {
    const src = fs.readFileSync(path.join(process.cwd(), "apps", "dashboard", "src", `${rel}.ts`), "utf8");
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const file = path.join(outRoot, `${rel}.js`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, out);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(outRoot, `${relFromSrc}.js`));
}

/** Recording pg client that evaluates the dashboard's WHERE clauses over a small table. */
class DashboardPg {
  queries = 0;
  admitted: string[][] = [];
  constructor(private table: TableRow[]) {}
  async query(config: string | { text: string; rowMode?: string }, params: unknown[] = []) {
    this.queries++;
    const sqlText = typeof config === "string" ? config : config.text;
    const lower = sqlText.toLowerCase().replace(/\s+/g, " ");
    const m = /\swhere\s(.*?)(\sgroup by\s|\sorder by\s|\slimit\s|$)/.exec(lower);
    if (!m) throw new Error(`DashboardPg: query without WHERE: ${sqlText}`);
    const where = m[1]!;
    if (/\sor\s/.test(where)) throw new Error("DashboardPg: OR is not evaluated");
    const conjuncts = where.replace(/[()]/g, " ").split(/\sand\s/).length;
    const preds = [...where.matchAll(/(?:"scan_runs"\.)?"(\w+)"\s*(=|>=|in)\s*(\$\d+|\((?:\s*\$\d+\s*,?)+\))/g)];
    if (preds.length !== conjuncts) throw new Error(`DashboardPg: unrecognized predicate in: ${where}`);
    const arg = (tok: string) => params[Number(tok.slice(1)) - 1];
    const rows = this.table.filter((row) =>
      preds.every(([, col, op, rhs]) => {
        const value = (row as unknown as Record<string, unknown>)[col!];
        if (op === "=") return value === arg(rhs!);
        if (op === "in") return [...rhs!.matchAll(/\$\d+/g)].map((t) => arg(t[0])).includes(value);
        const bound = arg(rhs!);
        return new Date(String(value)) >= new Date(bound instanceof Date ? bound : String(bound));
      }),
    );
    this.admitted.push(rows.map((r) => r.id));
    if (!/^select "id", "repo_full_name"/.test(lower)) return { rows: [], rowCount: 0 };
    const cols = [...lower.slice(7, lower.indexOf(" from ")).matchAll(/"(\w+)"/g)].map((c) => c[1]!);
    return { rows: rows.map((r) => cols.map((c) => (r as unknown as Record<string, unknown>)[c])), rowCount: rows.length };
  }
}

async function testDashboardRepoFilter(): Promise<void> {
  section("M. dashboard queries return no row for a repository the user cannot see");
  const q = loadDashboardModule("lib/scan-queries", ["db/schema"]) as {
    selectScans: (d: unknown, i: string, r: string[], l: number) => Promise<Array<{ id: string }>>;
    selectScan: (d: unknown, i: string, r: string[], id: string) => Promise<{ id: string } | null>;
    selectWeekly: (d: unknown, i: string, r: string[], s: Date) => Promise<unknown[]>;
    selectByFamily: (d: unknown, i: string, r: string[], s: Date) => Promise<unknown[]>;
  };
  const now = new Date().toISOString();
  const mk = (id: string, installation: string, repo: string): TableRow => ({
    id, installation_id: installation, repo_full_name: repo, pull_number: 7, head_sha: HEAD_SHA,
    status: "completed", total_findings: 1, fixes_generated: 0, cost_usd: "0.000000",
    started_at: now, finished_at: now, error_message: null,
  });
  const visibleRow = mk(randomUUID(), "3101", "acme-corp/demo-app");
  const hiddenRow = mk(randomUUID(), "3101", "acme-corp/private-payroll");
  const otherInstallation = mk(randomUUID(), "9999", "acme-corp/demo-app");
  const pg = new DashboardPg([visibleRow, hiddenRow, otherInstallation]);
  const d = drizzle(pg as unknown as never);
  const visible = ["acme-corp/demo-app", "acme-corp/website"];
  const since = new Date(Date.now() - 86_400_000);

  const list = await q.selectScans(d, "3101", visible, 100);
  assertEq(list.map((r) => r.id), [visibleRow.id], "history lists the visible repository's scan only");
  assertEq(await q.selectScan(d, "3101", visible, hiddenRow.id), null, "detail of a hidden repository's scan is not found");
  assertEq((await q.selectScan(d, "3101", visible, visibleRow.id))?.id, visibleRow.id, "detail of a visible scan is found");
  pg.admitted.length = 0;
  await q.selectWeekly(d, "3101", visible, since);
  await q.selectByFamily(d, "3101", visible, since);
  assertEq(pg.admitted, [[visibleRow.id], [visibleRow.id]], "both trend queries count the visible repository's scan only");

  const before = pg.queries;
  assertEq(await q.selectScans(d, "3101", [], 100), [], "no visible repository: empty history");
  assertEq(await q.selectScan(d, "3101", [], visibleRow.id), null, "no visible repository: detail not found");
  assertEq(await q.selectByFamily(d, "3101", [], since), [], "no visible repository: empty trends");
  assertEq(pg.queries, before, "and no query is sent at all");
}

const EXPECTED_SECTIONS = 13;

async function main(): Promise<void> {
  if (getAnthropicClient() !== null) {
    console.error("[FAIL] an Anthropic client exists in this process; refusing to run");
    process.exit(1);
  }
  console.log("[PASS] no Anthropic client exists in this process");

  await testCapReached();
  await testUnverifiable();
  await testPrFetchRefused();
  await testCommentRefused();
  await testSuccess();
  await testThrowMidHandler();
  await testDuplicateDeliveryThroughRoute();
  await testDrizzleStore();
  await testDrizzleStoreThroughHandler();
  await testInsertFailureStillScans();
  await testCostAndLedger();
  testOutcomeMapping();
  await testDashboardRepoFilter();

  assertEq(sectionsRun.length, EXPECTED_SECTIONS, "every section ran");
  assert(getAnthropicClient() === null, "still no Anthropic client after the run");

  console.log(
    failures === 0
      ? "\nScan-runs witness: PASS."
      : `\nScan-runs witness: ${failures} FAILURE(S).`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
