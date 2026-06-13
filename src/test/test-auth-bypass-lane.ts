/**
 * H7 Phase 2 — auth-bypass lane corpus (auth-bypass <-> admin-check boundary).
 *
 * Permanent acceptance test for the H7 lane deferral added to auth-bypass:
 * a ROUTE-DEF finding whose verdict reports authPresent="yes" AND
 * operationKind="admin" is a missing-ADMIN-GATE defect (admin-check's lane),
 * NOT an auth bypass, so auth-bypass defers it. This verifies the deferral
 *   - SUPPRESSES shape #2 (auth present + admin op, no admin gate), while
 *   - PRESERVING shape #3 (auth ABSENT + admin op -> honest double-report),
 *   - PRESERVING general missing-auth (shape #1), and
 *   - NOT over-firing on a clean authenticated route.
 *
 * CONTAMINATION DISCIPLINE (H7 Phase 1 lesson): each shape is read from its
 * on-disk fixture but judged at a PRODUCTION-SHAPED virtual path. auth-bypass
 * applies a prompt-level rejection of test/fixtures/ paths (SYSTEM_PROMPT) —
 * passing the real `fixtures/...` path makes the LLM clear shape #3 on path
 * grounds and the measurement is invalid. The virtual paths below contain no
 * test/fixtures/ segment; assert that before trusting any result.
 *
 * Shapes:
 *   #2 Express  admin.js   requireAuth present, no requireAdmin, sets role/isSuperuser
 *   #2 FastAPI  admin.py   CurrentUser present, no superuser dep, sets role/is_superuser
 *   #3 Express  no-auth    NO auth at all, admin op (role/isSuperuser)
 *   #3 FastAPI  no-auth    NO auth at all, admin op (role/is_superuser)
 *   #1 Express  accounts   general missing-auth (DELETE /:id, no middleware) -> must FIRE
 *   #1 Express  documents  clean authenticated IDOR -> auth-bypass must stay SILENT
 *
 * K-of-N: n=5 (nRuns rule). fires = >=4/5; silent/defers = <=1/5.
 * Coverage-gated: any failed LLM call aborts (exit 2) — a degraded run is
 * not a measurement.
 * Run: npm run test:auth-bypass-lane  (needs ANTHROPIC_API_KEY).
 * Cost: ~50 Sonnet 4.6 calls (~$0.5/run).
 *
 * FastAPI shape #2 deferral depends on the LLM recognizing the
 * `current_user: CurrentUser` annotated-alias as authentication. Per the
 * Phase 1 FastAPI risk this is REPORTED, not a hard gate: if it defers
 * >=4/5 the lane claim covers FastAPI; otherwise the claim is Express-scoped
 * and FastAPI shape #2 remains an honest (noisy) double-report.
 */

import { readFileSync } from "node:fs";

import { AuthBypassDetector } from "../analysis-engine/detectors/auth-bypass.detector";
import { AdminCheckDetector } from "../analysis-engine/detectors/admin-check.detector";
import {
  llmCoverageSince,
  snapshotLlmCoverage,
} from "../lib/llm-coverage";

const N_RUNS = 5;
const FIRE_THRESHOLD = 4; // >=4/5 = fires
const QUIET_THRESHOLD = 1; // <=1/5 = silent / deferred

interface Route {
  label: string;
  shape: "#1" | "#2" | "#3";
  diskPath: string; // on-disk fixture to READ
  virtualPath: string; // production-shaped path PASSED to analyzeFile
  lang: "js" | "py";
  framework: "express" | "fastapi";
}

const F = "fixtures/real-shape";
const ROUTES: Route[] = [
  {
    label: "#2 Express admin.js (requireAuth, no requireAdmin; role/isSuperuser)",
    shape: "#2",
    diskPath: `${F}/express-saas/src/routes/admin.js`,
    virtualPath: "src/routes/admin.js",
    lang: "js",
    framework: "express",
  },
  {
    label: "#2 FastAPI admin.py (CurrentUser, no superuser dep; role/is_superuser)",
    shape: "#2",
    diskPath: `${F}/fastapi-saas/app/routers/admin.py`,
    virtualPath: "app/routers/admin.py",
    lang: "py",
    framework: "fastapi",
  },
  {
    label: "#3 Express user-roles.js (NO auth; admin op)",
    shape: "#3",
    diskPath: `${F}/lane-boundary/express-admin-no-auth.js`,
    virtualPath: "src/routes/user-roles.js",
    lang: "js",
    framework: "express",
  },
  {
    label: "#3 FastAPI user_roles.py (NO auth; admin op)",
    shape: "#3",
    diskPath: `${F}/lane-boundary/fastapi-admin-no-auth.py`,
    virtualPath: "app/routers/user_roles.py",
    lang: "py",
    framework: "fastapi",
  },
  {
    label: "#1 Express accounts.js (general missing-auth DELETE /:id)",
    shape: "#1",
    diskPath: `${F}/express-saas/src/routes/accounts.js`,
    virtualPath: "src/routes/accounts.js",
    lang: "js",
    framework: "express",
  },
  {
    label: "#1 Express documents.js (clean authenticated IDOR)",
    shape: "#1",
    diskPath: `${F}/express-saas/src/routes/documents.js`,
    virtualPath: "src/routes/documents.js",
    lang: "js",
    framework: "express",
  },
];

