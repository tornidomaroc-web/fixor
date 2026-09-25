/**
 * Witness: PR comments are posted with the installation token, never with
 * GITHUB_TOKEN.
 *
 * The handler minted an installation token for every App delivery but gave
 * the comment poster `options.token`, which production never sets, so the
 * poster fell back to GITHUB_TOKEN: every Fixor comment went out under the
 * personal account that token belongs to, and on a repository that account
 * cannot write to, the post failed after the scan had spent. This test
 * drives the real handler, the real poster and the real GitHub client, with
 * `fetch` replaced by a recorder, and reads the Authorization header of
 * every request:
 *
 *   - a first report, an update of an existing report, and the "did not
 *     scan this commit" notice all go out with the installation token;
 *   - a 403 (the App lacks write access) fails the post and is never
 *     retried with GITHUB_TOKEN;
 *   - a token response without a token fails the delivery instead of
 *     falling back to GITHUB_TOKEN;
 *   - a delivery with no installation (PAT mode, where GITHUB_TOKEN is the
 *     configured credential) still posts with GITHUB_TOKEN, as intended.
 *
 * Keyless and $0 by construction: no Anthropic key and no client exist in
 * this process (asserted before anything runs), `fetch` is replaced before
 * any request so nothing leaves the process (an unexpected request fails
 * the test), the App JWT is signed with a throwaway RSA key generated at
 * run time (never the real App key), GITHUB_TOKEN holds a decoy,
 * DATABASE_URL is unset, and Cloudinary is unconfigured (its upload throws
 * before any network call).
 */

// Before any import: nothing in this process may reach a paid or live
// service, whatever the shell environment holds.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DATABASE_URL;
delete process.env.FIXOR_BUDGET_EXEMPT_INSTALLATIONS;
delete process.env.FIXOR_PILOT_ENABLED;
delete process.env.CLOUDINARY_CLOUD_NAME;
delete process.env.CLOUDINARY_API_KEY;
delete process.env.CLOUDINARY_API_SECRET;
delete process.env.GITHUB_API_BASE_URL;
delete process.env.SENTRY_DSN;

// A decoy: any request that carries it means the poster fell back.
const ENV_TOKEN = "from-environment";
const INSTALLATION_TOKEN = "from-installation";
process.env.GITHUB_TOKEN = ENV_TOKEN;
process.env.GITHUB_APP_ID = "424242";

import { generateKeyPairSync } from "node:crypto";
import * as fs from "fs";
import * as path from "path";

import { getAnthropicClient } from "../analysis-engine/anthropic-client";
import { clearInstallationTokenCache } from "../integrations/github/app-auth.service";
import { FIXOR_PR_COMMENT_MARKER } from "../integrations/github/comment-constants";
import { handlePullRequestWebhook } from "../integrations/github/pr-webhook-handler";
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

// ---- the recorder that replaces fetch --------------------------------------

interface Scenario {
  tokenResponse: { status: number; body: unknown };
  existingComments: Array<{ id: number; body: string; performed_via_github_app?: { id: number } }>;
  postStatus: 201 | 403;
}
interface Recorded {
  method: string;
  url: string;
  authorization: string | null;
}

