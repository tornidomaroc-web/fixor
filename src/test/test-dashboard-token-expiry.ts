/**
 * Witness: when GitHub refuses the user's App token (401: expired and not
 * refreshed, or revoked), the dashboard's repository filter still shows
 * nothing it should not, and every page and route says a new sign-in is
 * needed instead of answering 404, "GitHub didn't respond" or 502.
 *
 * Pre-public queue item 7. The App's user tokens expire after eight hours
 * unless the App opts out; whether Clerk refreshes one transparently is
 * not documented where this test could read it, so the dashboard has to
 * behave when it does not.
 *
 * What runs is the dashboard's own source (src/test/lib/dashboard-loader.ts):
 * lib/github.ts, lib/org-access.ts, the home, scan history, scan detail and
 * settings pages, and the three org API routes. `fetch` answers GitHub with
 * a chosen status per endpoint; the data layer is an in-memory stand-in
 * whose scan query keeps the real one's meaning (rows only for repositories
 * in the visible list).
 *
 * Fails on main: there a 401 is `error`, so the home page blames GitHub,
 * every org page answers 404 and the routes answer 502.
 *
 * Keyless and $0: no Anthropic client, no database, no network.
 */
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DATABASE_URL;
process.env.FIXOR_GITHUB_APP_ID = "1111";
process.env.PADDLE_PRICE_TEAM = "pri_witness_team";

import { installDashboardLoader, renderPage } from "./lib/dashboard-loader";

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

// ---- GitHub, one status per endpoint --------------------------------------------

const INST = { id: 3101, app_id: 1111, target_type: "User", account: { id: 501, login: "owner-u", type: "User", avatar_url: "" } };
const ORG_A = "00000000-0000-4000-8000-00000000000a";
const VISIBLE_REPO = "acme-corp/demo-app";
const HIDDEN_REPO = "acme-corp/private-payroll";

const gh = { installations: 200, repos: 200 };
const unexpected: string[] = [];
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const u = new URL(url);
  if (u.host !== "api.github.com") { unexpected.push(url); throw new Error(`unexpected fetch ${url}`); }
  if (u.pathname === "/user/installations") {
    return gh.installations === 200
      ? json(200, { total_count: 1, installations: [INST] })
      : json(gh.installations, { message: gh.installations === 401 ? "Bad credentials" : "nope" });
  }
  if (u.pathname === "/user/installations/3101/repositories") {
    return gh.repos === 200
      ? json(200, { total_count: 1, repositories: [{ full_name: VISIBLE_REPO }] })
      : json(gh.repos, { message: gh.repos === 401 ? "Bad credentials" : "nope" });
  }
  if (u.pathname === "/user") return json(200, { id: 501, login: "owner-u" });
  unexpected.push(url);
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

// ---- the data layer -------------------------------------------------------------

const SCANS = [
  { id: "11111111-1111-4111-8111-111111111111", repoFullName: VISIBLE_REPO, pullNumber: 7, headSha: "a".repeat(40), status: "completed", totalFindings: 1, fixesGenerated: 0, costUsd: 0, startedAt: new Date(), finishedAt: new Date(), errorMessage: null },
  { id: "22222222-2222-4222-8222-222222222222", repoFullName: HIDDEN_REPO, pullNumber: 9, headSha: "b".repeat(40), status: "completed", totalFindings: 3, fixesGenerated: 0, costUsd: 0, startedAt: new Date(), finishedAt: new Date(), errorMessage: null },
];
const scanQueries: string[][] = [];

