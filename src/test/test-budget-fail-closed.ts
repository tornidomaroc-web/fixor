/**
 * Witness: the budget gate FAILS CLOSED.
 *
 * `checkBudget` used to return `withinBudget: true` when the ledger could
 * not be read, so a database outage ran every scan unpriced and uncapped.
 * This test proves the opposite on the real code paths:
 *
 *   - the real Drizzle/pg client with DATABASE_URL unset, and pointed at a
 *     closed port (127.0.0.1:1), is REFUSED with reason
 *     "budget_unverifiable" and the right failure kind;
 *   - when the database answers, the check PROCEEDS, and the existing
 *     monthly / daily / per-org-cap semantics hold (never covered by a
 *     keyless test before: test-cost-tracking.ts says so);
 *   - a transient failure is retried exactly once; query, config and
 *     unknown failures are not retried; a hung read times out;
 *   - the operator exemption stays open without touching the database;
 *   - end to end through the PR webhook handler with the REAL gate and an
 *     unreachable database, the scan never runs (the planted secret is
 *     never found) and the PR comment is the skipped-scan notice, never a
 *     clean report; with an answering gate the same PR is scanned.
 *
 * Keyless and $0 by construction: no Anthropic key and no client exist in
 * this process (asserted before anything runs), the only detector that
 * produces a finding here is the regex-only secrets check, dryRun keeps
 * the GitHub comment local, Cloudinary is unconfigured (its upload throws
 * before any network call), and the only socket opened is the refused
 * connect to 127.0.0.1:1.
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

import * as fs from "fs";
import * as path from "path";

import { getAnthropicClient } from "../analysis-engine/anthropic-client";
import { closeDb } from "../db/client";
import { handlePullRequestWebhook } from "../integrations/github/pr-webhook-handler";
import type { ScanRunStore } from "../services/scan-run-store";
import {
  budgetRefusalHttp,
  checkBudget,
  classifyBudgetReadFailure,
  defaultBudgetCheckDeps,
  type BudgetCaps,
  type BudgetCheck,
  type BudgetReads,
} from "../services/cost-store";

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

const ID = "990001";
const CAPS: BudgetCaps = { monthlyCapUsd: 5, dailyCapUsd: 2 };
// A provisioned org: every org row carries a cap (schema default 5). A
// reader that returns null stands for an installation with no org row,
// which checkBudget provisions at scan time (section D2).
const OK_READS: BudgetReads = {
  monthlySpend: 0.1,
  dailySpend: 0.05,
  orgMonthlyCapUsd: 5,
};

// Error shapes as the driver produces them.
const connRefused = Object.assign(
  new Error("connect ECONNREFUSED 127.0.0.1:5432"),
  { code: "ECONNREFUSED" },
);
const pgUndefinedTable = Object.assign(
  new Error('relation "cost_ledger" does not exist'),
  { code: "42P01", severity: "ERROR" },
);
const pgConnectionFailure = Object.assign(
  new Error("terminating connection due to administrator command"),
  { code: "57P01", severity: "FATAL" },
);
const pgClass08 = Object.assign(new Error("connection failure"), {
  code: "08006",
  severity: "FATAL",
});
const drizzleWrapped = Object.assign(
  new Error("Failed query: select coalesce(sum(...)) params: 990001"),
  { cause: connRefused },
);
const configMissing = new Error(
  "DATABASE_URL is not set. Set it on Railway, or in .env locally, before calling db().",
);
const aggregateConnect = Object.assign(new Error("connect failed"), {
  errors: [connRefused],
});

/** A scripted reader: returns or throws per call, and counts calls. */
function scriptedReader(script: Array<BudgetReads | Error | "hang">): {
  readBudget: (installationId: string) => Promise<BudgetReads>;
  calls: () => number;
} {
  let calls = 0;
  return {
    readBudget: async () => {
      const step = script[Math.min(calls, script.length - 1)]!;
      calls++;
      if (step === "hang") return new Promise<BudgetReads>(() => undefined);
      if (step instanceof Error) throw step;
      return step;
    },
    calls: () => calls,
  };
}