let scenario: Scenario;
const requests: Recorded[] = [];
const unexpected: string[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

(globalThis as { fetch: typeof fetch }).fetch = (async (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  requests.push({ method, url, authorization: new Headers(init?.headers).get("authorization") });

  if (method === "POST" && /\/app\/installations\/\d+\/access_tokens$/.test(url)) {
    return json(scenario.tokenResponse.status, scenario.tokenResponse.body);
  }
  if (method === "GET" && /\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments(\?|$)/.test(url)) {
    return json(200, scenario.existingComments);
  }
  if (method === "POST" && /\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/.test(url)) {
    return scenario.postStatus === 201
      ? json(201, { id: 901, html_url: "https://github.com/acme-corp/demo-app/pull/7#issuecomment-901" })
      : json(403, { message: "Resource not accessible by integration" });
  }
  const patch = /\/repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/.exec(url);
  if (method === "PATCH" && patch) {
    return json(200, { id: Number(patch[1]), html_url: `https://github.com/acme-corp/demo-app/pull/7#issuecomment-${patch[1]}` });
  }
  unexpected.push(`${method} ${url}`);
  return json(599, { message: "unexpected request in the witness" });
}) as typeof fetch;

// ---- the delivery ------------------------------------------------------------

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

const CAPS = { monthlyCapUsd: 5, dailyCapUsd: 2 };
const WITHIN_BUDGET: BudgetCheck = { withinBudget: true, monthlySpend: 0.1, dailySpend: 0.05, caps: CAPS };
const UNVERIFIABLE: BudgetCheck = {
  withinBudget: false,
  reason: "budget_unverifiable",
  monthlySpend: 0,
  dailySpend: 0,
  caps: CAPS,
};

const SAMPLE = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), "src/integrations/github/samples/pull_request.opened.sample.json"),
    "utf8",
  ),
) as Record<string, unknown>;

/**
 * Runs the handler as webhook-server.ts does, except that the diff and the
 * budget read are injected. No `token` option: the handler must mint one.
 */
function runHandler(installationId: number | null, budget: BudgetCheck) {
  const payload =
    installationId === null ? SAMPLE : { ...SAMPLE, installation: { id: installationId } };
  return handlePullRequestWebhook({
    rawBody: JSON.stringify(payload),
    payload,
    dryRun: false,
    skipSignatureVerification: true,
    updateExisting: true,
    usePrDiffFallback: true,
    resolveSemgrep: () => PR_DIFF,
    checkBudgetImpl: async () => budget,
    // Section F delivers with no installation (PAT mode): explicitly unpriced.
    allowUnpricedScan: true,
    workflowMetadata: { scanId: "comment-token-witness" },
  });
}

function reset(next: Partial<Scenario>): void {
  scenario = {
    tokenResponse: {
      status: 201,
      body: { token: INSTALLATION_TOKEN, expires_at: new Date(Date.now() + 3_600_000).toISOString() },
    },
    existingComments: [],
    postStatus: 201,
    ...next,
  };
  requests.length = 0;
  unexpected.length = 0;
  clearInstallationTokenCache();
}

const isMint = (r: Recorded) => /\/access_tokens$/.test(r.url);
const isComment = (r: Recorded) => /\/issues\/(\d+\/comments|comments\/\d+)/.test(r.url);

function commentCalls(): Array<[string, string | null]> {
  return requests.filter(isComment).map((r) => [r.method, r.authorization]);
}

function assertNoEnvToken(label: string): void {
  const leaked = requests.filter((r) => r.authorization?.includes(ENV_TOKEN)).length;
  assertEq(leaked, 0, `${label}: no request carried GITHUB_TOKEN`);
  assertEq(unexpected, [], `${label}: no request outside the recorder's routes`);
}

function assertMintedOnce(label: string): void {
  const mints = requests.filter(isMint);
  assertEq(mints.length, 1, `${label}: the handler minted an installation token`);
  assert(
    mints[0]?.authorization?.startsWith("Bearer ey"),
    `${label}: the mint was authenticated with the App JWT`,
  );
}

const INST = `Bearer ${INSTALLATION_TOKEN}`;

async function testFirstReport(): Promise<void> {
  section("A. first report on a pull request -> POST with the installation token");
  reset({});
  const result = await runHandler(1001, WITHIN_BUDGET);
  assertMintedOnce("first report");
  assertEq(commentCalls(), [["GET", INST], ["POST", INST]], "first report: list and create both used the installation token");
  assertNoEnvToken("first report");
  assert(result.ok && result.comment.commentAction === "created", "first report: comment created");
}

