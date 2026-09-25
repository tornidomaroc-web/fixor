/**
 * Witness: Fixor edits only a report it wrote itself.
 *
 * To find the report to update, the poster used to take the last comment
 * whose body carried the Fixor marker, whoever wrote it. The marker is
 * public, so a contributor could plant it in a comment on their own pull
 * request and Fixor would edit that comment instead of posting its own:
 * the report then lived in a comment the contributor authored and could
 * rewrite (a forged clean report), or the edit was refused and no report
 * appeared (a suppressed one). A comment now counts as Fixor's only when
 * GitHub reports it was created by this App (`performed_via_github_app`).
 * This test proves it on the pure matcher, on the parsing of GitHub's list
 * response, and end to end through the real handler, poster and GitHub
 * client with `fetch` replaced by a recorder:
 *
 *   - a marker comment written by a user, by another App, or by the
 *     owner's personal account is never edited and never treated as the
 *     existing report, wherever it sits (alone, above, below);
 *   - the App's own marker comment is still edited;
 *   - with no App identity (a personal token) nothing is edited.
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

const APP_ID = 424242;
process.env.GITHUB_TOKEN = "from-environment";
process.env.GITHUB_APP_ID = String(APP_ID);

import { generateKeyPairSync } from "node:crypto";
import * as fs from "fs";
import * as path from "path";

import { getAnthropicClient } from "../analysis-engine/anthropic-client";
import { clearInstallationTokenCache } from "../integrations/github/app-auth.service";
import { FIXOR_PR_COMMENT_MARKER } from "../integrations/github/comment-constants";
import {
  findLatestFixorIssueCommentId,
  listIssueComments,
  type IssueCommentItem,
} from "../integrations/github/github-client";
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

// ---- comments as GitHub's list endpoint returns them -----------------------

const OWN_CLIENT_ID = "Iv1.fixor-witness";
const REPORT = `${FIXOR_PR_COMMENT_MARKER}\n## 🛡️ Fixor Security Report\n`;

type Row = Record<string, unknown>;
/** The App's own earlier report. */
const own = (id: number): Row => ({
  id,
  body: `${REPORT}earlier report`,
  user: { login: "fixor-security[bot]", type: "Bot" },
  performed_via_github_app: { id: APP_ID, client_id: OWN_CLIENT_ID, slug: "fixor-security" },
});
/** A contributor's comment carrying the public marker: a forged clean report. */
const planted = (id: number): Row => ({
  id,
  body: `${REPORT}0 findings`,
  user: { login: "pr-author", type: "User" },
  performed_via_github_app: null,
});
/** Another App's comment carrying the marker. */
const otherApp = (id: number): Row => ({
  id,
  body: `${REPORT}0 findings`,
  user: { login: "other-bot[bot]", type: "Bot" },
  performed_via_github_app: { id: 99999, client_id: "Iv1.other-app", slug: "other-bot" },
});
/** A report posted under the owner's personal account before the App posted as itself. */
const legacy = (id: number): Row => ({
  id,
  body: `${REPORT}legacy report`,
  user: { login: "tornidomaroc-web", type: "User" },
  performed_via_github_app: null,
});

// ---- the recorder that replaces fetch --------------------------------------

interface Recorded {
  method: string;
  url: string;
}
let existingRows: Row[] = [];
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
  requests.push({ method, url });

  if (method === "POST" && /\/app\/installations\/\d+\/access_tokens$/.test(url)) {
    return json(201, { token: "from-installation", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
  }
  if (method === "GET" && /\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments(\?|$)/.test(url)) {
    return json(200, existingRows);
  }
  if (method === "POST" && /\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/.test(url)) {
    return json(201, { id: 901, html_url: "https://github.com/acme-corp/demo-app/pull/7#issuecomment-901" });
  }
  const patch = /\/repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/.exec(url);
  if (method === "PATCH" && patch) {
    return json(200, { id: Number(patch[1]), html_url: `https://github.com/acme-corp/demo-app/pull/7#issuecomment-${patch[1]}` });
  }
  unexpected.push(`${method} ${url}`);
  return json(599, { message: "unexpected request in the witness" });
}) as typeof fetch;

