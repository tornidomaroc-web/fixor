/**
 * Witness: only pull_request deliveries that carry new code are scanned.
 *
 * GitHub delivers every action of a subscribed event, and the webhook used
 * to hand all of them to the PR handler, so a label, an edit, an
 * assignment, a review request or a close each ran a full scan of a commit
 * already scanned. The route now admits opened, synchronize, reopened, and
 * edited only when the base branch changed (pr-action-filter.ts). This
 * test proves it on the real route, with real HMAC verification, and the
 * real handler wired as webhook-server.ts wires it:
 *
 *   - the decision for every documented action, the edited variants, and a
 *     missing or unrecognized action;
 *   - a labeled and a title-edited delivery are acknowledged 200 "ignored"
 *     with their exact reason, and the handler, the diff fetch and the
 *     budget gate are never called, so no scan runs;
 *   - every other refused delivery (closed, converted_to_draft,
 *     ready_for_review, an unrecognized action, ...) is refused the same way;
 *   - opened, synchronize, a base retarget and a push to a draft still reach
 *     the handler, which scans: the planted secret is found and the comment
 *     is a normal report naming the commit it scanned;
 *   - a forged labeled delivery is still rejected 401 by the signature gate,
 *     which runs before the filter.
 *
 * Keyless and $0 by construction: no Anthropic key and no client exist in
 * this process (asserted before anything runs), the only detector that
 * produces a finding is the regex-only secrets check, the diff and the
 * budget read are injected, dryRun keeps the comment local, DATABASE_URL is
 * unset, and Cloudinary is unconfigured (its upload throws before any
 * network call).
 */

// Before any import: nothing in this process may reach a paid or live
// service, whatever the shell environment holds.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DATABASE_URL;
delete process.env.GITHUB_TOKEN;
delete process.env.GITHUB_APP_ID;
delete process.env.GITHUB_APP_PRIVATE_KEY;
delete process.env.FIXOR_BUDGET_EXEMPT_INSTALLATIONS;
delete process.env.FIXOR_PILOT_ENABLED;
delete process.env.CLOUDINARY_CLOUD_NAME;
delete process.env.CLOUDINARY_API_KEY;
delete process.env.CLOUDINARY_API_SECRET;

import { createHmac } from "node:crypto";
import * as fs from "fs";
import * as path from "path";

import { getAnthropicClient } from "../analysis-engine/anthropic-client";
import { decidePullRequestScan } from "../integrations/github/pr-action-filter";
import {
  handlePullRequestWebhook,
  type HandlePullRequestWebhookResult,
} from "../integrations/github/pr-webhook-handler";
import {
  routeGitHubWebhook,
  type WebhookRouteDeps,
  type WebhookRouteResponse,
} from "../server/github-webhook-route";
import type { BudgetCheck } from "../services/cost-store";
import type { ScanRunStore } from "../services/scan-run-store";

const acceptingStore: ScanRunStore = {
  async createPending() {
    return { created: true, id: "00000000-0000-4000-8000-0000000000a1" };
  },
  async markRunning() {},
  async finish() {},
};

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

/** GitHub's documented pull_request actions (Webhook events and payloads, read 2026-09-23). */
const DOCUMENTED_ACTIONS = [
  "assigned",
  "auto_merge_disabled",
  "auto_merge_enabled",
  "closed",
  "converted_to_draft",
  "demilestoned",
  "dequeued",
  "edited",
  "enqueued",
  "labeled",
  "locked",
  "milestoned",
  "opened",
  "ready_for_review",
  "reopened",
  "review_request_removed",
  "review_requested",
  "stacked",
  "synchronize",
  "unassigned",
  "unlabeled",
  "unlocked",
];
const SCANNED = ["opened", "synchronize", "reopened"];
/** Documented actions that change no code: all but the scanned three, edited, and the undescribed stacked. */
const NOT_SCANNED = DOCUMENTED_ACTIONS.filter(
  (a) => !SCANNED.includes(a) && a !== "edited" && a !== "stacked",
);