async function testUpdateExisting(): Promise<void> {
  section("B. report already on the pull request -> PATCH with the installation token");
  // The App's own earlier report: only a comment this App created is edited
  // (test-comment-authorship.ts).
  reset({
    existingComments: [
      { id: 555, body: `${FIXOR_PR_COMMENT_MARKER}\nprevious report`, performed_via_github_app: { id: 424242 } },
    ],
  });
  const result = await runHandler(1002, WITHIN_BUDGET);
  assertMintedOnce("update");
  assertEq(commentCalls(), [["GET", INST], ["PATCH", INST]], "update: list and edit both used the installation token");
  assert(
    requests.some((r) => r.method === "PATCH" && r.url.endsWith("/issues/comments/555")),
    "update: the existing Fixor comment was the one edited",
  );
  assertNoEnvToken("update");
  assert(result.ok && result.comment.commentAction === "updated", "update: comment updated");
}

async function testSkippedScanNotice(): Promise<void> {
  section('C. "did not scan this commit" notice -> posted with the installation token');
  reset({});
  const result = await runHandler(1003, UNVERIFIABLE);
  assertMintedOnce("notice");
  assertEq(commentCalls(), [["GET", INST], ["POST", INST]], "notice: list and create both used the installation token");
  assertNoEnvToken("notice");
  assert(result.ok && result.workflow.status === "budget_unverifiable", "notice: the scan was refused");
  assert(
    result.ok && result.comment.body.includes("Fixor did not scan this commit"),
    "notice: the posted body is the skipped-scan notice",
  );
}

async function testNoWriteAccess(): Promise<void> {
  section("D. App lacks write access (403) -> post fails, never retried with GITHUB_TOKEN");
  reset({ postStatus: 403 });
  const result = await runHandler(1004, WITHIN_BUDGET);
  assertMintedOnce("403");
  assertEq(commentCalls(), [["GET", INST], ["POST", INST]], "403: one attempt, with the installation token");
  assertNoEnvToken("403");
  assert(!result.ok && result.githubError?.status === 403, "403: the handler reports the GitHub refusal");
}

async function testMintWithoutToken(): Promise<void> {
  section("E. token response without a token -> delivery fails, no GITHUB_TOKEN fallback");
  reset({ tokenResponse: { status: 201, body: { expires_at: new Date(Date.now() + 3_600_000).toISOString() } } });
  let rejected: unknown = null;
  try {
    await runHandler(1005, WITHIN_BUDGET);
  } catch (err) {
    rejected = err;
  }
  assert(
    rejected instanceof Error && rejected.message.includes("no installation token"),
    "no token: the delivery fails at the mint",
  );
  assertEq(commentCalls(), [], "no token: no comment request was made");
  assertNoEnvToken("no token");
}

async function testPatMode(): Promise<void> {
  section("F. delivery without an installation (PAT mode) -> GITHUB_TOKEN, as configured");
  reset({});
  const result = await runHandler(null, WITHIN_BUDGET);
  assertEq(requests.filter(isMint).length, 0, "PAT mode: no installation token is minted");
  const env = `Bearer ${ENV_TOKEN}`;
  assertEq(commentCalls(), [["GET", env], ["POST", env]], "PAT mode: the configured GITHUB_TOKEN posts");
  assertEq(unexpected, [], "PAT mode: no request outside the recorder's routes");
  assert(result.ok && result.comment.commentAction === "created", "PAT mode: comment created");
}

const EXPECTED_SECTIONS = 6;

async function main(): Promise<void> {
  // Zero-spend precondition, checked before anything else runs.
  if (getAnthropicClient() !== null) {
    console.error("[FAIL] an Anthropic client exists in this process; refusing to run");
    process.exit(1);
  }
  console.log("[PASS] no Anthropic client exists in this process");

  await testFirstReport();
  await testUpdateExisting();
  await testSkippedScanNotice();
  await testNoWriteAccess();
  await testMintWithoutToken();
  await testPatMode();

  assertEq(sectionsRun.length, EXPECTED_SECTIONS, "every section ran");
  assert(getAnthropicClient() === null, "still no Anthropic client after the run");

  console.log(
    failures === 0
      ? "\nComment installation-token witness: PASS."
      : `\nComment installation-token witness: ${failures} FAILURE(S).`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
