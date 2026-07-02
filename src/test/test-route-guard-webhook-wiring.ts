/**
 * F-001 regression guard — deterministic, NO LLM spend (belongs in test:ci).
 *
 * The bug: the Phase-G parent-layout route-guard sidecar is wired on Engine
 * A (cli/scan.ts) but NOT on the Engine B webhook path
 * (auditor-workflow.ts), so a layout-gated Remix/RR-v7 read route that
 * Engine A clears is a HIGH false positive on the shipped product
 * (measured 6/6 in Phase 3D).
 *
 * This test locks the fix at two seams, without any model call:
 *
 *   Part 1 — resolveRouteGuardSidecars (webhook resolver): given an async
 *     fetchFile over the committed neutral fixture, it must build a PROVEN
 *     route-guard sidecar; a genuine 404 layout is silently absent; a
 *     non-404 fetch failure fails loud as a scanInputError.
 *
 *   Part 2 — runAuditorWorkflow forwarding: the workflow must pass a
 *     payload's `sidecarsByPath` through to each detector's detect(ctx).
 *     BEFORE the fix (detect({diff}) only) this part is RED; after wiring
 *     the sidecar at auditor-workflow.ts it is GREEN. Detectors are stubbed
 *     so this asserts pure plumbing with zero LLM cost.
 *
 * Run: npm run test:route-guard-webhook
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  resolveRouteGuardSidecars,
} from "../integrations/github/whole-file-scan-input";
import { buildSyntheticDiff } from "../cli/diff-builder";
import { runAuditorWorkflow } from "../workflows/auditor-workflow";
import { DETECTORS } from "../analysis-engine/detectors/registry";
import { SIDECAR_KINDS } from "../analysis-engine/sidecar-kinds";
import type {
  DetectorContext,
  NormalizedFinding,
} from "../analysis-engine/detector.types";

const FIXTURE_ROOT = join(
  __dirname,
  "..",
  "..",
  "fixtures",
  "f001-layout-guard",
);
const ROUTE = "app/routes/dashboard+/billing.tsx";
const LAYOUT = "app/routes/dashboard+/_layout.tsx";

/** Error shaped like the GitHubApiError the real fetch layer throws. */
function httpError(status: number): Error {
  const e = new Error(`GitHub API ${status}`) as Error & {
    details: { status: number };
  };
  e.details = { status };
  return e;
}

/** fetchFile that serves the committed fixture files and 404s otherwise. */
function fixtureFetch(present: Set<string>): (p: string) => Promise<string> {
  return async (p: string) => {
    if (present.has(p)) {
      return readFileSync(join(FIXTURE_ROOT, p), "utf8");
    }
    throw httpError(404);
  };
}

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  process.stdout.write(`  [${ok ? "PASS" : "FAIL"}] ${name}\n`);
  if (!ok) {
    failures++;
    if (detail) process.stdout.write(`        ${detail}\n`);
  }
}

async function part1(): Promise<void> {
  process.stdout.write("Part 1 — resolveRouteGuardSidecars (webhook resolver):\n");

  // A. Neutral fixture: PROVEN blocking ancestor layout present.
  {
    const { sidecarsByPath, routeGuardErrors } = await resolveRouteGuardSidecars(
      [ROUTE],
      fixtureFetch(new Set([ROUTE, LAYOUT])),
    );
    const guard = sidecarsByPath[ROUTE]?.[SIDECAR_KINDS.ROUTE_GUARD];
    check(
      "A: layout-gated route resolves a PROVEN route-guard sidecar",
      !!guard && guard.includes("PROVEN") && !guard.includes("UNVERIFIED"),
      `got: ${guard ? JSON.stringify(guard.slice(0, 120)) : "no sidecar"}`,
    );
    check("A: no routeGuardErrors on clean resolution", routeGuardErrors.length === 0);
  }

  // B. No ancestor layout at all -> every candidate 404s -> absent, silent.
  {
    const { sidecarsByPath, routeGuardErrors } = await resolveRouteGuardSidecars(
      [ROUTE],
      fixtureFetch(new Set([ROUTE])), // layout NOT present
    );
    check(
      "B: absent layout (404) yields no sidecar and no error (silent)",
      !sidecarsByPath[ROUTE] && routeGuardErrors.length === 0,
    );
  }

  // C. Layout fetch fails non-404 (e.g. 500) -> FAIL LOUD, attributed to the
  //    ROUTE being judged (not just the layout candidate path).
  {
    const fetch500 = async (p: string) => {
      if (p === ROUTE) return readFileSync(join(FIXTURE_ROOT, ROUTE), "utf8");
      throw httpError(500);
    };
    const { sidecarsByPath, routeGuardErrors } = await resolveRouteGuardSidecars(
      [ROUTE],
      fetch500,
    );
    check(
      "C: non-404 layout fetch failure fails loud, attributed to the route",
      routeGuardErrors.length > 0 &&
        routeGuardErrors.some(
          (e) => e.route === ROUTE && /route-guard layout fetch failed/.test(e.reason),
        ),
      `errors: ${JSON.stringify(routeGuardErrors)}`,
    );
    check(
      "C: degraded resolution emits no (spurious PROVEN) sidecar",
      !sidecarsByPath[ROUTE],
    );
  }

  // D. Non-/routes/ path (App Router / API) -> zero fetches, nothing.
  {
    let fetched = 0;
    const spyFetch = async (_p: string) => {
      fetched++;
      throw httpError(404);
    };
    const { sidecarsByPath, routeGuardErrors } = await resolveRouteGuardSidecars(
      ["app/api/orders/[id]/route.ts"],
      spyFetch,
    );
    check(
      "D: non-/routes/ path does no fetches and yields nothing",
      fetched === 0 &&
        Object.keys(sidecarsByPath).length === 0 &&
        routeGuardErrors.length === 0,
      `fetched=${fetched}`,
    );
  }
}