const { load } = installDashboardLoader({
  outDirName: "dashboard-token-expiry",
  stubs: {
    "@clerk/nextjs/server": {
      auth: async () => ({ userId: "clerk_501" }),
      clerkClient: async () => ({
        users: {
          getUserOauthAccessToken: async () => ({ data: [{ token: "ghu_witness", provider: "oauth_github", scopes: [] }] }),
          getUser: async () => ({ primaryEmailAddressId: "e1", emailAddresses: [{ id: "e1", emailAddress: "owner@example.test" }] }),
        },
      }),
    },
    "@/lib/scans-data": {
      getOrgForUser: async (orgId: string, allowed: string[]) =>
        orgId === ORG_A && allowed.includes("3101")
          ? { id: ORG_A, installationId: "3101", planTier: "indie", paddleCustomerId: "ctm_a", paddleSubscriptionId: "sub_a" }
          : null,
      // Same meaning as scan-queries.ts: rows only for the visible repositories.
      getScansForOrg: async (installationId: string, visible: string[]) => {
        scanQueries.push(visible);
        return SCANS.filter((s) => installationId === "3101" && visible.includes(s.repoFullName));
      },
      getScanForOrg: async (installationId: string, visible: string[], id: string) =>
        SCANS.find((s) => s.id === id && installationId === "3101" && visible.includes(s.repoFullName)) ?? null,
    },
    "@/lib/trends-data": {
      getTrendsForOrg: async (_i: string, visible: string[]) => ({
        weekly: [], byFamily: [], totalScans: SCANS.filter((s) => visible.includes(s.repoFullName)).length, weeks: 8,
      }),
    },
    "@/lib/settings-data": {
      DEFAULT_ORG_SETTINGS: { severityThreshold: "low", ignoredGlobs: [], enabledDetectors: null, slackWebhookUrl: null },
      getOrgSettings: async () => ({ severityThreshold: "low", ignoredGlobs: [], enabledDetectors: null, slackWebhookUrl: null }),
      updateOrgSettings: async () => {},
    },
    "@/lib/orgs-data": {
      getOrgSummaries: async (ids: string[]) =>
        ids.map((id) => ({ installationId: id, orgId: ORG_A, planTier: "indie", monthlyCapUsd: 5, monthlySpendUsd: 1, createdAt: null })),
    },
    "@/lib/onboarding-state": {
      readClerkUserEmail: async () => "owner@example.test",
      populateInstallerEmailIfMissing: async () => {},
    },
    "@/lib/paddle": {
      createCheckoutTransaction: async () => ({ checkoutUrl: "https://pay.example/checkout" }),
      getSubscriptionManagementUrls: async () => ({ cancel: "https://pay.example/cancel", updatePaymentMethod: "https://pay.example/update" }),
    },
  },
});