function testClassifier(): void {
  section("A. failure classification");
  assertEq(classifyBudgetReadFailure(connRefused), "connection", "ECONNREFUSED is a connection failure");
  assertEq(classifyBudgetReadFailure(drizzleWrapped), "connection", "a Drizzle-wrapped connection error is found through .cause");
  assertEq(classifyBudgetReadFailure(aggregateConnect), "connection", "an AggregateError-shaped connect failure is found through .errors");
  assertEq(classifyBudgetReadFailure(pgClass08), "connection", "SQLSTATE class 08 is a connection failure");
  assertEq(classifyBudgetReadFailure(pgConnectionFailure), "connection", "SQLSTATE 57P01 (admin shutdown) is a connection failure");
  assertEq(classifyBudgetReadFailure(pgUndefinedTable), "query", "SQLSTATE 42P01 (undefined table) is a query failure");
  assertEq(classifyBudgetReadFailure(configMissing), "config", "DATABASE_URL missing is a config failure");
  assertEq(classifyBudgetReadFailure(new TypeError("x is undefined")), "unknown", "a TypeError is unknown");
  assertEq(classifyBudgetReadFailure(undefined), "unknown", "undefined is unknown");
}

async function testRealClientConfigMissing(): Promise<void> {
  section("B. real client, DATABASE_URL unset -> refused (config)");
  const r = await checkBudget(ID, CAPS, { retryDelayMs: 0, timeoutMs: 5_000 });
  assertEq(r.withinBudget, false, "scan refused");
  assertEq(r.reason, "budget_unverifiable", "reason is budget_unverifiable");
  assertEq(r.failure, { kind: "config", attempts: 1 }, "config failure, not retried");
}

async function testRealClientUnreachable(): Promise<void> {
  section("C. real client, database unreachable (127.0.0.1:1) -> refused (connection)");
  // No credentials in this URL, and nothing listens on port 1: the pg
  // client's connect is refused before any authentication is attempted.
  process.env.DATABASE_URL = "postgres://127.0.0.1:1/fixor_budget_witness";

  let raw: unknown;
  try {
    await defaultBudgetCheckDeps.readBudget(ID);
  } catch (err) {
    raw = err;
  }
  assert(raw !== undefined, "the real budget read against 127.0.0.1:1 throws");
  const codes: string[] = [];
  for (let e: unknown = raw, i = 0; e && i < 5; i++) {
    const rec = e as { code?: unknown; cause?: unknown };
    if (typeof rec.code === "string") codes.push(rec.code);
    e = rec.cause;
  }
  console.log(`      real error codes along the cause chain: ${JSON.stringify(codes)}`);
  assertEq(classifyBudgetReadFailure(raw), "connection", "the real driver error classifies as connection");

  const started = Date.now();
  const r = await checkBudget(ID, CAPS, { retryDelayMs: 0, timeoutMs: 10_000 });
  console.log(`      refused after ${Date.now() - started} ms`);
  assertEq(r.withinBudget, false, "scan refused while the database is unreachable");
  assertEq(r.reason, "budget_unverifiable", "reason is budget_unverifiable (not a cap reason)");
  assertEq(r.failure, { kind: "connection", attempts: 2 }, "connection failure, retried exactly once");
  assertEq([r.monthlySpend, r.dailySpend], [0, 0], "no spend figures are invented");
}

