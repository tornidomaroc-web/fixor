/**
 * Express/JS lane-boundary measurement (real-shape express-saas corpus).
 *
 * H4 (Phase H Tier 1). The IDOR lane facts (callerAuth / operationClass +
 * deterministic routing) were validated on FastAPI only. This test
 * MEASURES, on a middleware framework (Express), (a) whether idor's lane
 * facts behave the way they do on FastAPI, and (b) whether auth-bypass,
 * admin-check, and idor cross-fire on the same JS routes.
 *
 * It changes NO detection logic — it runs the three real detectors over
 * the corpus and records which fire on each route. Each route module has
 * exactly one idor source/sink pair so the one-finding ceiling (G3)
 * cannot confound the reading.
 *
 * Hypothesis (see express-saas/ground-truth.json): on Express, the
 * unauthenticated destructive route (accounts.js DELETE /:id) will show
 * idor CROSS-FIRE with auth-bypass — because the middleware rule
 * correctly yields callerAuth='unclear' (auth could be mounted
 * elsewhere) so idor does not defer, where FastAPI's in-signature DI let
 * it defer. This test confirms or refutes that.
 *
 * K-of-N: n=5 per the nRuns rule. "Fires" = >=4/5; "silent" = <=1/5.
 *
 * COST: all 3 detectors' prefilters reach the LLM on all 3 routes
 * (permissive prefilters, LLM is the judge), so 3 files x 3 detectors x
 * n=5 = 45 Sonnet 4.6 calls ~= $0.45-0.50 per run. Coverage-gated: any
 * failed LLM call aborts (degraded measurement is not a measurement).
 * Run: npm run test:express-lane  (needs ANTHROPIC_API_KEY).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { IdorDetector } from "../analysis-engine/detectors/idor.detector";
import { AuthBypassDetector } from "../analysis-engine/detectors/auth-bypass.detector";
import { AdminCheckDetector } from "../analysis-engine/detectors/admin-check.detector";
import type { Detector } from "../analysis-engine/detector.types";
import {
  llmCoverageSince,
  snapshotLlmCoverage,
} from "../lib/llm-coverage";

const APP = "fixtures/real-shape/express-saas/src/routes";
const N_RUNS = 5;
const FIRE_THRESHOLD = 4; // >=4/5 = fires
const SILENT_THRESHOLD = 1; // <=1/5 = silent

type DetName = "idor" | "auth-bypass" | "admin-check";
const DETECTORS: { name: DetName; make: () => Detector }[] = [
  { name: "idor", make: () => new IdorDetector() },
  { name: "auth-bypass", make: () => new AuthBypassDetector() },
  { name: "admin-check", make: () => new AdminCheckDetector() },
];

const FILES = ["documents.js", "admin.js", "accounts.js"];

async function fireCount(
  make: () => Detector,
  file: string,
  content: string,
): Promise<number> {
  let fired = 0;
  for (let i = 0; i < N_RUNS; i++) {
    const detector = make() as Detector & {
      analyzeFile(
        f: string,
        c: string,
        lang: string,
      ): Promise<unknown[]>;
    };
    const findings = await detector.analyzeFile(file, content, "js");
    if (findings.length > 0) fired++;
  }
  return fired;
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stdout.write(
      "SKIPPED: ANTHROPIC_API_KEY not set (opt-in live-LLM test). Set the key to run it live.\n",
    );
    return;
  }

  const snap = snapshotLlmCoverage();

  // matrix[file][detector] = fire count out of N_RUNS
  const matrix: Record<string, Record<DetName, number>> = {};
  for (const file of FILES) {
    const content = readFileSync(join(APP, file), "utf8");
    matrix[file] = { idor: 0, "auth-bypass": 0, "admin-check": 0 };
    for (const { name, make } of DETECTORS) {
      matrix[file]![name] = await fireCount(make, file, content);
    }
  }

  const cov = llmCoverageSince(snap);
  process.stdout.write(
    `\nLLM coverage: ${cov.attempted} attempted, ${cov.failed} failed\n`,
  );
  if (cov.failed > 0) {
    process.stdout.write(
      `\n[express-lane] ABORT — degraded coverage (${cov.failed} failed LLM calls). ` +
        `Measurement invalid; not reporting a result. byReason=${JSON.stringify(cov.byReason)}\n`,
    );
    process.exit(2);
  }

  // --- render the fire matrix -------------------------------------
  process.stdout.write("\n=== Express lane fire matrix (fires / " + N_RUNS + ") ===\n");
  process.stdout.write(
    "file".padEnd(16) + "idor".padEnd(8) + "auth-bypass".padEnd(14) + "admin-check\n",
  );
  for (const file of FILES) {
    const m = matrix[file]!;
    process.stdout.write(
      file.padEnd(16) +
        `${m.idor}/${N_RUNS}`.padEnd(8) +
        `${m["auth-bypass"]}/${N_RUNS}`.padEnd(14) +
        `${m["admin-check"]}/${N_RUNS}\n`,
    );
  }

  let failures = 0;
  const fires = (f: string, d: DetName) => matrix[f]![d] >= FIRE_THRESHOLD;
  const silent = (f: string, d: DetName) => matrix[f]![d] <= SILENT_THRESHOLD;
  const check = (cond: boolean, label: string) => {
    process.stdout.write(`    ${cond ? "PASS" : "FAIL"}  ${label}\n`);
    if (!cond) failures++;
  };

  // --- lane-correct controls (the FastAPI envelope's expectations) -
  process.stdout.write("\n--- Lane-correct controls ---\n");
  check(
    fires("documents.js", "idor"),
    "documents.js GET /:id — idor FIRES (authenticated genuine IDOR)",
  );
  check(
    silent("documents.js", "auth-bypass") && silent("documents.js", "admin-check"),
    "documents.js — auth-bypass & admin-check SILENT (no cross-fire on a clean IDOR)",
  );
  check(
    fires("admin.js", "admin-check"),
    "admin.js POST /:id/role — admin-check FIRES (auth-only on admin op)",
  );
  check(
    silent("admin.js", "idor"),
    "admin.js POST /:id/role — idor SILENT (operationClass=administrative → admin-check lane)",
  );
  check(
    fires("accounts.js", "auth-bypass"),
    "accounts.js DELETE /:id — auth-bypass FIRES (missing-middleware, auth lane)",
  );

  // --- Q1: idor cross-fire (the original hypothesis) — REPORTED -----
  process.stdout.write("\n--- Q1: idor cross-fire at the Express middleware boundary ---\n");
  const idorOnAccounts = matrix["accounts.js"]!.idor;
  const idorCrossFire = idorOnAccounts >= FIRE_THRESHOLD;
  process.stdout.write(
    `    MEASURED: idor fired ${idorOnAccounts}/${N_RUNS} on accounts.js DELETE /:id ` +
      `(alongside auth-bypass ${matrix["accounts.js"]!["auth-bypass"]}/${N_RUNS})\n`,
  );
  process.stdout.write(
    idorCrossFire
      ? `    RESULT: idor CROSS-FIRES on the unauthenticated Express route — it did not defer.\n` +
          `            H7 would need a CROSS-DETECTOR signal for Express (auth-bypass HIGH here → idor\n` +
          `            stand down), not an in-file fact, since auth is unknowable from the route file.\n`
      : `    RESULT: idor did NOT cross-fire — silent on the unauthenticated route. The FastAPI lane\n` +
          `            envelope transfers to Express: idor fires only on the genuine IDOR (documents.js),\n` +
          `            and stays in its lane on both the admin and unauthenticated routes. H7 does NOT\n` +
          `            need to touch Express IDOR.\n`,
  );

  // --- Q2: auth-bypass <-> admin-check cross-fire — REPORTED --------
  process.stdout.write("\n--- Q2: routes where >1 detector fires (any cross-fire) ---\n");
  const doubleFlags: string[] = [];
  for (const file of FILES) {
    const firing = (Object.keys(matrix[file]!) as DetName[]).filter((d) =>
      fires(file, d),
    );
    if (firing.length > 1) {
      doubleFlags.push(`${file}: ${firing.join(" + ")}`);
      process.stdout.write(`    ${file}: ${firing.join(" + ")}\n`);
    }
  }
  if (doubleFlags.length === 0) process.stdout.write("    (none)\n");

  process.stdout.write(
    `\n[express-lane] lane-control assertions: ${failures === 0 ? "PASS" : `FAIL (${failures})`}\n`,
  );
  process.stdout.write(
    `[express-lane] idor cross-fire on Express: ${idorCrossFire ? "PRESENT" : "ABSENT"}\n`,
  );
  process.stdout.write(
    `[express-lane] any detector double-flag: ${doubleFlags.length > 0 ? `PRESENT (${doubleFlags.join("; ")})` : "ABSENT"}\n`,
  );
  // The test PASSES when it produced a clean (non-degraded) measurement
  // and the lane-correct controls held. The cross-fire result is data,
  // not a failure condition.
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`[express-lane] ERROR: ${(err as Error).message}\n`);
  process.exit(1);
});