type Page = { default: (a: unknown) => Promise<unknown> };
type Route = (r: Request, c?: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
const home = () => load<Page>("app/page").default;
const scansPage = () => load<Page>("app/orgs/[id]/scans/page").default;
const detailPage = () => load<Page>("app/orgs/[id]/scans/[scanId]/page").default;
const settingsPage = () => load<Page>("app/orgs/[id]/settings/page").default;
const settingsRoute = () => load<{ PATCH: Route }>("app/api/orgs/[id]/settings/route").PATCH;
const checkoutRoute = () => load<{ POST: Route }>("app/api/billing/checkout/route").POST;
const portalRoute = () => load<{ POST: Route }>("app/api/billing/portal/route").POST;

function req(url: string, body: unknown, method = "POST"): Request {
  return new Request(`https://dash.example${url}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}
const has = (tree: string, needle: string) => tree.includes(needle);
/** The `reason` prop the home page hands the install wizard, or null when no wizard rendered. */
function wizardReason(tree: string): string | null {
  const m = /"type":"InstallWizard","props":\{[^}]*?"reason":("[^"]*"|undefined)?/.exec(tree);
  if (!m) return null;
  return m[1] ? JSON.parse(m[1]) : "(none)";
}
function set(installations: number, repos: number): void {
  gh.installations = installations;
  gh.repos = repos;
  scanQueries.length = 0;
}

// ---- sections -------------------------------------------------------------------

async function testLib(): Promise<void> {
  section("A. lib/github.ts tells a refused token apart from every other failure");
  const lib = load<{
    listFixorInstallations: () => Promise<{ status: string }>;
    listVisibleRepoNames: (id: string) => Promise<{ status: string; repos?: string[] }>;
  }>("lib/github");
  for (const [status, want] of [[200, "ok"], [401, "unauthorized"], [403, "error"], [500, "error"]] as const) {
    set(status, 200);
    const got = (await lib.listFixorInstallations()).status;
    console.log(`       GET /user/installations -> ${status}: listFixorInstallations = ${got}`);
    assertEq(got, want, `installations ${status}: ${want}`);
  }
  for (const [status, want] of [[200, "ok"], [401, "unauthorized"], [500, "error"]] as const) {
    set(200, status);
    const r = await lib.listVisibleRepoNames("3101");
    console.log(`       GET /user/installations/3101/repositories -> ${status}: listVisibleRepoNames = ${JSON.stringify(r)}`);
    assertEq(r.status, want, `repositories ${status}: ${want}`);
    if (status === 200) assertEq(r.repos, [VISIBLE_REPO], "repositories 200: the visible list");
  }
}

async function testFilterFailsClosed(): Promise<void> {
  section("B. the history filter never widens when the repository list cannot be read");
  for (const [repos, want] of [[401, "notice"], [500, "error"], [200, "table"]] as const) {
    set(200, repos);
    const tree = await renderPage(scansPage(), { id: ORG_A });
    const hidden = has(tree, HIDDEN_REPO);
    const visible = has(tree, VISIBLE_REPO);
    const table = has(tree, '"type":"table"');
    const trends = has(tree, '"TrendsChart"');
    const notice = has(tree, '"SessionExpiredNotice"');
    const errorState = has(tree, "load scan history");
    console.log(`       repositories -> ${repos}: hidden repo ${hidden}, visible repo ${visible}, table ${table}, trends ${trends}, notice ${notice}, error state ${errorState}, queries ${JSON.stringify(scanQueries)}`);
    assertEq(hidden, false, `repositories ${repos}: the hidden repository's scan is never shown`);
    if (want === "table") {
      assertEq([visible, table, trends, notice, errorState], [true, true, true, false, false], "repositories 200: the visible scan, table and trends render");
      assertEq(scanQueries, [[VISIBLE_REPO]], "repositories 200: the query was scoped to the visible list");
    } else {
      assertEq([visible, table, trends], [false, false, false], `repositories ${repos}: no scan, no table, no trends`);
      assertEq(scanQueries, [], `repositories ${repos}: no scan query was sent`);
      assertEq([notice, errorState], want === "notice" ? [true, false] : [false, true], `repositories ${repos}: ${want === "notice" ? "the sign-in notice" : "the generic error state"}`);
    }
  }
  set(200, 401);
  const detail = await renderPage(detailPage(), { id: ORG_A, scanId: SCANS[0]!.id });
  console.log(`       detail page, repositories -> 401: ${detail === "404" ? "404" : has(detail, '"SessionExpiredPage"') ? "SessionExpiredPage" : "other"}`);
  assert(detail !== "404" && has(detail, '"SessionExpiredPage"') && !has(detail, VISIBLE_REPO), "detail page, repositories 401: the sign-in page, not the scan and not 404");
  set(200, 200);
  const detailOk = await renderPage(detailPage(), { id: ORG_A, scanId: SCANS[0]!.id });
  assert(has(detailOk, VISIBLE_REPO), "detail page, repositories 200: the visible scan renders");
  const detailHidden = await renderPage(detailPage(), { id: ORG_A, scanId: SCANS[1]!.id });
  assertEq(detailHidden, "404", "detail page, repositories 200: the hidden repository's scan is 404");
}

async function testRefusedTokenIsExplained(): Promise<void> {
  section("C. GET /user/installations -> 401: every surface says to sign in again");
  set(401, 200);
  const h = await renderPage(home(), {});
  console.log(`       home: wizard reason = ${wizardReason(h)}`);
  assertEq(wizardReason(h), "unauthorized", "home page: the install wizard shows the sign-in-expired reason");
  const s = await renderPage(scansPage(), { id: ORG_A });
  console.log(`       scans page: ${s === "404" ? "404" : has(s, '"SessionExpiredPage"') ? "SessionExpiredPage" : "other"}`);
  assert(s !== "404" && has(s, '"SessionExpiredPage"'), "scans page: the sign-in page, not 404");
  const st = await renderPage(settingsPage(), { id: ORG_A });
  console.log(`       settings page: ${st === "404" ? "404" : has(st, '"SessionExpiredPage"') ? "SessionExpiredPage" : "other"}`);
  assert(st !== "404" && has(st, '"SessionExpiredPage"') && !has(st, '"SettingsForm"'), "settings page: the sign-in page, no form, not 404");
  const patch = await settingsRoute()(req(`/api/orgs/${ORG_A}/settings`, { severityThreshold: "low", ignoredGlobs: [], enabledDetectors: null, slackWebhookUrl: null }, "PATCH"), { params: Promise.resolve({ id: ORG_A }) });
  console.log(`       PATCH settings: ${JSON.stringify(patch)}`);
  assertEq([patch.status, patch.body.error], [401, "github_unauthorized"], "PATCH settings: 401 github_unauthorized");
  const co = await checkoutRoute()(req("/api/billing/checkout", { orgId: ORG_A, tier: "team" }));
  const po = await portalRoute()(req("/api/billing/portal", { orgId: ORG_A, kind: "cancel" }));
  console.log(`       checkout: ${JSON.stringify(co)}; portal: ${JSON.stringify(po)}`);
  assertEq([co.status, co.body.error, po.status, po.body.error], [401, "github_unauthorized", 401, "github_unauthorized"], "checkout and portal: 401 github_unauthorized");
}

async function testOtherFailuresUnchanged(): Promise<void> {
  section("D. controls: 500 and 403 keep the old answers; 200 is the normal page");
  for (const status of [500, 403] as const) {
    set(status, 200);
    const h = await renderPage(home(), {});
    const s = await renderPage(scansPage(), { id: ORG_A });
    const patch = await settingsRoute()(req(`/api/orgs/${ORG_A}/settings`, { severityThreshold: "low", ignoredGlobs: [], enabledDetectors: null, slackWebhookUrl: null }, "PATCH"), { params: Promise.resolve({ id: ORG_A }) });
    console.log(`       installations -> ${status}: home reason ${wizardReason(h)}, scans page ${s === "404" ? "404" : "rendered"}, PATCH ${JSON.stringify(patch)}`);
    assertEq(wizardReason(h), "error", `installations ${status}: home page blames GitHub, not the sign-in`);
    assertEq(s, "404", `installations ${status}: scans page is 404`);
    assertEq([patch.status, patch.body.error], [502, "github_unavailable"], `installations ${status}: PATCH 502 github_unavailable`);
  }
  set(200, 200);
  const h = await renderPage(home(), {});
  const patch = await settingsRoute()(req(`/api/orgs/${ORG_A}/settings`, { severityThreshold: "low", ignoredGlobs: [], enabledDetectors: null, slackWebhookUrl: null }, "PATCH"), { params: Promise.resolve({ id: ORG_A }) });
  console.log(`       installations -> 200: home wizard ${wizardReason(h) ?? "absent"}, org listed ${has(h, "owner-u")}, PATCH ${patch.status}`);
  assertEq([wizardReason(h), has(h, "owner-u"), patch.status], [null, true, 200], "installations 200: the org list, no wizard, PATCH 200");
}

const EXPECTED_SECTIONS = 4;

async function main(): Promise<void> {
  for (const run of [testLib, testFilterFailsClosed, testRefusedTokenIsExplained, testOtherFailuresUnchanged]) {
    try {
      await run();
    } catch (err) {
      assert(false, `section threw: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    }
  }
  assertEq(unexpected, [], "no request left the three expected GitHub endpoints");
  assertEq(sectionsRun.length, EXPECTED_SECTIONS, "every section ran");
  assertEq(process.env.ANTHROPIC_API_KEY, undefined, "no Anthropic key in this process");
  console.log(failures === 0 ? "\nToken-expiry witness: PASS." : `\nToken-expiry witness: ${failures} FAILURE(S).`);
  process.exit(failures > 0 ? 1 : 0);
}

void main();