async function testDatabaseAnswers(): Promise<void> {
  section("D. database answers -> existing cap semantics");
  // A reader that reports no org row; the org is provisioned at the tier
  // default (5) by the stub below, never read from the env caps.
  const provisioned = async () => 5;
  const within = await checkBudget(ID, CAPS, { readBudget: async () => OK_READS, provisionMissingOrg: provisioned });
  assertEq(within.withinBudget, true, "under both caps: proceeds");
  assertEq(within.reason, undefined, "no refusal reason");
  assertEq(within.failure, undefined, "no failure field");
  assertEq(within.caps, { monthlyCapUsd: 5, dailyCapUsd: CAPS.dailyCapUsd }, "the provisioned org's cap and the env daily cap apply");

  const monthly = await checkBudget(ID, CAPS, {
    readBudget: async () => ({ monthlySpend: 5, dailySpend: 0.1, orgMonthlyCapUsd: null }),
    provisionMissingOrg: provisioned,
  });
  assertEq([monthly.withinBudget, monthly.reason], [false, "monthly_exceeded"], "at the monthly cap: refused as monthly_exceeded");

  const daily = await checkBudget(ID, CAPS, {
    readBudget: async () => ({ monthlySpend: 1, dailySpend: 2.5, orgMonthlyCapUsd: null }),
    provisionMissingOrg: provisioned,
  });
  assertEq([daily.withinBudget, daily.reason], [false, "daily_exceeded"], "over the daily cap: refused as daily_exceeded");

  const orgCap = await checkBudget(ID, CAPS, {
    readBudget: async () => ({ monthlySpend: 10, dailySpend: 0.1, orgMonthlyCapUsd: 50 }),
  });
  assertEq(orgCap.withinBudget, true, "per-org cap overrides the env cap");
  assertEq(orgCap.caps.monthlyCapUsd, 50, "effective monthly cap is the org's");
}

// Tracker item 9: Railway's FIXOR_MONTHLY_CAP_USD was 3 against a published
// free cap of 5, and governed any installation with no org row. Now the
// missing row is provisioned at scan time and its schema default governs.
async function testMissingOrgProvisioned(): Promise<void> {
  section("D2. no org row -> provisioned at the tier default; the env monthly cap never governs");
  const envCaps: BudgetCaps = { monthlyCapUsd: 3, dailyCapUsd: 2 };
  const provisionedFor: string[] = [];
  const provision = async (id: string) => { provisionedFor.push(id); return 5; };

  const r = await checkBudget(ID, envCaps, {
    readBudget: async () => ({ monthlySpend: 4, dailySpend: 0.1, orgMonthlyCapUsd: null }),
    provisionMissingOrg: provision,
  });
  assertEq(provisionedFor, [ID], "the org was provisioned once, for this installation");
  assertEq(r.caps.monthlyCapUsd, 5, "the effective cap is the provisioned org's (5), not the env's (3)");
  assertEq(r.withinBudget, true, "spend of 4 proceeds under the published cap, where the env cap of 3 would have refused it");

  provisionedFor.length = 0;
  const present = await checkBudget(ID, envCaps, {
    readBudget: async () => ({ monthlySpend: 4, dailySpend: 0.1, orgMonthlyCapUsd: 5 }),
    provisionMissingOrg: provision,
  });
  assertEq(provisionedFor, [], "control: an installation with an org row is not provisioned again");
  assertEq(present.caps.monthlyCapUsd, 5, "control: its own cap applies");

  const failing = await checkBudget(ID, envCaps, {
    readBudget: async () => ({ monthlySpend: 0, dailySpend: 0, orgMonthlyCapUsd: null }),
    provisionMissingOrg: async () => { throw connRefused; },
  });
  assertEq([failing.withinBudget, failing.reason, failing.failure?.kind], [false, "budget_unverifiable", "connection"], "provisioning fails -> refused as unverifiable (connection), never run under the env cap");
}

