/**
 * LLM adversarial + suppression test for the Phase G layout-auth slice.
 *
 * Gates fence #1 (same-bar-different-file: block-on-failure, admin-bar-for-
 * admin), fence #2 (asymmetric default: UNVERIFIED caps at medium, never
 * suppress) and the loader-vs-action soundness refinement. Pairs with the
 * deterministic test-route-guard-resolver (coverage proof) which needs no
 * LLM. Run: npm run test:layout-guard  (~$0.06 Anthropic spend).
 *
 * The fence is "never suppress a real finding to safe", so the gate is
 * CLEARED-vs-FLAGGED, not a severity assertion (admin-data READS rate
 * medium in this detector's baseline; a parent-loader-ungated destructive
 * ACTION rates high). Verdict expectations:
 *   CLEARED      = isVulnerable=false OR confidence=low (route deemed safe).
 *                  Only legitimate on a PROVEN, blocking, covering guard.
 *   FLAGGED      = isVulnerable=true at medium OR high (not suppressed to
 *                  safe; medium goes to the review queue).
 *   FLAGGED_HIGH = isVulnerable=true at high (customer-facing finding).
 */

import { AuthBypassDetector } from "../analysis-engine/detectors/auth-bypass.detector";
import { AdminCheckDetector } from "../analysis-engine/detectors/admin-check.detector";
import { SIDECAR_KINDS } from "../analysis-engine/sidecar-kinds";

const PROVEN_AUTH_GUARD = `Resolved from ancestor layout route(s) on the file system. A guard gates this route ONLY if its loader performs an auth/admin check AND blocks on failure (throw redirect / 401 / 403). A loader that merely reads the session without blocking is NOT a gate.

Guard 1: app/routes/_authenticated+/_layout.tsx
Structural coverage of this route: PROVEN (unbroken +-folder nesting; this layout's loader runs for this route on read requests)
Guard type: parent layout \`loader\` (Remix/RR v7). Gates read/GET (loader) access only; does NOT gate this route's \`action\` mutations.
Layout loader excerpt:
\`\`\`ts
import { getOptionalSession } from '@documenso/auth/server/lib/utils/get-session';
import { redirect } from 'react-router';
export async function loader({ request }) {
  const session = await getOptionalSession(request);
  if (!session.isAuthenticated) {
    throw redirect('/signin');
  }
  return { ok: true };
}
\`\`\``;

const PROVEN_ADMIN_GUARD = `Resolved from ancestor layout route(s) on the file system. A guard gates this route ONLY if its loader performs an auth/admin check AND blocks on failure (throw redirect / 401 / 403). A loader that merely reads the session without blocking is NOT a gate.

Guard 1: app/routes/_authenticated+/admin+/_layout.tsx
Structural coverage of this route: PROVEN (unbroken +-folder nesting; this layout's loader runs for this route on read requests)
Guard type: parent layout \`loader\` (Remix/RR v7). Gates read/GET (loader) access only; does NOT gate this route's \`action\` mutations.
Layout loader excerpt:
\`\`\`ts
import { getSession } from '@documenso/auth/server/lib/utils/get-session';
import { isAdmin } from '@documenso/lib/utils/is-admin';
import { redirect } from 'react-router';
export async function loader({ request }) {
  const { user } = await getSession(request);
  if (!user || !isAdmin(user)) {
    throw redirect('/');
  }
  return { ok: true };
}
\`\`\``;

// PROVEN coverage, but the layout only enforces AUTHENTICATION (not admin).
const PROVEN_AUTH_ONLY_GUARD = PROVEN_AUTH_GUARD;

// PROVEN coverage, but the loader reads the session and never blocks.
const NONBLOCKING_ADMIN_GUARD = `Resolved from ancestor layout route(s) on the file system. A guard gates this route ONLY if its loader performs an auth/admin check AND blocks on failure (throw redirect / 401 / 403). A loader that merely reads the session without blocking is NOT a gate.

Guard 1: app/routes/_authenticated+/admin+/_layout.tsx
Structural coverage of this route: PROVEN (unbroken +-folder nesting; this layout's loader runs for this route on read requests)
Guard type: parent layout \`loader\` (Remix/RR v7). Gates read/GET (loader) access only; does NOT gate this route's \`action\` mutations.
Layout loader excerpt:
\`\`\`ts
import { getSession } from '@documenso/auth/server/lib/utils/get-session';
export async function loader({ request }) {
  const { user } = await getSession(request);
  return { user };
}
\`\`\``;

const ADMIN_READ_LOADER = `import { getUsersCount } from '@documenso/lib/server-only/admin/get-users-stats';
import { getDocumentStats } from '@documenso/lib/server-only/admin/get-documents-stats';
import type { Route } from './+types/stats';

export async function loader() {
  const [usersCount, docStats] = await Promise.all([
    getUsersCount(),
    getDocumentStats(),
  ]);
  return { usersCount, docStats };
}`;

const USER_BROAD_READ_LOADER = `import { getAllOrganisationMembers } from '@documenso/lib/server-only/organisation/get-members';
import type { Route } from './+types/members._index';

export async function loader() {
  const members = await getAllOrganisationMembers();
  return { members };
}`;

