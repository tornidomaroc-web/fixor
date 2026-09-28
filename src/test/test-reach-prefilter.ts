/**
 * Reach prefilter gate (free, keyless, in test:ci). Detector-reach work,
 * 2026-09-27; record under docs/measurements/detector-reach-2026-09-27/.
 *
 * WHAT IT ASSERTS, and nothing more:
 *   1. Every fixture under fixtures/reach/<detector>/positive|negative
 *      REACHES its detector's model stage: the prefilter returns at least
 *      one trigger (auth-bypass, admin-check) or at least one source/sink
 *      pair (idor). Negatives reach too, by design; the model, not the
 *      regex, tells an ownership filter from its absence.
 *   2. Every pattern id the reach work added is hit by at least one reach
 *      fixture. A pattern with no fixture fails here, which is the
 *      capabilities rule ("regex reach without a fixture is not a claim")
 *      made mechanical.
 *   3. Controls, the second way (R12): lines the widened route regex must
 *      NOT match (HTTP clients, maps, absolute URLs) do not match; a
 *      fixture whose assumed path carries a `scripts` segment is dropped
 *      by detect() with preFilterReason "path filter" and makes no call.
 *
 * WHAT IT DOES NOT ASSERT: any model verdict. No fixture here has a
 * recording; nothing here is detection evidence. No timing bounds.
 *
 * Run via: npm run test:reach-prefilter
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { AdminCheckDetector } from "../analysis-engine/detectors/admin-check.detector";
import { AuthBypassDetector } from "../analysis-engine/detectors/auth-bypass.detector";
import {
  IdorDetector,
  idorPrefilterHits,
} from "../analysis-engine/detectors/idor.detector";
import { EXPRESS_ROUTE_DEF_RE } from "../analysis-engine/detectors/shared/route-def-pattern";
import { buildSyntheticDiff } from "../cli/diff-builder";

const out = process.stdout;
let failures = 0;
function pass(msg: string): void {
  out.write(`  PASS ${msg}\n`);
}
function fail(msg: string): void {
  failures++;
  out.write(`  FAIL ${msg}\n`);
}

type Lang = "ts" | "tsx" | "js" | "jsx";

function loadFixture(filepath: string): { assumedPath: string; content: string } {
  const raw = readFileSync(filepath, "utf8");
  const lines = raw.split(/\r?\n/);
  const m = (lines[0] ?? "").match(/\/\/\s*ASSUMED-PATH:\s*(.+?)\s*$/);
  if (!m) throw new Error(`${filepath}: missing // ASSUMED-PATH: header`);
  lines.splice(0, 1);
  return { assumedPath: m[1]!, content: lines.join("\n") };
}

function langFor(path: string): Lang {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") return ext;
  throw new Error(`unsupported fixture extension: ${path}`);
}

function listFixtures(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => !f.endsWith(".md") && !f.startsWith("."))
    .sort()
    .map((f) => join(dir, f));
}

interface PrefilterHit {
  patternId: string;
  line: number;
}

// The two route-def consumers keep prefilterRegex private; the existing
// prefilter gates reach it the same way.
function routeTriggers(
  detector: AuthBypassDetector | AdminCheckDetector,
  content: string,
  path: string,
): PrefilterHit[] {
  const d = detector as unknown as {
    prefilterRegex: (content: string, filePath: string) => PrefilterHit[];
  };
  return d.prefilterRegex(content, path);
}

// --- 1. Route-def reach: auth-bypass and admin-check -----------------------

// The three declaration shapes the 2026-09-27 widening added. Each must be
// the shape that matches at least one reach fixture line (assertion 2 for
// the shared regex, which carries a single pattern id).
const ROUTE_SHAPES: Record<string, RegExp> = {
  chained_method_call: /^[ \t]*\.(?:get|post|put|delete|patch|all)\s*\(\s*(?:["'`]\/|$)/,
  server_or_fastify_identifier: /\b(?:server|fastify)\.(?:get|post|put|delete|patch|all|route)\s*\(\s*["'`]\//,
  route_object_form: /\b(?:server|app|fastify)\.route\s*\(\s*[[{]/,
};

for (const [name, Ctor] of [
  ["auth-bypass", AuthBypassDetector],
  ["admin-check", AdminCheckDetector],
] as const) {
  out.write(`\n${name}: every reach fixture triggers express_route_def\n`);
  const detector = new Ctor();
  const shapeSeen: Record<string, string[]> = Object.fromEntries(
    Object.keys(ROUTE_SHAPES).map((k) => [k, []]),
  );
  for (const cls of ["positive", "negative"] as const) {
    for (const file of listFixtures(join("fixtures/reach", name, cls))) {
      const { assumedPath, content } = loadFixture(file);
      const hits = routeTriggers(detector, content, assumedPath);
      const routeHit = hits.find((h) => h.patternId === "express_route_def");
      if (routeHit) {
        pass(`${cls}/${basename(file)} triggers express_route_def at line ${routeHit.line}`);
      } else {
        fail(`${cls}/${basename(file)} has no express_route_def trigger (hits: ${JSON.stringify(hits)})`);
      }
      for (const line of content.split(/\r?\n/)) {
        for (const [shape, re] of Object.entries(ROUTE_SHAPES)) {
          if (re.test(line) && EXPRESS_ROUTE_DEF_RE.test(line)) {
            shapeSeen[shape]!.push(`${cls}/${basename(file)}`);
          }
        }
      }
    }
  }
  for (const [shape, files] of Object.entries(shapeSeen)) {
    const uniq = [...new Set(files)];
    if (uniq.length > 0) pass(`shape ${shape} is exercised by ${uniq.join(", ")}`);
    else fail(`shape ${shape} is exercised by NO reach fixture`);
  }
}

// R12, the second way: lines the widened regex must not match.
out.write("\nroute-def controls: non-route callsites do not match\n");
const MUST_NOT_MATCH = [
  'axios.get("https://api.example.com/users")',
  '  .get("https://api.example.com/users")',
  '  .post("users/create")',
  'headers.get("x-request-id")',
  'cache.get("session:" + id)',
  'server.get("config")',
  '  .then((r) => r.get("key"))',
  '  .get(key)',
  '  .delete(users)',
  'const value = map.get(',
];
for (const line of MUST_NOT_MATCH) {
  if (EXPRESS_ROUTE_DEF_RE.test(line)) fail(`matched a non-route line: ${line}`);
  else pass(`no match: ${line}`);
}
const MUST_MATCH = [
  'fastify.get("/", async () => ({ ok: true }))',
  'server.route({ method: "GET", path: "/x", handler })',
  '  .delete("/api/global/groups/:groupId", controller.destroy)',
  '  .get(',
  'router.get("/legacy", handler)',
];
for (const line of MUST_MATCH) {
  if (EXPRESS_ROUTE_DEF_RE.test(line)) pass(`match: ${line}`);
  else fail(`did not match a route line: ${line}`);
}

// --- 2. idor reach: sources, sinks, pairs ---------------------------------

const NEW_IDOR_PATTERNS = [
  "destructured_request_id",
  "fastify_request_params",
  "searchparams_get_id",
  "drizzle_where_eq",
  "drizzle_db_builder",
  "knex_table",
  "knex_where_id",
  "mongoose_write_by_id",
  "typeorm_find_by",
  "sequelize_destroy",
  "prisma_upsert_delete_many",
  "kysely_table_op",
  "supabase_from_table",
  "orm_raw_escape_hatch",
];

out.write("\nidor: every reach fixture yields at least one source/sink pair\n");
const patternSeen = new Map<string, Set<string>>(NEW_IDOR_PATTERNS.map((p) => [p, new Set()]));
const SCRIPTS_CONTROL = "04-scripts-path-control.ts";
for (const cls of ["positive", "negative"] as const) {
  for (const file of listFixtures(join("fixtures/reach/idor", cls))) {
    const { assumedPath, content } = loadFixture(file);
    const { sources, sinks, pairs } = idorPrefilterHits(content, langFor(assumedPath));
    for (const h of [...sources, ...sinks]) patternSeen.get(h.patternId)?.add(`${cls}/${basename(file)}`);
    if (pairs.length > 0) {
      pass(`${cls}/${basename(file)}: ${pairs.length} pair(s), nearest ${pairs[0]!.distance} line(s) apart`);
    } else {
      fail(`${cls}/${basename(file)}: no pair (sources ${sources.length}, sinks ${sinks.length})`);
    }
  }
}
for (const [p, files] of patternSeen) {
  if (files.size > 0) pass(`pattern ${p} is exercised by ${[...files].join(", ")}`);
  else fail(`pattern ${p} is exercised by NO reach fixture`);
}

// --- 3. Path-filter control, through the real detect() -------------------

out.write("\nidor: a scripts-segment path is dropped before the prefilter\n");
const controlPath = join("fixtures/reach/idor/negative", SCRIPTS_CONTROL);
const control = loadFixture(controlPath);
if (!/(^|\/)scripts(\/|$)/.test(control.assumedPath)) {
  fail(`${SCRIPTS_CONTROL} assumed path has no scripts segment: ${control.assumedPath}`);
}
const controlHits = idorPrefilterHits(control.content, langFor(control.assumedPath));
if (controlHits.pairs.length > 0) {
  pass(`${SCRIPTS_CONTROL} WOULD pair (${controlHits.pairs.length}) if its path were not filtered`);
} else {
  fail(`${SCRIPTS_CONTROL} yields no pair, so it cannot serve as a path-filter control`);
}
delete process.env.ANTHROPIC_API_KEY;
const idor = new IdorDetector();
idor
  .detect({ diff: buildSyntheticDiff(control.assumedPath, control.content) })
  .then(() => {
    const diag = idor.lastDiagnostics[0];
    if (diag?.preFilterReason === "path filter") {
      pass(`${SCRIPTS_CONTROL} at ${control.assumedPath}: preFilterReason "path filter"`);
    } else {
      fail(`${SCRIPTS_CONTROL}: expected preFilterReason "path filter", got ${JSON.stringify(diag)}`);
    }
    out.write(`\n${failures === 0 ? "PASS" : "FAIL"}: reach prefilter gate (${failures} failure(s))\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  });