// Provisioning runs under the same per-step timeout as the read. Without
// it a hung database during provisioning hung the scan, and with the scan
// queue (lib/scan-queue.ts) that scan would also hold a queue slot.
async function testMissingOrgProvisionHangs(): Promise<void> {
  section("D3. no org row and provisioning hangs -> refused as timeout, never waited out");
  const noRow = async () => ({ monthlySpend: 0, dailySpend: 0, orgMonthlyCapUsd: null });

  // Sensitivity: this provisioner does answer, after 6x the timeout, with
  // a cap the scan could run under. Without the timeout the check waits
  // for it and PROCEEDS; with it the check refuses at 50 ms and never sees
  // the answer. Both the verdict and the elapsed time are asserted, so the
  // section fails if the timeout is removed.
  const t0 = Date.now();
  const slow = await checkBudget(ID, CAPS, {
    readBudget: noRow,
    provisionMissingOrg: () => new Promise<number>((resolve) => setTimeout(() => resolve(5), 300)),
    retryDelayMs: 0,
    timeoutMs: 50,
  });
  const elapsed = Date.now() - t0;
  assertEq([slow.withinBudget, slow.reason], [false, "budget_unverifiable"], "a provisioning that outlives the timeout is refused");
  assertEq(slow.failure?.kind, "timeout", "timeout kind");
  assert(elapsed < 300, `refused before the provisioner answered (elapsed ${elapsed} ms, provisioner answers at 300 ms)`);

  const never = await checkBudget(ID, CAPS, {
    readBudget: noRow,
    provisionMissingOrg: () => new Promise<number>(() => {}),
    retryDelayMs: 0,
    timeoutMs: 50,
  });
  assertEq([never.withinBudget, never.reason, never.failure?.kind], [false, "budget_unverifiable", "timeout"], "a provisioning that never settles is refused as timeout");

  // Control: a provisioning that answers inside the timeout proceeds.
  const quick = await checkBudget(ID, CAPS, {
    readBudget: noRow,
    provisionMissingOrg: () => new Promise<number>((resolve) => setTimeout(() => resolve(5), 5)),
    retryDelayMs: 0,
    timeoutMs: 50,
  });
  assertEq([quick.withinBudget, quick.caps.monthlyCapUsd], [true, 5], "control: a provisioning inside the timeout proceeds at its cap");
}

async function testRetryPolicy(): Promise<void> {
  section("E. retry policy");
  const blip = scriptedReader([connRefused, OK_READS]);
  const r1 = await checkBudget(ID, CAPS, { readBudget: blip.readBudget, retryDelayMs: 0 });
  assertEq(r1.withinBudget, true, "a single connection blip is absorbed by the retry: proceeds");
  assertEq(blip.calls(), 2, "exactly two reads");

  const down = scriptedReader([connRefused, connRefused]);
  const r2 = await checkBudget(ID, CAPS, { readBudget: down.readBudget, retryDelayMs: 0 });
  assertEq([r2.withinBudget, r2.reason], [false, "budget_unverifiable"], "a persistent connection failure is refused");
  assertEq(r2.failure, { kind: "connection", attempts: 2 }, "connection kind, two attempts");
  assertEq(down.calls(), 2, "never more than two reads");

  const query = scriptedReader([pgUndefinedTable]);
  const r3 = await checkBudget(ID, CAPS, { readBudget: query.readBudget, retryDelayMs: 0 });
  assertEq(r3.failure, { kind: "query", attempts: 1 }, "a query failure is refused without a retry");
  assertEq(query.calls(), 1, "exactly one read");

  const hang = scriptedReader(["hang"]);
  const r4 = await checkBudget(ID, CAPS, { readBudget: hang.readBudget, retryDelayMs: 0, timeoutMs: 50 });
  assertEq([r4.withinBudget, r4.reason], [false, "budget_unverifiable"], "a hung read is refused");
  assertEq(r4.failure, { kind: "timeout", attempts: 2 }, "timeout kind, retried once");

  const unknown = scriptedReader([new TypeError("x is undefined")]);
  const r5 = await checkBudget(ID, CAPS, { readBudget: unknown.readBudget, retryDelayMs: 0 });
  assertEq(r5.failure, { kind: "unknown", attempts: 1 }, "an unknown failure is refused without a retry");
}