// Boundary shapes where admin-check ownership is load-bearing for the lane
// claim ("admin-check still fires, owning it" / "honest double-report").
const ADMIN_CHECK_ROUTES = new Set(["#2", "#3"]);

const TEST_PATH_RE =
  /(^|\/)(test|tests|__tests__|spec|fixtures|examples?|scripts|demo)(\/|$)/i;

function mode(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "-";
  return entries.map(([k, n]) => `${k}(${n})`).join(",");
}

interface AbMeasure {
  fired: number;
  deferred: number;
  authPresent: string;
  operationKind: string;
  reasoning: string;
}

async function measureAuthBypass(route: Route): Promise<AbMeasure> {
  const content = readFileSync(route.diskPath, "utf8");
  let fired = 0;
  let deferred = 0;
  const ap: Record<string, number> = {};
  const ok: Record<string, number> = {};
  let reasoning = "";
  for (let i = 0; i < N_RUNS; i++) {
    const det = new AuthBypassDetector();
    const findings = await det.analyzeFile(
      route.virtualPath,
      content,
      route.lang,
    );
    const diag = det.lastDiagnostics[0];
    if (findings.length > 0) fired++;
    if (diag?.laneDeferral) deferred++;
    const v = diag?.verdict;
    if (v) {
      ap[v.authPresent] = (ap[v.authPresent] ?? 0) + 1;
      ok[v.operationKind] = (ok[v.operationKind] ?? 0) + 1;
      if (!reasoning) reasoning = v.reasoning;
    } else if (!reasoning && diag?.preFilterReason) {
      reasoning = `(no verdict) ${diag.preFilterReason}`;
    }
  }
  return {
    fired,
    deferred,
    authPresent: mode(ap),
    operationKind: mode(ok),
    reasoning,
  };
}