/** The comment calls of one delivery, as "GET list", "POST new" or "PATCH <id>". */
function commentCalls(): string[] {
  const out: string[] = [];
  for (const r of requests) {
    if (r.method === "GET" && /\/issues\/\d+\/comments/.test(r.url)) out.push("GET list");
    else if (r.method === "POST" && /\/issues\/\d+\/comments$/.test(r.url)) out.push("POST new");
    else {
      const m = /\/issues\/comments\/(\d+)$/.exec(r.url);
      if (r.method === "PATCH" && m) out.push(`PATCH ${m[1]}`);
    }
  }
  return out;
}

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

let nextInstallationId = 2001;

/**
 * One delivery through the real handler, as webhook-server.ts runs it,
 * with the diff and the budget read injected and `rows` as the comments
 * already on the pull request. `installation: false` is PAT mode.
 */
async function deliver(rows: Row[], installation = true) {
  existingRows = rows;
  requests.length = 0;
  unexpected.length = 0;
  clearInstallationTokenCache();
  const payload = installation
    ? { ...SAMPLE, installation: { id: nextInstallationId++ } }
    : SAMPLE;
  const result = await handlePullRequestWebhook({
    rawBody: JSON.stringify(payload),
    payload,
    dryRun: false,
    skipSignatureVerification: true,
    updateExisting: true,
    usePrDiffFallback: true,
    resolveSemgrep: () => PR_DIFF,
    checkBudgetImpl: async () => WITHIN_BUDGET,
    // Section I delivers with no installation (PAT mode): explicitly unpriced.
    allowUnpricedScan: true,
    workflowMetadata: { scanId: "comment-authorship-witness" },
  });
  assertEq(unexpected, [], "no request outside the recorder's routes");
  return result;
}

// ---- sections ----------------------------------------------------------------

function item(id: number, createdByApp: IssueCommentItem["createdByApp"], marker = true): IssueCommentItem {
  return { id, body: marker ? `${REPORT}x` : "a plain comment", createdByApp };
}
const OWN = { id: APP_ID, clientId: OWN_CLIENT_ID };
const OTHER = { id: 99999, clientId: "Iv1.other-app" };

function testMatcher(): void {
  section("A. the matcher: only this App's marker comment counts");
  const app = String(APP_ID);
  assertEq(findLatestFixorIssueCommentId([item(1, OWN)], app), 1, "the App's own marker comment is found");
  assertEq(findLatestFixorIssueCommentId([item(1, null)], app), undefined, "a user's marker comment is not");
  assertEq(findLatestFixorIssueCommentId([item(1, OTHER)], app), undefined, "another App's marker comment is not");
  assertEq(findLatestFixorIssueCommentId([item(1, OWN, false)], app), undefined, "the App's comment without the marker is not");
  assertEq(findLatestFixorIssueCommentId([item(1, OWN), item(2, null)], app), 1, "a planted comment below the report is skipped");
  assertEq(findLatestFixorIssueCommentId([item(1, null), item(2, OWN)], app), 2, "a planted comment above the report is skipped");
  assertEq(findLatestFixorIssueCommentId([item(1, OWN), item(2, null), item(3, OWN)], app), 3, "the latest of the App's own comments wins");
  assertEq(findLatestFixorIssueCommentId([item(1, OWN)], undefined), undefined, "no App identity (personal token): nothing counts");
  assertEq(findLatestFixorIssueCommentId([item(1, OWN)], "  "), undefined, "a blank App identity: nothing counts");
  assertEq(findLatestFixorIssueCommentId([item(1, OWN)], ` ${app} `), 1, "the App ID is trimmed");
  assertEq(findLatestFixorIssueCommentId([item(1, OWN)], OWN_CLIENT_ID), 1, "a client-ID identity matches on client_id");
  assertEq(findLatestFixorIssueCommentId([item(1, OTHER)], OWN_CLIENT_ID), undefined, "a client-ID identity rejects another App");
}