async function testExemption(): Promise<void> {
  section("F. operator exemption stays open without touching the database");
  process.env.FIXOR_BUDGET_EXEMPT_INSTALLATIONS = `${ID}, 777`;
  try {
    const exempt = scriptedReader([connRefused]);
    const r = await checkBudget(ID, CAPS, { readBudget: exempt.readBudget });
    assertEq([r.withinBudget, r.reason], [true, "exempt"], "an exempt installation proceeds");
    assertEq(exempt.calls(), 0, "the ledger is never read for it");

    const control = scriptedReader([connRefused, connRefused]);
    const c = await checkBudget("990002", CAPS, { readBudget: control.readBudget, retryDelayMs: 0 });
    assertEq([c.withinBudget, c.reason], [false, "budget_unverifiable"], "control: a non-exempt installation under the same env is refused");
  } finally {
    delete process.env.FIXOR_BUDGET_EXEMPT_INSTALLATIONS;
  }
}

function testApiMapping(): void {
  section("G. public API refusal mapping");
  const base = { monthlySpend: 0, dailySpend: 0, caps: CAPS };
  assertEq(budgetRefusalHttp({ ...base, withinBudget: true }), null, "within budget: no refusal");
  assertEq(budgetRefusalHttp({ ...base, withinBudget: true, reason: "exempt" }), null, "exempt: no refusal");
  const exceeded = budgetRefusalHttp({ ...base, monthlySpend: 5, withinBudget: false, reason: "monthly_exceeded" });
  assertEq([exceeded?.status, exceeded?.body.error, exceeded?.retryAfterSeconds], [402, "monthly_budget_exceeded", undefined], "cap exceeded: 402 as before");
  const unverifiable = budgetRefusalHttp({
    ...base,
    withinBudget: false,
    reason: "budget_unverifiable",
    failure: { kind: "connection", attempts: 2 },
  });
  assertEq([unverifiable?.status, unverifiable?.body.error, unverifiable?.retryAfterSeconds], [503, "budget_unverifiable", 60], "budget unverifiable: 503 with Retry-After, not a 402");
}

// ---- end to end through the PR webhook handler --------------------------

// Fragmented so the repo's own secret scan never sees a whole key (same
// technique as test-whole-file-input.ts).
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

function prPayloadWithInstallation(): { raw: string; payload: unknown } {
  const samplePath = path.join(
    process.cwd(),
    "src/integrations/github/samples/pull_request.opened.sample.json",
  );
  const sample = JSON.parse(fs.readFileSync(samplePath, "utf8")) as Record<string, unknown>;
  const payload = { ...sample, installation: { id: Number(ID) } };
  return { raw: JSON.stringify(payload), payload };
}

/**
 * A scan_runs writer that accepts every write. Section I needs it: with
 * DATABASE_URL on a closed port the real writer's insert fails, and a
 * failed insert now refuses the scan (test-ledger-fail-closed.ts), which
 * would hide what this section measures, the budget gate alone.
 */
const acceptingStore: ScanRunStore = {
  async createPending() {
    return { created: true, id: "00000000-0000-4000-8000-0000000000b1" };
  },
  async markRunning() {},
  async finish() {},
};

async function runHandler(
  checkBudgetImpl?: (id: number | string) => Promise<BudgetCheck>,
  scanRunStore?: ScanRunStore,
) {
  const { raw, payload } = prPayloadWithInstallation();
  return handlePullRequestWebhook({
    ...(scanRunStore ? { scanRunStore } : {}),
    rawBody: raw,
    payload,
    dryRun: true,
    skipSignatureVerification: true,
    // A placeholder token is supplied so the handler never mints an
    // installation token. dryRun means it is never sent anywhere.
    token: "unused",
    resolveSemgrep: () => PR_DIFF,
    workflowMetadata: { scanId: "budget-fail-closed-witness" },
    ...(checkBudgetImpl ? { checkBudgetImpl } : {}),
  });
}