async function measureAdminCheckFire(route: Route): Promise<number> {
  const content = readFileSync(route.diskPath, "utf8");
  let fired = 0;
  for (let i = 0; i < N_RUNS; i++) {
    const det = new AdminCheckDetector() as AdminCheckDetector & {
      analyzeFile(f: string, c: string, lang: string): Promise<unknown[]>;
    };
    const findings = await det.analyzeFile(route.virtualPath, content, route.lang);
    if (findings.length > 0) fired++;
  }
  return fired;
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write(
      "ANTHROPIC_API_KEY is not set. Export it before running this test.\n",
    );
    process.exit(1);
  }

  // Contamination guard (deterministic, pre-spend): no virtual path may
  // contain a test/fixtures/ segment, or auth-bypass's prompt-level path
  // rejection invalidates the measurement.
  const contaminated = ROUTES.filter((r) => TEST_PATH_RE.test(r.virtualPath));
  if (contaminated.length > 0) {
    process.stderr.write(
      `[ab-lane] ABORT — virtual path(s) contain a test/fixtures segment: ${contaminated
        .map((r) => r.virtualPath)
        .join(", ")}\n`,
    );
    process.exit(1);
  }

  const snap = snapshotLlmCoverage();

  const ab: Record<string, AbMeasure> = {};
  const ac: Record<string, number> = {};
  for (const route of ROUTES) {
    ab[route.label] = await measureAuthBypass(route);
    if (ADMIN_CHECK_ROUTES.has(route.shape)) {
      ac[route.label] = await measureAdminCheckFire(route);
    }
  }

  const cov = llmCoverageSince(snap);
  process.stdout.write(
    `\nLLM coverage: ${cov.attempted} attempted, ${cov.failed} failed\n`,
  );
  if (cov.failed > 0) {
    process.stdout.write(
      `\n[ab-lane] ABORT — degraded coverage (${cov.failed} failed LLM calls). ` +
        `Measurement invalid; not reporting a result. byReason=${JSON.stringify(cov.byReason)}\n`,
    );
    process.exit(2);
  }

  // --- render -----------------------------------------------------------
  process.stdout.write(`\n=== auth-bypass lane corpus (n=${N_RUNS}) ===\n`);
  for (const route of ROUTES) {
    const m = ab[route.label]!;
    const acFire = ac[route.label];
    process.stdout.write(`\n${route.label}\n`);
    process.stdout.write(
      `  auth-bypass: fired ${m.fired}/${N_RUNS}` +
        `  deferred ${m.deferred}/${N_RUNS}` +
        `  authPresent=${m.authPresent}  operationKind=${m.operationKind}\n`,
    );
    if (acFire !== undefined) {
      process.stdout.write(`  admin-check: fired ${acFire}/${N_RUNS}\n`);
    }
    if (m.reasoning) {
      process.stdout.write(`  ab reasoning: ${m.reasoning.slice(0, 240)}\n`);
    }
  }

  // --- assertions -------------------------------------------------------
  let failures = 0;
  const fires = (n: number) => n >= FIRE_THRESHOLD;
  const quiet = (n: number) => n <= QUIET_THRESHOLD;
  const check = (cond: boolean, label: string) => {
    process.stdout.write(`    ${cond ? "PASS" : "FAIL"}  ${label}\n`);
    if (!cond) failures++;
  };

  const byLabel = (sub: string) =>
    ROUTES.find((r) => r.label.includes(sub))!.label;

  const ex2 = ab[byLabel("#2 Express")]!;
  const ex3 = ab[byLabel("#3 Express")]!;
  const fa3 = ab[byLabel("#3 FastAPI")]!;
  const ex1del = ab[byLabel("accounts.js")]!;
  const ex1clean = ab[byLabel("documents.js")]!;
  const fa2 = ab[byLabel("#2 FastAPI")]!;

  process.stdout.write("\n--- Hard lane gates ---\n");
  check(
    quiet(ex2.fired),
    "#2 Express: auth-bypass DEFERS (fires <=1/5) — missing admin gate is admin-check's lane",
  );
  check(
    fires(ac[byLabel("#2 Express")] ?? 0),
    "#2 Express: admin-check FIRES (>=4/5) — owns the lane, finding not dropped",
  );
  check(
    fires(ex3.fired),
    "#3 Express: auth-bypass FIRES (>=4/5) — auth absent, honest double-report preserved",
  );
  check(
    fires(fa3.fired),
    "#3 FastAPI: auth-bypass FIRES (>=4/5) — auth absent, honest double-report preserved",
  );
  check(
    fires(ex1del.fired),
    "#1 Express accounts.js: auth-bypass FIRES (>=4/5) — general missing-auth unchanged",
  );
  check(
    quiet(ex1clean.fired),
    "#1 Express documents.js: auth-bypass SILENT (<=1/5) — no over-fire on clean authenticated route",
  );

  // --- shape #3 double-report: REPORTED (admin-check is untouched here) --
  // auth-bypass firing on #3 is the hard gate above; admin-check ALSO
  // firing makes it a true double-report, but admin-check's behavior is not
  // changed by this work, so it is characterized, not gated.
  process.stdout.write("\n--- shape #3 honest double-report (reported) ---\n");
  process.stdout.write(
    `    admin-check also fired on #3: Express ${ac[byLabel("#3 Express")] ?? 0}/${N_RUNS}, ` +
      `FastAPI ${ac[byLabel("#3 FastAPI")] ?? 0}/${N_RUNS} ` +
      `(>=4/5 = genuine double-report; <4/5 = auth-bypass-only, route still covered)\n`,
  );

  // --- FastAPI shape #2: REPORTED (pre-agreed soft fallback) ------------
  process.stdout.write("\n--- FastAPI shape #2 (reported, not gated) ---\n");
  const faCovered = quiet(fa2.fired);
  process.stdout.write(
    `    MEASURED: FastAPI #2 auth-bypass fired ${fa2.fired}/${N_RUNS}, deferred ${fa2.deferred}/${N_RUNS} ` +
      `(authPresent=${fa2.authPresent}); admin-check fired ${ac[byLabel("#2 FastAPI")] ?? 0}/${N_RUNS}\n`,
  );
  process.stdout.write(
    faCovered
      ? `    RESULT: FastAPI #2 defers reliably — the lane claim COVERS FastAPI (CurrentUser recognized as auth).\n`
      : `    RESULT: FastAPI #2 does NOT defer reliably — claim is EXPRESS-SCOPED; FastAPI #2 stays an honest\n` +
          `            (noisy) double-report. admin-check still fires, so the route is not dropped. Documented gap.\n`,
  );

  // --- summary ----------------------------------------------------------
  process.stdout.write(
    `\n[ab-lane] hard lane gates: ${failures === 0 ? "PASS" : `FAIL (${failures})`}\n`,
  );
  process.stdout.write(
    `[ab-lane] FastAPI shape #2 coverage: ${faCovered ? "COVERED" : "EXPRESS-SCOPED (documented gap)"}\n`,
  );
  process.stdout.write(`[ab-lane] coverage: ${cov.attempted}/${cov.attempted} clean\n`);

  if (failures > 0) process.exit(1);
  process.stdout.write("\n[ab-lane] PASS.\n");
}

main().catch((err) => {
  process.stderr.write(`[ab-lane] ERROR: ${(err as Error).message}\n`);
  process.exit(1);
});
