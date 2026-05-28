/**
 * Deterministic unit test for the Phase G route-guard resolver.
 *
 * Validates the fence-2 structural coverage proof WITHOUT any LLM spend:
 *   - unbroken +-folder nesting  -> PROVEN
 *   - non-+ folder in the chain  -> UNVERIFIED above the break
 *   - trailing-underscore opt-out -> UNVERIFIED above the break
 *   - route-filename opt-out      -> same-dir layout UNVERIFIED
 *   - sibling / no ancestor layout -> no guard (null)
 *   - non-/routes/ path            -> null (App Router / utility files)
 *
 * The asymmetric default is the whole safety of the slice: we may only
 * SUPPRESS on PROVEN coverage. If this test regresses, the suppression
 * could start hiding real findings. Run: npm run test:route-guard-resolver
 */

import {
  resolveRemixRouteGuard,
  type GuardFs,
} from "../analysis-engine/detectors/shared/route-guard-resolver";

const AUTH_LAYOUT = `
import { getOptionalSession } from '@documenso/auth/server/lib/utils/get-session';
import { redirect } from 'react-router';
export async function loader({ request }) {
  const session = await getOptionalSession(request);
  if (!session.isAuthenticated) {
    throw redirect('/signin');
  }
  return { ok: true };
}
`;

const ADMIN_LAYOUT = `
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
`;

function makeFs(files: Record<string, string>): GuardFs {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(files)) map.set(norm(k), v);
  return {
    exists: (p) => map.has(norm(p)),
    read: (p) => map.get(norm(p)) ?? null,
  };
}

interface Case {
  name: string;
  route: string;
  files: Record<string, string>;
  expect: (out: string | null) => boolean;
  describe: string;
}

const ROOT = "C:/repo/apps/remix/app/routes";

const cases: Case[] = [
  {
    name: "nested-+folders-proven",
    route: `${ROOT}/_authenticated+/admin+/stats.tsx`,
    files: {
      [`${ROOT}/_authenticated+/_layout.tsx`]: AUTH_LAYOUT,
      [`${ROOT}/_authenticated+/admin+/_layout.tsx`]: ADMIN_LAYOUT,
    },
    expect: (o) =>
      o !== null &&
      (o.match(/PROVEN/g) ?? []).length === 2 &&
      !o.includes("UNVERIFIED"),
    describe: "both ancestor layouts PROVEN via unbroken +-folder chain",
  },
  {
    name: "non-plus-folder-breaks-above",
    route: `${ROOT}/_authenticated+/plain/baz.tsx`,
    files: {
      [`${ROOT}/_authenticated+/_layout.tsx`]: AUTH_LAYOUT,
    },
    expect: (o) => o === null,
    describe:
      "non-+ folder 'plain' breaks nesting -> coverage UNVERIFIED -> no clearing guard (null)",
  },
  {
    name: "trailing-underscore-optout-breaks-above",
    route: `${ROOT}/_authenticated+/billing_+/invoice.tsx`,
    files: {
      [`${ROOT}/_authenticated+/_layout.tsx`]: AUTH_LAYOUT,
    },
    expect: (o) => o === null,
    describe:
      "billing_+ trailing-underscore opt-out -> UNVERIFIED -> no clearing guard (null)",
  },
  {
    name: "route-filename-optout-same-dir-unverified",
    route: `${ROOT}/_authenticated+/thing_.tsx`,
    files: {
      [`${ROOT}/_authenticated+/_layout.tsx`]: AUTH_LAYOUT,
    },
    expect: (o) => o === null,
    describe:
      "route 'thing_' opts out of its own dir layout -> UNVERIFIED -> no clearing guard (null)",
  },
  {
    name: "no-ancestor-layout-null",
    route: `${ROOT}/orphan+/danger.tsx`,
    files: {},
    expect: (o) => o === null,
    describe: "no ancestor _layout anywhere -> no guard (null)",
  },
  {
    name: "non-routes-path-null",
    route: "C:/repo/apps/remix/app/lib/loader-factory.ts",
    files: {
      "C:/repo/apps/remix/app/_layout.tsx": AUTH_LAYOUT,
    },
    expect: (o) => o === null,
    describe: "file not under /routes/ -> null (not a Remix route)",
  },
  {
    name: "same-dir-proven",
    route: `${ROOT}/_authenticated+/dashboard.tsx`,
    files: {
      [`${ROOT}/_authenticated+/_layout.tsx`]: AUTH_LAYOUT,
    },
    expect: (o) => o !== null && o.includes("PROVEN") && !o.includes("UNVERIFIED"),
    describe: "route directly in _authenticated+ -> same-dir layout PROVEN",
  },
];

function main(): void {
  let failures = 0;
  for (const c of cases) {
    const fs = makeFs(c.files);
    const out = resolveRemixRouteGuard(c.route, fs);
    const ok = c.expect(out);
    process.stdout.write(
      `  [${ok ? "PASS" : "FAIL"}] ${c.name}: ${c.describe}\n`,
    );
    if (!ok) {
      failures++;
      process.stdout.write(
        `        got: ${out === null ? "null" : JSON.stringify(out.slice(0, 200))}\n`,
      );
    }
  }
  process.stdout.write(
    `\nResolver unit test: ${cases.length - failures}/${cases.length} passed\n`,
  );
  if (failures > 0) {
    process.stdout.write("FAIL: resolver coverage-proof regressed.\n");
    process.exit(1);
  }
  process.stdout.write("PASS.\n");
}

main();