async function testHandlerRealGateUnreachable(): Promise<void> {
  section("H. handler + REAL gate, database unreachable -> scan refused, notice posted");
  assert(process.env.DATABASE_URL?.includes("127.0.0.1:1"), "DATABASE_URL still points at the closed port");
  const result = await runHandler();
  assert(result.ok, "handler completes");
  if (!result.ok) return;
  const wf = result.workflow;
  assertEq(wf.status, "budget_unverifiable", "workflow status is budget_unverifiable");
  assertEq(wf.classifiedFindings, 0, "the planted secret was never found: no scan ran");
  assertEq(wf.fixes.length, 0, "no findings reported");
  const body = result.comment.body;
  assert(body.includes("Fixor did not scan this commit"), "comment says the commit was not scanned");
  assert(body.includes("This is not a clean result"), "comment says it is not a clean result");
  assert(body.includes("Push a new commit"), "comment tells the user how to retry");
  assert(!body.includes("### Summary"), "no Summary table (it would read as zero findings)");
  assert(!/budget reached/i.test(body), "no 'budget reached' wording (it would be false)");
  assert(!/database|DATABASE_URL|ECONNREFUSED|postgres/i.test(body), "no internal detail leaks into the comment");
}

async function testHandlerGateAnswers(): Promise<void> {
  section("I. handler + gate that answers -> the same PR is scanned");
  const answered: BudgetCheck = {
    withinBudget: true,
    monthlySpend: OK_READS.monthlySpend,
    dailySpend: OK_READS.dailySpend,
    caps: CAPS,
  };
  const result = await runHandler(async () => answered, acceptingStore);
  assert(result.ok, "handler completes");
  if (!result.ok) return;
  const wf = result.workflow;
  assert(
    wf.status !== "budget_unverifiable" && wf.status !== "budget_exceeded",
    `workflow ran (status "${wf.status}")`,
  );
  assert(wf.classifiedFindings >= 1, "the planted secret was found: the scan ran");
  assert(result.comment.body.includes("### Summary"), "comment is a normal report");
}

async function testHandlerCapExceeded(): Promise<void> {
  section("J. handler + cap exceeded -> existing budget_exceeded path unchanged");
  const exceeded: BudgetCheck = {
    withinBudget: false,
    reason: "monthly_exceeded",
    monthlySpend: 5.25,
    dailySpend: 0.4,
    caps: CAPS,
  };
  const result = await runHandler(async () => exceeded);
  assert(result.ok, "handler completes");
  if (!result.ok) return;
  assertEq(result.workflow.status, "budget_exceeded", "status is budget_exceeded");
  assertEq(result.workflow.classifiedFindings, 0, "no scan ran");
  assert(/budget reached/i.test(result.comment.body), "comment keeps the budget-reached wording");
}

async function testHandlerUnknownRefusal(): Promise<void> {
  section("K. handler + a refusal with no known reason -> treated as unverifiable");
  const odd: BudgetCheck = { withinBudget: false, monthlySpend: 0, dailySpend: 0, caps: CAPS };
  const result = await runHandler(async () => odd);
  assert(result.ok, "handler completes");
  if (!result.ok) return;
  assertEq(result.workflow.status, "budget_unverifiable", "an unexplained refusal fails closed, never as 'Daily budget reached'");
  assertEq(result.workflow.classifiedFindings, 0, "no scan ran");
}

const EXPECTED_SECTIONS = 13;

async function main(): Promise<void> {
  // Zero-spend precondition, checked before anything else runs.
  if (getAnthropicClient() !== null) {
    console.error("[FAIL] an Anthropic client exists in this process; refusing to run");
    process.exit(1);
  }
  console.log("[PASS] no Anthropic client exists in this process");

  testClassifier();
  await testRealClientConfigMissing();
  await testRealClientUnreachable();
  await testDatabaseAnswers();
  await testMissingOrgProvisioned();
  await testMissingOrgProvisionHangs();
  await testRetryPolicy();
  await testExemption();
  testApiMapping();
  await testHandlerRealGateUnreachable();
  await testHandlerGateAnswers();
  await testHandlerCapExceeded();
  await testHandlerUnknownRefusal();

  assertEq(sectionsRun.length, EXPECTED_SECTIONS, "every section ran");
  assert(getAnthropicClient() === null, "still no Anthropic client after the run");
  await closeDb();

  console.log(
    failures === 0
      ? "\nBudget fail-closed witness: PASS."
      : `\nBudget fail-closed witness: ${failures} FAILURE(S).`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