const SECRET = "filter-witness";
const INSTALLATION_ID = 990002;
const BASE_CHANGE = {
  ref: { from: "develop" },
  sha: { from: "1111111111111111111111111111111111111111" },
};
const PUSHED_HEAD = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";

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

const WITHIN_BUDGET: BudgetCheck = {
  withinBudget: true,
  monthlySpend: 0.1,
  dailySpend: 0.05,
  caps: { monthlyCapUsd: 5, dailyCapUsd: 2 },
};

const SAMPLE = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), "src/integrations/github/samples/pull_request.opened.sample.json"),
    "utf8",
  ),
) as Record<string, unknown>;
const SAMPLE_PR = SAMPLE.pull_request as Record<string, unknown>;
const SAMPLE_HEAD = (SAMPLE_PR.head as { sha: string }).sha;

/** A pull_request delivery body. A field set to undefined is dropped by JSON.stringify. */
function delivery(fields: Record<string, unknown>): Buffer {
  return Buffer.from(
    JSON.stringify({ ...SAMPLE, installation: { id: INSTALLATION_ID }, ...fields }),
  );
}

function sign(body: Buffer, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

interface Spies {
  handler: number;
  diff: number;
  budget: number;
  actionsSeen: string[];
}
function newSpies(): Spies {
  return { handler: 0, diff: 0, budget: 0, actionsSeen: [] };
}

/**
 * The dependencies webhook-server.ts passes, with the real handler; only
 * the diff fetch and the budget read are injected, and counted.
 */
function depsFor(spies: Spies): WebhookRouteDeps {
  return {
    provisionOrg: async () => {
      throw new Error("provisionOrg is never reached by a pull_request delivery");
    },
    handlePullRequest: async ({ rawBody, payload, signatureHeader }) => {
      spies.handler++;
      return handlePullRequestWebhook({
        rawBody,
        payload,
        signatureHeader,
        webhookSecret: SECRET,
        skipSignatureVerification: false,
        dryRun: true,
        updateExisting: true,
        usePrDiffFallback: true,
        // A placeholder token is supplied so the handler never mints an
        // installation token. dryRun means it is never sent anywhere.
        token: "unused",
        resolveSemgrep: (ctx) => {
          spies.diff++;
          spies.actionsSeen.push(ctx.action ?? "(none)");
          return PR_DIFF;
        },
        checkBudgetImpl: async () => {
          spies.budget++;
          return WITHIN_BUDGET;
        },
        workflowMetadata: { scanId: "pr-action-filter-witness" },
        // A writer that accepts every write: with DATABASE_URL unset the
        // real insert fails, and a failed insert refuses the scan
        // (test-ledger-fail-closed.ts), which is not what this measures.
        scanRunStore: acceptingStore,
      });
    },
  };
}

function deliver(
  body: Buffer,
  spies: Spies,
  signingSecret: string = SECRET,
): Promise<WebhookRouteResponse> {
  return routeGitHubWebhook({
    rawBody: body,
    eventHeader: "pull_request",
    signatureHeader: sign(body, signingSecret),
    webhookSecret: SECRET,
    skipSignatureVerification: false,
    deps: depsFor(spies),
  });
}

function assertRefused(
  res: WebhookRouteResponse,
  reason: string,
  action: string | null,
  label: string,
): void {
  const body = (res.body ?? {}) as Record<string, unknown>;
  assertEq(
    [res.status, body.status, body.reason, body.action],
    [200, "ignored", reason, action],
    `${label}: acknowledged 200 "ignored", reason ${reason}`,
  );
}

function assertNoScan(spies: Spies, label: string): void {
  assertEq(
    [spies.handler, spies.diff, spies.budget],
    [0, 0, 0],
    `${label}: handler, diff fetch and budget gate never called, so no scan ran`,
  );
}

function assertScanned(
  res: WebhookRouteResponse,
  spies: Spies,
  action: string,
  head: string,
  label: string,
): void {
  assertEq(res.status, 200, `${label}: 200`);
  assertEq([spies.handler, spies.diff], [1, 1], `${label}: handler entered, diff fetched once`);
  // The handler reads the budget before the scan and again after it (the
  // 80% warning), so the count is not pinned; reaching the gate is.
  assert(spies.budget >= 1, `${label}: budget gate reached (${spies.budget} reads)`);
  assertEq(spies.actionsSeen, [action], `${label}: the handler received action "${action}"`);
  const result = res.body as HandlePullRequestWebhookResult;
  assert(result.ok, `${label}: handler completes`);
  if (!result.ok) return;
  assertEq(result.signatureState, "valid", `${label}: the handler re-verified the signature`);
  assert(result.workflow.classifiedFindings >= 1, `${label}: the planted secret was found, so the scan ran`);
  assert(result.comment.body.includes("### Summary"), `${label}: the comment is a normal report`);
  assert(result.comment.body.includes(head), `${label}: the report names the commit it scanned`);
}

function outcome(payload: unknown): string {
  const d = decidePullRequestScan(payload);
  return d.scan ? "scan" : d.reason;
}

function testDecisionTable(): void {
  section("A. decision for every documented action, the edited variants, anomalies");
  assertEq(DOCUMENTED_ACTIONS.length, 22, "GitHub documents 22 pull_request actions");
  for (const action of DOCUMENTED_ACTIONS) {
    const expected = SCANNED.includes(action)
      ? "scan"
      : action === "edited"
        ? "edited_without_base_change"
        : action === "stacked"
          ? "action_unrecognized"
          : "action_not_scanned";
    assertEq(outcome({ action }), expected, `action "${action}"`);
  }
  assertEq(outcome({ action: "edited", changes: { title: { from: "WIP" } } }), "edited_without_base_change", "edited: title only");
  assertEq(outcome({ action: "edited", changes: { body: { from: "" } } }), "edited_without_base_change", "edited: body only");
  assertEq(outcome({ action: "edited", changes: { base: null } }), "edited_without_base_change", "edited: changes.base null");
  assertEq(outcome({ action: "edited", changes: { base: BASE_CHANGE } }), "scan", "edited: base changed (retarget)");
  assertEq(outcome({ action: "edited", changes: { title: { from: "WIP" }, base: BASE_CHANGE } }), "scan", "edited: title and base changed");
  assertEq(outcome({ action: "opened", pull_request: { draft: true } }), "scan", "opened as a draft");
  assertEq(outcome({ action: "synchronize", pull_request: { draft: true } }), "scan", "push to a draft");
  assertEq(outcome({ action: "converted_to_draft", pull_request: { draft: true } }), "action_not_scanned", "converted to draft");
  assertEq(outcome({ action: "ready_for_review", pull_request: { draft: false } }), "action_not_scanned", "draft marked ready: its head was scanned when pushed");
  assertEq(outcome({ action: "some_future_action" }), "action_unrecognized", "an action GitHub adds later");
  assertEq(outcome({}), "action_missing", "no action");
  assertEq(outcome({ action: 7 }), "action_missing", "a non-string action");
  assertEq(outcome(null), "action_missing", "a null payload");
  assertEq(outcome(["opened"]), "action_missing", "an array payload");
  assertEq(
    decidePullRequestScan({ action: "labeled" }),
    { scan: false, action: "labeled", reason: "action_not_scanned" },
    "a refusal carries the action and the reason",
  );
}

async function testLabeled(): Promise<void> {
  section("B. labeled -> refused as action_not_scanned, no scan");
  const spies = newSpies();
  const res = await deliver(delivery({ action: "labeled", label: { name: "bug" } }), spies);
  assertRefused(res, "action_not_scanned", "labeled", "labeled");
  assertNoScan(spies, "labeled");
}

async function testEditedTitle(): Promise<void> {
  section("C. edited, title only -> refused as edited_without_base_change, no scan");
  const spies = newSpies();
  const res = await deliver(
    delivery({ action: "edited", changes: { title: { from: "WIP" } } }),
    spies,
  );
  assertRefused(res, "edited_without_base_change", "edited", "edited title");
  assertNoScan(spies, "edited title");
}

async function testEveryOtherRefusal(): Promise<void> {
  section("D. every other refused delivery -> refused, no scan");
  const spies = newSpies();
  const cases: Array<{ fields: Record<string, unknown>; reason: string; action: string | null }> = [
    ...NOT_SCANNED.filter((a) => a !== "labeled").map((a) => ({
      fields: { action: a },
      reason: "action_not_scanned",
      action: a,
    })),
    { fields: { action: "edited", changes: { body: { from: "" } } }, reason: "edited_without_base_change", action: "edited" },
    { fields: { action: "stacked" }, reason: "action_unrecognized", action: "stacked" },
    { fields: { action: "some_future_action" }, reason: "action_unrecognized", action: "some_future_action" },
    { fields: { action: undefined }, reason: "action_missing", action: null },
  ];
  for (const c of cases) {
    const res = await deliver(delivery(c.fields), spies);
    assertRefused(res, c.reason, c.action, c.action ?? "no action");
  }
  assertNoScan(spies, `all ${cases.length} deliveries`);
}

async function testOpened(): Promise<void> {
  section("E. opened -> scanned");
  const spies = newSpies();
  const res = await deliver(delivery({ action: "opened" }), spies);
  assertScanned(res, spies, "opened", SAMPLE_HEAD, "opened");
}

async function testSynchronize(): Promise<void> {
  section("F. synchronize (new commits) -> scanned at the new head");
  const spies = newSpies();
  const res = await deliver(
    delivery({ action: "synchronize", pull_request: { ...SAMPLE_PR, head: { sha: PUSHED_HEAD } } }),
    spies,
  );
  assertScanned(res, spies, "synchronize", PUSHED_HEAD, "synchronize");
}

async function testRetarget(): Promise<void> {
  section("G. edited with a base change (retarget) -> scanned");
  const spies = newSpies();
  const res = await deliver(
    delivery({ action: "edited", changes: { base: BASE_CHANGE } }),
    spies,
  );
  assertScanned(res, spies, "edited", SAMPLE_HEAD, "retarget");
}

async function testDraftPush(): Promise<void> {
  section("H. push to a draft pull request -> scanned, as before");
  const spies = newSpies();
  const res = await deliver(
    delivery({
      action: "synchronize",
      pull_request: { ...SAMPLE_PR, draft: true, head: { sha: PUSHED_HEAD } },
    }),
    spies,
  );
  assertScanned(res, spies, "synchronize", PUSHED_HEAD, "draft push");
}

async function testForgedLabeled(): Promise<void> {
  section("I. forged labeled delivery -> 401 from the signature gate, which runs first");
  const spies = newSpies();
  const res = await deliver(delivery({ action: "labeled" }), spies, "wrong-secret");
  assertEq(res.status, 401, "forged labeled: 401, not a 200 ignored");
  assertNoScan(spies, "forged labeled");
}

const EXPECTED_SECTIONS = 9;

async function main(): Promise<void> {
  // Zero-spend precondition, checked before anything else runs.
  if (getAnthropicClient() !== null) {
    console.error("[FAIL] an Anthropic client exists in this process; refusing to run");
    process.exit(1);
  }
  console.log("[PASS] no Anthropic client exists in this process");

  testDecisionTable();
  await testLabeled();
  await testEditedTitle();
  await testEveryOtherRefusal();
  await testOpened();
  await testSynchronize();
  await testRetarget();
  await testDraftPush();
  await testForgedLabeled();

  assertEq(sectionsRun.length, EXPECTED_SECTIONS, "every section ran");
  assert(getAnthropicClient() === null, "still no Anthropic client after the run");

  console.log(
    failures === 0
      ? "\nPR action filter witness: PASS."
      : `\nPR action filter witness: ${failures} FAILURE(S).`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
