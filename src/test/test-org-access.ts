/**
 * Witness: only the installation's owner can change an org's settings,
 * reach its billing, or see its spend; anyone GitHub lets see the
 * installation can still open the org; nobody else can.
 *
 * The owner is the account itself for a personal-account installation
 * (GET /user id == installation.account.id), and an ACTIVE org owner for an
 * organization installation (GET /user/memberships/orgs/{org}: role
 * "admin", state "active", organization.id == installation.account.id).
 * Anything else, including every GitHub error, is a viewer.
 *
 * GitHub lists an installation in GET /user/installations for anyone with
 * explicit read access to ONE of its repositories, so that listing is a
 * visibility check and never an authority check. Before this change the
 * dashboard used it as both.
 *
 * What runs is the dashboard's own source: the three API routes
 * (settings PATCH, billing checkout, billing portal), the home, settings
 * and billing pages, and lib/github.ts, transpiled from apps/dashboard/src
 * at test time. What is replaced:
 *   - `fetch` answers GitHub for each persona; an unexpected URL fails;
 *   - Clerk, next/server, next/navigation, React's JSX runtime and every
 *     component, so a page returns its element tree unrendered;
 *   - the data layer (scans-data, settings-data, orgs-data,
 *     onboarding-state, paddle) by in-memory recorders. getOrgForUser keeps
 *     its SQL's meaning: the org, only when its installation is in the list.
 *
 * Keyless and $0: no Anthropic client is constructed, no database, no
 * network. The test does not import anything from the new access module,
 * so the same file runs against main and fails there.
 */
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DATABASE_URL;
process.env.FIXOR_GITHUB_APP_ID = "1111";
process.env.PADDLE_PRICE_INDIE = "pri_witness_indie";
process.env.PADDLE_PRICE_TEAM = "pri_witness_team";

import { installDashboardLoader, renderPage as renderDashboardPage } from "./lib/dashboard-loader";

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

// ---- the world ---------------------------------------------------------------

const SLACK_SECRET = "https://hooks.example.test/witness-webhook-secret-value";
const SPEND = 3.1415;
const CAP = 42.75;

interface Inst { id: number; app_id: number; target_type: string; account: { id: number; login: string; type: string; avatar_url: string } }
const USER_INST: Inst = { id: 3101, app_id: 1111, target_type: "User", account: { id: 501, login: "owner-u", type: "User", avatar_url: "" } };
const ORG_INST: Inst = { id: 4202, app_id: 1111, target_type: "Organization", account: { id: 900, login: "acme-org", type: "Organization", avatar_url: "" } };
const STRANGER_INST: Inst = { id: 8888, app_id: 1111, target_type: "User", account: { id: 777, login: "stranger", type: "User", avatar_url: "" } };
const OTHER_APP_INST: Inst = { ...USER_INST, id: 5555, app_id: 2222 };

const ORG_A = "00000000-0000-4000-8000-00000000000a"; // installation 3101 (personal account)
const ORG_B = "00000000-0000-4000-8000-00000000000b"; // installation 4202 (organization)
const ORG_C = "00000000-0000-4000-8000-00000000000c"; // installation 7777, nobody's
const ORGS = [
  { id: ORG_A, installationId: "3101", planTier: "indie", paddleCustomerId: "ctm_a", paddleSubscriptionId: "sub_a" },
  { id: ORG_B, installationId: "4202", planTier: "indie", paddleCustomerId: "ctm_b", paddleSubscriptionId: "sub_b" },
  { id: ORG_C, installationId: "7777", planTier: "indie", paddleCustomerId: "ctm_c", paddleSubscriptionId: "sub_c" },
];

type Membership = { status: number; body?: unknown };
interface Persona {
  name: string;
  githubId: number;
  installations: Inst[];
  memberships: Record<string, Membership>;
}
const member = (role: string, state: string, orgId = 900): Membership =>
  ({ status: 200, body: { role, state, organization: { id: orgId, login: "acme-org" } } });

const P: Record<string, Persona> = {
  owner: { name: "personal-account owner (id 501 = installation account)", githubId: 501, installations: [USER_INST, OTHER_APP_INST], memberships: {} },
  collaborator: { name: "read-only collaborator on one repo of the owner's installation", githubId: 502, installations: [USER_INST], memberships: {} },
  orgOwner: { name: "organization owner (role admin, active)", githubId: 601, installations: [ORG_INST], memberships: { "acme-org": member("admin", "active") } },
  orgMember: { name: "organization member with read on one repo (role member)", githubId: 602, installations: [ORG_INST], memberships: { "acme-org": member("member", "active") } },
  orgPendingAdmin: { name: "invited org owner, invitation not accepted (admin, pending)", githubId: 603, installations: [ORG_INST], memberships: { "acme-org": member("admin", "pending") } },
  orgAdminElsewhere: { name: "owner of a DIFFERENT org answering to the same login", githubId: 604, installations: [ORG_INST], memberships: { "acme-org": member("admin", "active", 31337) } },
  orgNoMembersPerm: { name: "org owner, but the App lacks Members:read (403)", githubId: 605, installations: [ORG_INST], memberships: { "acme-org": { status: 403, body: { message: "Resource not accessible by integration" } } } },
  outsider: { name: "user whose installations do not include org A or B", githubId: 700, installations: [STRANGER_INST], memberships: {} },
};

