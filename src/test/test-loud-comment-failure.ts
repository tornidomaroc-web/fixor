/**
 * Witness: a GitHub call that fails inside the PR webhook is loud.
 *
 * From 2026-07-10 to 2026-09-23 every comment post was refused with 401 by
 * an expired token. The handler returned `ok:false`, the webhook answered
 * 200, and nothing was logged or sent to Sentry, so about 96 scanned and
 * paid-for pull requests received no comment and nobody knew. This test
 * drives the real handler and the real route with `fetch` replaced by a
 * recorder and proves the opposite:
 *
 *   - a refused comment post (401 as in July, 403 as for a missing
 *     permission) is logged at error level with the phase, GitHub's status
 *     and reason, and the pull request coordinates, and is captured to
 *     Sentry with the same phase tag;
 *   - a refused diff fetch is reported the same way, one phase earlier;
 *   - a successful delivery logs no error and sends nothing to Sentry;
 *   - the route answers 502, not 200, when the handler reports `ok:false`.
 *
 * Keyless and $0 by construction: no Anthropic key and no client exist in
 * this process (asserted before anything runs), `fetch` is replaced before
 * any request so nothing leaves the process, Sentry is initialised with a
 * transport that keeps every envelope in memory and a beforeSend that
 * drops the event after recording it, the App JWT is signed with a
 * throwaway RSA key generated at run time, DATABASE_URL is unset, and
 * Cloudinary is unconfigured (its upload throws before any network call).
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

import { generateKeyPairSync } from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import * as Sentry from "@sentry/node";

import { getAnthropicClient } from "../analysis-engine/anthropic-client";
import { clearInstallationTokenCache } from "../integrations/github/app-auth.service";
import { handlePullRequestWebhook } from "../integrations/github/pr-webhook-handler";
import { logger } from "../lib/logger";
import { routeGitHubWebhook } from "../server/github-webhook-route";
import type { BudgetCheck } from "../services/cost-store";

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
// Shadow the pino method on the shared logger object so every error line the
// handler writes is recorded here as well.
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
  // Nothing leaves the process: the event is recorded, then dropped, and
  // the transport would keep any envelope in memory anyway.
  beforeSend(event) {
    sentryEvents.push(event);
    return null;
  },
  transport: () => ({ send: async () => ({}), flush: async () => true }),
  defaultIntegrations: false,
});

// ---- the recorder that replaces fetch --------------------------------------

interface Scenario { diffStatus: number; postStatus: number; postMessage: string }
let scenario: Scenario;
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
      : json(scenario.postStatus, { message: scenario.postMessage });
  }
  unexpected.push(`${method} ${url}`);
  return json(599, { message: "unexpected request in the witness" });
}) as typeof fetch;

// ---- the delivery ------------------------------------------------------------

const WITHIN_BUDGET: BudgetCheck = { withinBudget: true, monthlySpend: 0.1, dailySpend: 0.05, caps: { monthlyCapUsd: 5, dailyCapUsd: 2 } };
const SAMPLE = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "src/integrations/github/samples/pull_request.opened.sample.json"), "utf8"),
) as Record<string, unknown>;
const HEAD_SHA = ((SAMPLE.pull_request as { head: { sha: string } }).head).sha;
let nextInstallationId = 3001;

/** One delivery through the real handler; the diff comes through the recorder unless `injectDiff`. */
async function deliver(s: Scenario, injectDiff: boolean) {
  scenario = s;
  errorLogs.length = 0;
  sentryEvents.length = 0;
  unexpected.length = 0;
  clearInstallationTokenCache();
  const installationId = nextInstallationId++;
  const payload = { ...SAMPLE, installation: { id: installationId } };
  const result = await handlePullRequestWebhook({
    rawBody: JSON.stringify(payload),
    payload,
    dryRun: false,
    skipSignatureVerification: true,
    updateExisting: true,
    usePrDiffFallback: true,
    ...(injectDiff ? { resolveSemgrep: () => PR_DIFF } : {}),
    checkBudgetImpl: async () => WITHIN_BUDGET,
    workflowMetadata: { scanId: "loud-failure-witness" },
  });
  await Sentry.flush(1000);
  assertEq(unexpected, [], "no request outside the recorder's routes");
  return { result, installationId };
}

function githubFailureLogs(): LoggedError[] {
  return errorLogs.filter((l) => l.fields.phase === "comment_post" || l.fields.phase === "pr_fetch");
}
// The scan sends Sentry other events on this path (the org-settings lookup
// with no database, the Cloudinary upload); only ours are counted.
function githubFailureEvents(): Sentry.Event[] {
  return sentryEvents.filter((e) => e.tags?.["fixor.phase"] === "comment_post" || e.tags?.["fixor.phase"] === "pr_fetch");
}