async function part2(): Promise<void> {
  process.stdout.write(
    "Part 2 — runAuditorWorkflow forwards payload.sidecarsByPath to detect(ctx):\n",
  );

  const captured: Array<DetectorContext["sidecarsByPath"]> = [];
  const originals = DETECTORS.map((d) => d.detect);
  for (const d of DETECTORS) {
    // Spy: record the ctx the workflow hands us; do no work, spend nothing.
    (d as { detect?: (ctx: DetectorContext) => Promise<NormalizedFinding[]> }).detect =
      async (ctx: DetectorContext) => {
        captured.push(ctx.sidecarsByPath);
        return [];
      };
  }

  const expected = { [ROUTE]: { [SIDECAR_KINDS.ROUTE_GUARD]: "PROVEN test guard body" } };
  try {
    const routeContent = readFileSync(join(FIXTURE_ROOT, ROUTE), "utf8");
    const payload = {
      diff: buildSyntheticDiff(ROUTE, routeContent),
      sidecarsByPath: expected,
    };
    await runAuditorWorkflow(payload, { scanId: "f001-wiring" });
  } finally {
    for (let i = 0; i < DETECTORS.length; i++) {
      (DETECTORS[i] as { detect?: unknown }).detect = originals[i];
    }
  }

  const forwarded = captured.some(
    (s) => JSON.stringify(s) === JSON.stringify(expected),
  );
  check(
    "the workflow forwards sidecarsByPath into detect(ctx) (RED before the fix)",
    forwarded,
    `captured: ${JSON.stringify(captured)}`,
  );
}

async function part3(): Promise<void> {
  process.stdout.write(
    "Part 3 — a guard-fetch failure surfaces a precise, route-named WorkflowError:\n",
  );

  // Stub detectors (no LLM); feed a payload carrying ONLY a routeGuardError.
  const result = await (async () => {
    const originals = DETECTORS.map((d) => d.detect);
    for (const d of DETECTORS) {
      (d as { detect?: (ctx: DetectorContext) => Promise<NormalizedFinding[]> }).detect =
        async () => [];
    }
    try {
      const routeContent = readFileSync(join(FIXTURE_ROOT, ROUTE), "utf8");
      return await runAuditorWorkflow(
        {
          diff: buildSyntheticDiff(ROUTE, routeContent),
          routeGuardErrors: [
            {
              route: ROUTE,
              layout: "app/routes/_layout.tsx",
              reason: "route-guard layout fetch failed: GitHub API 500",
            },
          ],
        },
        { scanId: "f001-guard-err" },
      );
    } finally {
      for (let i = 0; i < DETECTORS.length; i++) {
        (DETECTORS[i] as { detect?: unknown }).detect = originals[i];
      }
    }
  })();

  const messages = (result.errors ?? []).map((e) => e.message);
  check(
    "operator message names the route and points at layout resolution",
    messages.some(
      (m) =>
        m.includes(ROUTE) &&
        /parent-layout auth guard could not be resolved/.test(m),
    ),
    `errors: ${JSON.stringify(messages)}`,
  );
  check(
    "guard failure does NOT reuse the H2 'whole-file context' wording",
    !messages.some((m) => /judged without whole-file context/.test(m)),
  );
  check(
    "guard failure forces the run off a clean status (fail-loud preserved)",
    result.status !== "no_action" && result.status !== "success",
    `status=${result.status}`,
  );
}

async function main(): Promise<void> {
  await part1();
  await part2();
  await part3();
  process.stdout.write(
    `\nF-001 webhook wiring test: ${failures === 0 ? "PASS" : `FAIL (${failures})`}\n`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  process.stderr.write(`ERROR: ${e && e.stack ? e.stack : String(e)}\n`);
  process.exit(1);
});
