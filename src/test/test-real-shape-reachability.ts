/**
 * Real-shape prefilter-reachability proof (no LLM, no network, zero API cost).
 *
 * Bridges the gap between "synthetic single-pattern fixtures pass" and the
 * "0-findings real-world scans" by asserting that, in a REALISTIC multi-route
 * mini-app (fixtures/real-shape/<app>/), the deterministic prefilter stage:
 *
 *   1. ROUTES every planted-vuln handler AND every gated-control handler to
 *      the correct detector's LLM stage (the silent-skip class that broke
 *      App Router pre-Phase-B: a whole paradigm dropped before the LLM ever
 *      saw it). Whether the LLM then FLAGS vs CLEARS is the live-scan proof;
 *      this test only proves the file is not silently skipped.
 *
 *   2. Does NOT over-match utility modules (auth/db/models definitions) — the
 *      Remix `loader`/`action`-over-match class the isRemixRoutePath filter
 *      was built to bound.
 *
 * It imports the REAL detector regexes from route-def-pattern, so the proof
 * cannot drift from what the detectors actually use. Ground truth is read from
 * each app's ground-truth.json (a non-source manifest, excluded from scans).
 *
 * Run via: npm run test:real-shape
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  FASTAPI_ROUTE_DEF_RE,
  FLASK_ROUTE_DEF_RE,
  isPythonPath,
} from "../analysis-engine/detectors/shared/route-def-pattern";

const CORPUS_ROOT = "fixtures/real-shape";

type GroundTruth = {
  corpus: string;
  framework: string;
  expected_vulnerable: { file: string; route: string; detector: string }[];
  expected_clear_controls: { file: string; route: string }[];
  expected_no_prefilter_match: { file: string; why: string }[];
};

/** A file reaches the Python route-shape pipeline if either decorator regex
 *  matches. (FastAPI `.METHOD` / Flask classic `.route` / shared shorthand.) */
function reachesRouteShape(content: string): boolean {
  return FASTAPI_ROUTE_DEF_RE.test(content) || FLASK_ROUTE_DEF_RE.test(content);
}

function appDirs(): string[] {
  if (!existsSync(CORPUS_ROOT)) return [];
  return readdirSync(CORPUS_ROOT)
    .map((name) => join(CORPUS_ROOT, name))
    .filter(
      (p) => statSync(p).isDirectory() && existsSync(join(p, "ground-truth.json"))
    );
}

let totalChecks = 0;
let failures = 0;

function check(cond: boolean, label: string): void {
  totalChecks++;
  if (cond) {
    console.log(`    PASS  ${label}`);
  } else {
    failures++;
    console.log(`    FAIL  ${label}`);
  }
}

function runApp(appDir: string): void {
  const gt = JSON.parse(
    readFileSync(join(appDir, "ground-truth.json"), "utf8")
  ) as GroundTruth;

  console.log(`\n${"═".repeat(64)}`);
  console.log(`App: ${gt.corpus}  (${gt.framework})`);
  console.log(`Dir: ${appDir}`);

  // De-dupe route files: a single module can hold both a planted vuln and a
  // gated control (the in-file discrimination this corpus is built to test).
  const routeFiles = new Set<string>([
    ...gt.expected_vulnerable.map((e) => e.file),
    ...gt.expected_clear_controls.map((e) => e.file),
  ]);

  console.log(`\n  [1] Route handlers must REACH the route-shape pipeline:`);
  for (const rel of [...routeFiles].sort()) {
    const abs = join(appDir, rel);
    const content = readFileSync(abs, "utf8");
    check(isPythonPath(abs), `${rel} — lang-gated as Python (.py)`);
    check(reachesRouteShape(content), `${rel} — matches route-def prefilter`);
  }

  console.log(`\n  [2] Utility modules must NOT over-match the prefilter:`);
  for (const e of gt.expected_no_prefilter_match) {
    const abs = join(appDir, e.file);
    const content = readFileSync(abs, "utf8");
    check(
      !reachesRouteShape(content),
      `${e.file} — no route-def match (${e.why})`
    );
  }

  // Sanity: every referenced file actually exists.
  console.log(`\n  [3] Manifest integrity (referenced files exist):`);
  const allRefs = [
    ...gt.expected_vulnerable.map((e) => e.file),
    ...gt.expected_clear_controls.map((e) => e.file),
    ...gt.expected_no_prefilter_match.map((e) => e.file),
  ];
  for (const rel of [...new Set(allRefs)].sort()) {
    check(existsSync(join(appDir, rel)), `${rel} — exists`);
  }
}

function main(): void {
  console.log("Fixor real-shape prefilter-reachability proof (zero API)");
  const dirs = appDirs();
  if (dirs.length === 0) {
    console.error(`No app dirs with ground-truth.json under ${CORPUS_ROOT}`);
    process.exit(1);
  }
  for (const d of dirs) runApp(d);

  console.log(`\n${"═".repeat(64)}`);
  console.log(`Total checks: ${totalChecks}  |  Failures: ${failures}`);
  if (failures > 0) {
    console.log("RESULT: FAIL");
    process.exit(1);
  }
  console.log("RESULT: PASS");
}

main();