const DESTRUCTIVE_ACTION = `import { deleteTeam } from '@documenso/lib/server-only/team/delete-team';
import type { Route } from './+types/delete';

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const teamId = Number(form.get('teamId'));
  await deleteTeam({ teamId });
  return { success: true };
}`;

type Expect = "CLEARED" | "FLAGGED" | "FLAGGED_HIGH";

interface Case {
  name: string;
  detector: "auth-bypass" | "admin-check";
  assumedPath: string;
  content: string;
  guard?: string;
  expect: Expect;
  why: string;
}

const CASES: Case[] = [
  {
    name: "ac-suppress-admin-guarded",
    detector: "admin-check",
    assumedPath: "app/routes/_authenticated+/admin+/stats.tsx",
    content: ADMIN_READ_LOADER,
    guard: PROVEN_ADMIN_GUARD,
    expect: "CLEARED",
    why: "admin read with no in-file check, gated by PROVEN blocking admin layout -> false positive, suppress",
  },
  {
    name: "ac-flag-auth-only-layout",
    detector: "admin-check",
    assumedPath: "app/routes/_authenticated+/admin+/users._index.tsx",
    content: ADMIN_READ_LOADER,
    guard: PROVEN_AUTH_ONLY_GUARD,
    expect: "FLAGGED",
    why: "layout only authenticates (not admin); admin authorization still missing -> must not be cleared",
  },
  {
    name: "ac-flag-nonblocking-layout",
    detector: "admin-check",
    assumedPath: "app/routes/_authenticated+/admin+/teams.$id.tsx",
    content: ADMIN_READ_LOADER,
    guard: NONBLOCKING_ADMIN_GUARD,
    expect: "FLAGGED",
    why: "layout reads session but never blocks -> not a real gate -> must not be cleared",
  },
  {
    name: "ac-flag-uncovered",
    detector: "admin-check",
    assumedPath: "app/routes/_authenticated+/admin+/organisations.$id.tsx",
    content: ADMIN_READ_LOADER,
    expect: "FLAGGED",
    why: "no parent guard resolved -> admin read unguarded -> must not be cleared",
  },
  {
    name: "ab-suppress-auth-guarded",
    detector: "auth-bypass",
    assumedPath: "app/routes/_authenticated+/settings+/members._index.tsx",
    content: USER_BROAD_READ_LOADER,
    guard: PROVEN_AUTH_GUARD,
    expect: "CLEARED",
    why: "sensitive read with no in-file check, gated by PROVEN blocking auth layout -> suppress",
  },
  {
    name: "ab-flag-action-not-gated-by-loader",
    detector: "auth-bypass",
    assumedPath: "app/routes/_authenticated+/t.$teamUrl+/delete.tsx",
    content: DESTRUCTIVE_ACTION,
    guard: PROVEN_AUTH_GUARD,
    expect: "FLAGGED_HIGH",
    why: "destructive action; parent layout LOADER does not gate actions -> must flag HIGH",
  },
];

function langFor(p: string): "ts" | "tsx" {
  return p.endsWith(".tsx") ? "tsx" : "ts";
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write("ANTHROPIC_API_KEY is not set.\n");
    process.exit(1);
  }
  let failures = 0;
  for (const c of CASES) {
    const detector =
      c.detector === "auth-bypass"
        ? new AuthBypassDetector()
        : new AdminCheckDetector();
    const sidecars = c.guard
      ? { [SIDECAR_KINDS.ROUTE_GUARD]: c.guard }
      : undefined;
    const findings = await detector.analyzeFile(
      c.assumedPath,
      c.content,
      langFor(c.assumedPath),
      sidecars,
    );
    const verdict = detector.lastDiagnostics[0]?.verdict ?? null;
    void findings;

    let got: Expect | "OTHER";
    if (verdict?.isVulnerable && verdict.confidence === "high")
      got = "FLAGGED_HIGH";
    else if (verdict?.isVulnerable && verdict.confidence === "medium")
      got = "FLAGGED";
    else if (verdict && (!verdict.isVulnerable || verdict.confidence === "low"))
      got = "CLEARED";
    else got = "OTHER";

    const ok =
      c.expect === "FLAGGED"
        ? got === "FLAGGED" || got === "FLAGGED_HIGH"
        : got === c.expect;
    if (!ok) failures++;
    process.stdout.write(
      `  [${ok ? "PASS" : "FAIL"}] ${c.name} (${c.detector}): expected ${c.expect}, got ${got}\n`,
    );
    process.stdout.write(
      `        verdict: ${verdict ? JSON.stringify(verdict) : "null"}\n`,
    );
    if (!ok) process.stdout.write(`        why-expected: ${c.why}\n`);
    await new Promise((r) => setTimeout(r, 800));
  }
  process.stdout.write(
    `\nLayout-guard adversarial test: ${CASES.length - failures}/${CASES.length} passed\n`,
  );
  if (failures > 0) {
    process.stdout.write(
      "FAIL: layout-guard suppression/adversarial gate did not hold.\n",
    );
    process.exit(1);
  }
  process.stdout.write("PASS.\n");
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