function assertLoud(phase: string, status: number, reason: string, installationId: number, label: string): void {
  const logs = githubFailureLogs();
  assertEq(logs.length, 1, `${label}: exactly one GitHub-failure error line`);
  const f = logs[0]?.fields ?? {};
  assertEq(
    [f.phase, f.status, f.reason, f.owner, f.repo, f.pullNumber, f.headSha, f.installationId],
    [phase, status, reason, "acme-corp", "demo-app", 7, HEAD_SHA, installationId],
    `${label}: the line carries phase, status, reason and the pull request coordinates`,
  );
  assert(
    phase === "comment_post"
      ? /no report was posted/.test(logs[0]?.msg ?? "")
      : /scan did not run/.test(logs[0]?.msg ?? ""),
    `${label}: the message says what the user lost`,
  );
  const events = githubFailureEvents();
  assertEq(events.length, 1, `${label}: exactly one Sentry event for the GitHub failure`);
  assertEq(
    [events[0]?.tags?.["fixor.phase"], events[0]?.tags?.["fixor.github_status"]],
    [phase, String(status)],
    `${label}: the Sentry event is tagged with the phase and status`,
  );
}

async function testExpiredToken(): Promise<void> {
  section("A. comment post refused with 401 (the July failure) -> loud");
  const { result, installationId } = await deliver({ diffStatus: 200, postStatus: 401, postMessage: "Bad credentials" }, true);
  assert(!result.ok && result.githubError?.status === 401, "401: the handler reports ok:false with the GitHub status");
  assertLoud("comment_post", 401, "Bad credentials", installationId, "401");
}

async function testNoWriteAccess(): Promise<void> {
  section("B. comment post refused with 403 (missing permission) -> loud");
  const { result, installationId } = await deliver({ diffStatus: 200, postStatus: 403, postMessage: "Resource not accessible by integration" }, true);
  assert(!result.ok && result.githubError?.status === 403, "403: the handler reports ok:false with the GitHub status");
  assertLoud("comment_post", 403, "Resource not accessible by integration", installationId, "403");
}

async function testDiffRefused(): Promise<void> {
  section("C. diff fetch refused with 404 -> loud, one phase earlier");
  const { result, installationId } = await deliver({ diffStatus: 404, postStatus: 201, postMessage: "" }, false);
  assert(!result.ok && result.githubError?.status === 404, "404: the handler reports ok:false with the GitHub status");
  assertLoud("pr_fetch", 404, "Not Found", installationId, "404");
}

async function testSuccessIsQuiet(): Promise<void> {
  section("D. a delivery that posts -> no error line, no Sentry event");
  const { result } = await deliver({ diffStatus: 200, postStatus: 201, postMessage: "" }, true);
  assert(result.ok && result.comment.commentPosted, "comment posted");
  assertEq(githubFailureLogs().length, 0, "no GitHub-failure error line");
  assertEq(githubFailureEvents().length, 0, "no Sentry event for a GitHub failure");
}

async function testRouteStatus(): Promise<void> {
  section("E. the route answers 502 for a handler failure, 200 for success");
  const body = Buffer.from(JSON.stringify({ action: "opened", number: 1 }));
  const deps = (ok: boolean) => ({
    provisionOrg: async () => ({ orgId: "o", created: false }),
    handlePullRequest: async () => (ok ? { ok: true } : { ok: false, error: "GitHub refused the PR comment" }),
  });
  const failed = await routeGitHubWebhook({ rawBody: body, eventHeader: "pull_request", signatureHeader: undefined, webhookSecret: "", skipSignatureVerification: true, deps: deps(false) });
  const fine = await routeGitHubWebhook({ rawBody: body, eventHeader: "pull_request", signatureHeader: undefined, webhookSecret: "", skipSignatureVerification: true, deps: deps(true) });
  assertEq([failed.status, (failed.body as { ok: boolean }).ok], [502, false], "ok:false -> 502 with the failure in the body");
  assertEq([fine.status, (fine.body as { ok: boolean }).ok], [200, true], "ok:true -> 200");
}

const EXPECTED_SECTIONS = 5;

async function main(): Promise<void> {
  if (getAnthropicClient() !== null) {
    console.error("[FAIL] an Anthropic client exists in this process; refusing to run");
    process.exit(1);
  }
  console.log("[PASS] no Anthropic client exists in this process");

  await testExpiredToken();
  await testNoWriteAccess();
  await testDiffRefused();
  await testSuccessIsQuiet();
  await testRouteStatus();

  assertEq(sectionsRun.length, EXPECTED_SECTIONS, "every section ran");
  assert(getAnthropicClient() === null, "still no Anthropic client after the run");

  console.log(
    failures === 0
      ? "\nLoud comment-failure witness: PASS."
      : `\nLoud comment-failure witness: ${failures} FAILURE(S).`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