async function testListParsing(): Promise<void> {
  section("B. the list response: performed_via_github_app becomes createdByApp");
  existingRows = [
    own(11),
    planted(12),
    { id: 13, body: "no performed_via_github_app field at all" },
    { id: 14, body: "malformed app", performed_via_github_app: { id: "424242" } },
  ];
  requests.length = 0;
  unexpected.length = 0;
  const items = await listIssueComments({ owner: "acme-corp", repo: "demo-app", issueNumber: 7, token: "from-installation" });
  assertEq(
    items.map((c) => [c.id, c.createdByApp]),
    [
      [11, { id: APP_ID, clientId: OWN_CLIENT_ID }],
      [12, null],
      [13, null],
      [14, null],
    ],
    "own -> the App's id and client id; user, missing and malformed -> null",
  );
  assertEq(unexpected, [], "no request outside the recorder's routes");
}

async function testPlantedAlone(): Promise<void> {
  section("C. only a planted marker comment -> Fixor posts its own, never edits it");
  const result = await deliver([planted(777)]);
  assertEq(commentCalls(), ["GET list", "POST new"], "list, then a new comment");
  assert(!commentCalls().includes("PATCH 777"), "the planted comment was never edited");
  assert(result.ok && result.comment.commentAction === "created", "comment created");
}

async function testPlantedBelow(): Promise<void> {
  section("D. planted comment below the App's report -> the App's report is edited");
  const result = await deliver([own(500), planted(600)]);
  assertEq(commentCalls(), ["GET list", "PATCH 500"], "list, then edit the App's own report");
  assert(!commentCalls().includes("PATCH 600"), "the planted comment was never edited");
  assert(result.ok && result.comment.commentAction === "updated", "comment updated");
}

async function testPlantedAbove(): Promise<void> {
  section("E. planted comment above the App's report -> the App's report is edited");
  const result = await deliver([planted(400), own(500)]);
  assertEq(commentCalls(), ["GET list", "PATCH 500"], "list, then edit the App's own report");
  assert(!commentCalls().includes("PATCH 400"), "the planted comment was never edited");
  assert(result.ok && result.comment.commentAction === "updated", "comment updated");
}

async function testOtherApp(): Promise<void> {
  section("F. another App's marker comment -> Fixor posts its own");
  const result = await deliver([otherApp(800)]);
  assertEq(commentCalls(), ["GET list", "POST new"], "list, then a new comment");
  assert(result.ok && result.comment.commentAction === "created", "comment created");
}

async function testOwnReport(): Promise<void> {
  section("G. the App's own report -> still edited");
  const result = await deliver([own(500)]);
  assertEq(commentCalls(), ["GET list", "PATCH 500"], "list, then edit it");
  assert(result.ok && result.comment.commentAction === "updated", "comment updated");
}

async function testLegacyPersonal(): Promise<void> {
  section("H. a legacy report under the owner's personal account -> left alone, a new one posted");
  const result = await deliver([legacy(4927743059)]);
  assertEq(commentCalls(), ["GET list", "POST new"], "list, then a new comment");
  assert(!commentCalls().includes("PATCH 4927743059"), "the legacy comment was never edited");
  assert(result.ok && result.comment.commentAction === "created", "comment created");
}

async function testPatMode(): Promise<void> {
  section("I. PAT mode (no installation, no App identity) -> nothing is edited");
  const result = await deliver([own(500)], false);
  assertEq(commentCalls(), ["GET list", "POST new"], "list, then a new comment");
  assert(result.ok && result.comment.commentAction === "created", "comment created");
}

const EXPECTED_SECTIONS = 9;

async function main(): Promise<void> {
  // Zero-spend precondition, checked before anything else runs.
  if (getAnthropicClient() !== null) {
    console.error("[FAIL] an Anthropic client exists in this process; refusing to run");
    process.exit(1);
  }
  console.log("[PASS] no Anthropic client exists in this process");

  testMatcher();
  await testListParsing();
  await testPlantedAlone();
  await testPlantedBelow();
  await testPlantedAbove();
  await testOtherApp();
  await testOwnReport();
  await testLegacyPersonal();
  await testPatMode();

  assertEq(sectionsRun.length, EXPECTED_SECTIONS, "every section ran");
  assert(getAnthropicClient() === null, "still no Anthropic client after the run");

  console.log(
    failures === 0
      ? "\nComment authorship witness: PASS."
      : `\nComment authorship witness: ${failures} FAILURE(S).`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