let current: Persona = P.owner!;
const githubCalls: string[] = [];
const unexpected: string[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const u = new URL(url);
  githubCalls.push(`${current.githubId} ${u.pathname}`);
  if (u.host !== "api.github.com") { unexpected.push(url); throw new Error(`unexpected fetch ${url}`); }
  if (u.pathname === "/user/installations") {
    return json(200, { total_count: current.installations.length, installations: current.installations });
  }
  if (u.pathname === "/user") return json(200, { id: current.githubId, login: `user-${current.githubId}` });
  const m = /^\/user\/memberships\/orgs\/([^/]+)$/.exec(u.pathname);
  if (m) {
    const got = current.memberships[decodeURIComponent(m[1]!)];
    return got ? json(got.status, got.body ?? {}) : json(404, { message: "Not Found" });
  }
  unexpected.push(url);
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

// ---- recorders standing in for the data layer ----------------------------------

const writes: Array<{ orgId: string; slack: string | null }> = [];
const paddleCalls: string[] = [];
const summaryCalls: string[][] = [];
const emailStamps: string[][] = [];
const settingsReads: string[] = [];

// ---- module loader: dashboard source in, stubs for everything around it ------
// (src/test/lib/dashboard-loader.ts; only the data layer is stubbed here)

const STUBS: Record<string, unknown> = {
  "@clerk/nextjs/server": {
    auth: async () => ({ userId: `clerk_${current.githubId}` }),
    clerkClient: async () => ({
      users: {
        getUserOauthAccessToken: async () => ({ data: [{ token: `gho_${current.githubId}`, provider: "oauth_github", scopes: [] }] }),
        getUser: async () => ({ primaryEmailAddressId: "e1", emailAddresses: [{ id: "e1", emailAddress: `${current.githubId}@example.test` }] }),
      },
    }),
  },
  "@/lib/scans-data": {
    getOrgForUser: async (orgId: string, allowed: string[]) =>
      ORGS.find((o) => o.id === orgId && allowed.includes(o.installationId)) ?? null,
  },
  "@/lib/settings-data": {
    DEFAULT_ORG_SETTINGS: { severityThreshold: "low", ignoredGlobs: [], enabledDetectors: null, slackWebhookUrl: null },
    getOrgSettings: async (orgId: string) => {
      settingsReads.push(orgId);
      return { severityThreshold: "low", ignoredGlobs: [], enabledDetectors: null, slackWebhookUrl: SLACK_SECRET };
    },
    updateOrgSettings: async (orgId: string, next: { slackWebhookUrl: string | null }) => {
      writes.push({ orgId, slack: next.slackWebhookUrl });
    },
  },
  "@/lib/orgs-data": {
    getOrgSummaries: async (ids: string[]) => {
      summaryCalls.push(ids);
      return ids.map((id) => ({
        installationId: id, orgId: ORGS.find((o) => o.installationId === id)?.id ?? null,
        planTier: "indie", monthlyCapUsd: CAP, monthlySpendUsd: SPEND, createdAt: null,
      }));
    },
  },
  "@/lib/onboarding-state": {
    readClerkUserEmail: async (id: string) => `${id}@example.test`,
    populateInstallerEmailIfMissing: async (ids: string[]) => { emailStamps.push(ids); },
  },
  "@/lib/paddle": {
    createCheckoutTransaction: async (a: { orgId: string }) => { paddleCalls.push(`checkout ${a.orgId}`); return { checkoutUrl: "https://pay.example/checkout" }; },
    getSubscriptionManagementUrls: async (sub: string) => {
      paddleCalls.push(`portal ${sub}`);
      return { cancel: `https://pay.example/cancel/${sub}`, updatePaymentMethod: `https://pay.example/update/${sub}` };
    },
  },
};
const { load } = installDashboardLoader({ outDirName: "dashboard-org-access", stubs: STUBS });

// ---- running a route or a page as a persona -----------------------------------

type RouteResult = { status: number; body: Record<string, unknown> };
async function as<T>(p: Persona, fn: () => Promise<T>): Promise<T> {
  current = p;
  return fn();
}
function req(url: string, body: unknown, method = "POST"): Request {
  return new Request(`https://dash.example${url}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

function renderPage(page: (a: unknown) => Promise<unknown>, id: string | null): Promise<string> {
  return renderDashboardPage(page, { id });
}
const has = (tree: string, needle: string | number) =>
  tree.includes(typeof needle === "number" ? `:${needle}` : needle);

const SETTINGS_BODY = { severityThreshold: "low", ignoredGlobs: ["**"], enabledDetectors: [], slackWebhookUrl: "https://attacker.example/hook" };

// ---- sections -------------------------------------------------------------------

type Route = (r: Request, c?: unknown) => Promise<RouteResult>;
const settingsRoute = () => load<{ PATCH: Route }>("app/api/orgs/[id]/settings/route").PATCH;
const checkoutRoute = () => load<{ POST: Route }>("app/api/billing/checkout/route").POST;
const portalRoute = () => load<{ POST: Route }>("app/api/billing/portal/route").POST;

async function patchSettings(p: Persona, orgId: string): Promise<{ status: number; wrote: boolean; error: unknown }> {
  const before = writes.length;
  const r = await as(p, () => settingsRoute()(req(`/api/orgs/${orgId}/settings`, SETTINGS_BODY, "PATCH"), { params: Promise.resolve({ id: orgId }) }));
  return { status: r.status, wrote: writes.length > before, error: r.body.error ?? null };
}
async function portal(p: Persona, orgId: string): Promise<{ status: number; paddle: boolean; url: unknown }> {
  const before = paddleCalls.length;
  const r = await as(p, () => portalRoute()(req("/api/billing/portal", { orgId, kind: "cancel" })));
  return { status: r.status, paddle: paddleCalls.length > before, url: r.body.url ?? null };
}
async function checkout(p: Persona, orgId: string): Promise<{ status: number; paddle: boolean }> {
  const before = paddleCalls.length;
  const r = await as(p, () => checkoutRoute()(req("/api/billing/checkout", { orgId, tier: "team" })));
  return { status: r.status, paddle: paddleCalls.length > before };
}

async function testSettingsPatch(): Promise<void> {
  section("A. PATCH /api/orgs/:id/settings");
  const rows: Array<[Persona, string, number, boolean]> = [
    [P.owner!, ORG_A, 200, true],
    [P.collaborator!, ORG_A, 403, false],
    [P.orgOwner!, ORG_B, 200, true],
    [P.orgMember!, ORG_B, 403, false],
    [P.orgPendingAdmin!, ORG_B, 403, false],
    [P.orgAdminElsewhere!, ORG_B, 403, false],
    [P.orgNoMembersPerm!, ORG_B, 403, false],
    [P.outsider!, ORG_A, 404, false],
    [P.orgOwner!, ORG_A, 404, false],
    [P.owner!, ORG_C, 404, false],
  ];
  for (const [p, org, status, wrote] of rows) {
    const got = await patchSettings(p, org);
    console.log(`       ${p.name} -> org ${org.slice(-1)}: ${JSON.stringify(got)}`);
    assertEq([got.status, got.wrote], [status, wrote], `${p.name}, org ${org.slice(-1)}: status ${status}, settings ${wrote ? "written" : "untouched"}`);
  }
}

async function testBillingRoutes(): Promise<void> {
  section("B. POST /api/billing/portal (cancel) and /api/billing/checkout");
  const rows: Array<[Persona, string, number]> = [
    [P.owner!, ORG_A, 200],
    [P.collaborator!, ORG_A, 403],
    [P.orgOwner!, ORG_B, 200],
    [P.orgMember!, ORG_B, 403],
    [P.outsider!, ORG_A, 404],
    [P.orgOwner!, ORG_A, 404],
  ];
  for (const [p, org, status] of rows) {
    const pr = await portal(p, org);
    console.log(`       portal   ${p.name} -> org ${org.slice(-1)}: ${JSON.stringify(pr)}`);
    assertEq([pr.status, pr.paddle], [status, status === 200], `portal: ${p.name}, org ${org.slice(-1)}: status ${status}, Paddle ${status === 200 ? "called" : "not called"}`);
    const co = await checkout(p, org);
    console.log(`       checkout ${p.name} -> org ${org.slice(-1)}: ${JSON.stringify(co)}`);
    assertEq([co.status, co.paddle], [status, status === 200], `checkout: ${p.name}, org ${org.slice(-1)}: status ${status}, Paddle ${status === 200 ? "called" : "not called"}`);
  }
}

async function testSettingsPage(): Promise<void> {
  section("C. /orgs/:id/settings page");
  const page = load<{ default: (a: unknown) => Promise<unknown> }>("app/orgs/[id]/settings/page").default;
  const cases: Array<[Persona, string, "form" | "no-form" | "404"]> = [
    [P.owner!, ORG_A, "form"],
    [P.collaborator!, ORG_A, "no-form"],
    [P.orgOwner!, ORG_B, "form"],
    [P.orgMember!, ORG_B, "no-form"],
    [P.outsider!, ORG_A, "404"],
    [P.orgOwner!, ORG_A, "404"],
  ];
  for (const [p, org, want] of cases) {
    const tree = await as(p, () => renderPage(page, org));
    const got = tree === "404" ? "404" : has(tree, "\"SettingsForm\"") ? "form" : "no-form";
    const leaks = has(tree, SLACK_SECRET);
    console.log(`       ${p.name} -> org ${org.slice(-1)}: ${got}, slack URL in page: ${leaks}`);
    assertEq([got, leaks], [want, want === "form"], `${p.name}, org ${org.slice(-1)}: ${want}; Slack webhook URL ${want === "form" ? "shown" : "absent"}`);
  }
}

async function testBillingPage(): Promise<void> {
  section("D. /orgs/:id/billing page");
  const page = load<{ default: (a: unknown) => Promise<unknown> }>("app/orgs/[id]/billing/page").default;
  const cases: Array<[Persona, string, "figures" | "none" | "404"]> = [
    [P.owner!, ORG_A, "figures"],
    [P.collaborator!, ORG_A, "none"],
    [P.orgOwner!, ORG_B, "figures"],
    [P.orgMember!, ORG_B, "none"],
    [P.outsider!, ORG_A, "404"],
  ];
  for (const [p, org, want] of cases) {
    const tree = await as(p, () => renderPage(page, org));
    const spend = tree !== "404" && has(tree, SPEND);
    const cap = tree !== "404" && has(tree, CAP);
    const manage = tree !== "404" && has(tree, "\"ManageSubscriptionButtons\"");
    const got = tree === "404" ? "404" : spend || cap || manage ? "figures" : "none";
    console.log(`       ${p.name} -> org ${org.slice(-1)}: spend ${spend}, cap ${cap}, manage buttons ${manage}`);
    assertEq(got, want, `${p.name}, org ${org.slice(-1)}: ${want === "figures" ? "sees spend, cap and subscription controls" : want === "none" ? "sees no spend, cap or subscription control" : "404"}`);
  }
}

async function testHomePage(): Promise<void> {
  section("E. home page: the org list");
  const page = load<{ default: (a: unknown) => Promise<unknown> }>("app/page").default;
  const cases: Array<[Persona, string, boolean]> = [
    [P.owner!, "3101", true],
    [P.collaborator!, "3101", false],
    [P.orgOwner!, "4202", true],
    [P.orgMember!, "4202", false],
  ];
  for (const [p, inst, admin] of cases) {
    emailStamps.length = 0;
    const tree = await as(p, () => renderPage(page, null));
    const listed = has(tree, `installation #`) && has(tree, inst);
    const spend = has(tree, SPEND);
    const stamped = emailStamps.some((ids) => ids.includes(inst));
    console.log(`       ${p.name}: org listed ${listed}, spend shown ${spend}, installer email stamped ${stamped}`);
    assertEq([listed, spend, stamped], [true, admin, admin], `${p.name}: org listed; spend ${admin ? "shown" : "hidden"}; installer email ${admin ? "stamped" : "not stamped"}`);
  }
  const tree = await as(P.outsider!, () => renderPage(page, null));
  const seesA = has(tree, "3101") || has(tree, "4202");
  console.log(`       ${P.outsider!.name}: org A or B in list ${seesA}`);
  assertEq(seesA, false, "outsider: neither org A nor org B is listed");
}

const EXPECTED_SECTIONS = 5;

async function main(): Promise<void> {
  const sections = [testSettingsPatch, testBillingRoutes, testSettingsPage, testBillingPage, testHomePage];
  for (const run of sections) {
    try {
      await run();
    } catch (err) {
      assert(false, `section threw: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    }
  }
  assertEq(unexpected, [], "no request left api.github.com's three expected endpoints");
  assertEq(sectionsRun.length, EXPECTED_SECTIONS, "every section ran");
  assertEq(process.env.ANTHROPIC_API_KEY, undefined, "no Anthropic key in this process");
  console.log(failures === 0 ? "\nOrg-access witness: PASS." : `\nOrg-access witness: ${failures} FAILURE(S).`);
  process.exit(failures > 0 ? 1 : 0);
}

void main();
