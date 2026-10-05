/**
 * Route-map rehearsal (free, keyless, in test:ci). No model, no network.
 * Runs the extractor on fixtures/route-map/basic and proves, as functions and
 * through the entry point:
 *
 *   A. Discovery and composition: four routes; mounted paths are composed
 *      through app.use(prefix, ...); the handler resolves to its declaration
 *      in the controller file, also through an object-literal member.
 *   B. Guard chain, in order: app-level use() (mount level), the middleware
 *      inside the mount, router-level use(), route-level guards; a factory
 *      call names its factory; the kind heuristic labels requireAuth as auth
 *      and requireRole as role.
 *   C. Call following to depth 3 and the data-access symbols: the list route
 *      reaches prisma.user.findMany at depth 2 through two files; the delete
 *      route reaches depth 3 (deeper) and NOT depth 4 (deepest), so its data
 *      access is absent.
 *   D. Determinism: the entry point with --twice reports IDENTICAL, and the
 *      serialisation of two in-process builds is byte-identical.
 *   E. Negative controls, each a one-line edit of a copy of basic/: with the
 *      mount middleware removed the auth guard is gone and nothing else moves;
 *      with the service import cut the list route reaches no data access;
 *      with one extra hop the delete route's chain loses its depth-3 node.
 *   F. Refusals: an ANTHROPIC_* variable and a root inside the repository
 *      (outside fixtures/) refuse before any read.
 *   G. Scoring helpers: parseUnifiedDiff, hunkRange, scoreCase on a synthetic
 *      diff against the fixture map: a hunk inside the handler is C2 with
 *      kind "handler"; a hunk in an unrelated file is neither C1 nor C2.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_DEPTH, buildRouteMap, hunkRange, parseUnifiedDiff, scoreCase, serializeMap, type RouteMap, type RouteNode } from "./lib/route-map";
import { refuseReasons } from "./route-map";
import { defectWindow } from "./lib/agentic-review";

const out = process.stdout;
let failures = 0;
const pass = (m: string): void => void out.write(`  PASS ${m}\n`);
const fail = (m: string): void => { failures++; out.write(`  FAIL ${m}\n`); };
const check = (cond: boolean, m: string): void => (cond ? pass(m) : fail(m));
for (const k of Object.keys(process.env)) if (/^(ANTHROPIC_|AWS_|CLAUDE_CODE_USE_|FIXOR_PARKED)/i.test(k)) delete process.env[k];

const REPO = process.cwd();
const FIX = join(REPO, "fixtures", "route-map", "basic");
const ENTRY = join(REPO, "dist", "test", "route-map.js");
const byPath = (map: RouteMap, method: string, path: string): RouteNode | undefined => map.routes.find((r) => r.methods.includes(method) && r.path === path);

out.write("route-map rehearsal\n");
const map = buildRouteMap(FIX);

// A
check(map.digest.routes === 4, `A1 four routes (${map.digest.routes})`);
const health = byPath(map, "get", "/health"), list = byPath(map, "get", "/api/users"), del = byPath(map, "delete", "/api/users/:id"), stats = byPath(map, "get", "/api/admin/stats");
check(!!health && !!list && !!del && !!stats, "A2 paths composed through the mounts: /health, /api/users, /api/users/:id, /api/admin/stats");
check(!!list && list.handler.resolved && list.handler.span.file === "src/controllers/users.ts" && list.handler.name === "listUsers", "A3 list handler resolves to its declaration in the controller file");
check(!!stats && stats.handler.resolved && stats.handler.span.file === "src/controllers/stats.ts" && stats.handler.name === "statsController.read", "A4 object-literal member handler resolves");
check(!!health && health.handler.resolved && health.handler.name === "<inline>" && health.handler.span.file === "src/app.ts", "A5 inline handler is its own node");

// B
const gnames = (r: RouteNode | undefined): string => (r ? r.guards.map((g) => `${g.level}:${g.name}:${g.kind}`).join(" ") : "<none>");
check(gnames(health) === "router:express.json:other", `B1 app-level use() before a route on the same receiver is a router-level guard (${gnames(health)})`);
check(gnames(list) === "mount:express.json:other mount:requireAuth:auth router:audit:other", `B2 list guards in order (${gnames(list)})`);
check(gnames(del) === "mount:express.json:other mount:requireAuth:auth router:audit:other route:requireRole:role", `B3 delete guards add the route-level factory, kind role (${gnames(del)})`);
check(!!list && list.guards[1]!.resolved && list.guards[1]!.span.file === "src/auth.ts", "B4 requireAuth guard resolves to its declaration in auth.ts");
check(!!stats && gnames(stats) === "mount:express.json:other", `B5 admin router mounted without middleware carries only the app-level guard (${gnames(stats)})`);

// C
const das = (r: RouteNode | undefined): string => (r ? r.dataAccess.map((d) => `${d.symbol}@${d.depth}:${d.span.file}`).join(" ") : "<none>");
check(das(list) === "prisma.user.findMany@2:src/repos/user-repo.ts", `C1 list route reaches prisma.user.findMany at depth 2 (${das(list)})`);
check(!!list && list.calls.map((c) => `${c.name}@${c.depth}`).join(" ") === "userService.list@1 userRepo.findAll@2", `C2 list call chain (${list ? list.calls.map((c) => `${c.name}@${c.depth}`).join(" ") : "<none>"})`);
check(!!del && del.calls.some((c) => c.name === "deeper" && c.depth === 3) && !del.calls.some((c) => c.name === "deepest"), `C3 delete chain reaches depth ${MAX_DEPTH} and stops (${del ? del.calls.map((c) => `${c.name}@${c.depth}`).join(" ") : "<none>"})`);
check(das(del) === "", `C4 delete route's data access at depth 4 is NOT reached (${das(del)})`);
check(das(stats) === "prisma.user.count@0:src/controllers/stats.ts", `C5 handler-level data access at depth 0 (${das(stats)})`);

// D
const twice = spawnSync(process.execPath, [ENTRY, "--root", FIX, "--out", join(mkdtempSync(join(tmpdir(), "rm-")), "map.json"), "--twice"], { encoding: "utf8", env: process.env });
check(twice.status === 0 && /two-run IDENTICAL/.test(twice.stdout), `D1 entry point --twice reports IDENTICAL (exit ${twice.status})`);
check(serializeMap(buildRouteMap(FIX)) === serializeMap(map), "D2 two in-process builds serialise byte-identically");

// E: negative controls derived from basic/ by one-line edits.
function variant(name: string, edit: (dir: string) => void): RouteMap {
  const dir = mkdtempSync(join(tmpdir(), `rm-${name}-`));
  cpSync(FIX, dir, { recursive: true });
  edit(dir);
  const m = buildRouteMap(dir);
  rmSync(dir, { recursive: true, force: true });
  return m;
}
const noGuard = variant("noguard", (d) => { const f = join(d, "src", "app.ts"); writeFileSync(f, readFileSync(f, "utf8").replace('app.use("/api/users", requireAuth, usersRouter);', 'app.use("/api/users", usersRouter);')); });
check(gnames(byPath(noGuard, "get", "/api/users")) === "mount:express.json:other router:audit:other", `E1 mount middleware removed: auth guard gone (${gnames(byPath(noGuard, "get", "/api/users"))})`);
check(noGuard.digest.routes === 4 && das(byPath(noGuard, "get", "/api/users")) === das(list), "E2 ...and routes and data access unchanged");
const cut = variant("cut", (d) => { const f = join(d, "src", "controllers", "users.ts"); writeFileSync(f, readFileSync(f, "utf8").replace('import { userService } from "../services/user-service";', 'declare const userService: { list(): Promise<unknown[]>; remove(id: string): Promise<void> };')); });
check(das(byPath(cut, "get", "/api/users")) === "" && (byPath(cut, "get", "/api/users")?.calls.length ?? -1) === 0, `E3 service import cut: no calls followed, no data access (${das(byPath(cut, "get", "/api/users"))})`);
const deeperChain = variant("deeper", (d) => { const f = join(d, "src", "services", "user-service.ts"); writeFileSync(f, readFileSync(f, "utf8").replace("remove: (id: string) => removeDeep(id),", "remove: (id: string) => viaOne(id),\n};\nfunction viaOne(id: string) {\n  return removeDeep(id);\n}\nconst _unused = {")); });
const dd = byPath(deeperChain, "delete", "/api/users/:id");
check(!!dd && dd.calls.some((c) => c.name === "removeDeep" && c.depth === 3) && !dd.calls.some((c) => c.name === "deeper"), `E4 one extra hop: depth-3 node moves, former depth-3 node drops (${dd ? dd.calls.map((c) => `${c.name}@${c.depth}`).join(" ") : "<none>"})`);

// F
check(refuseReasons(FIX, { ANTHROPIC_API_KEY: "x" }, REPO).some((r) => /ANTHROPIC_API_KEY/.test(r)), "F1 an ANTHROPIC_* variable refuses");
check(refuseReasons(join(REPO, "src"), {}, REPO).some((r) => /inside this repository/.test(r)), "F2 a root inside the repository refuses");
check(refuseReasons(FIX, {}, REPO).length === 0, "F3 the fixture root under fixtures/ is allowed");

// G
const diff = ["--- a/src/controllers/users.ts", "+++ b/src/controllers/users.ts", "@@ -5,1 +5,2 @@", "-  const users = await userService.list();", "+  const users = await userService.list(req.user.id);", "--- a/src/unrelated.ts", "+++ b/src/unrelated.ts", "@@ -3,0 +4,1 @@", "+x"].join("\n");
const hunks = parseUnifiedDiff(diff);
check(hunks.length === 2 && hunks[0]!.file === "src/controllers/users.ts" && hunks[0]!.oldStart === 5 && hunks[1]!.oldCount === 0, "G1 parseUnifiedDiff reads parent-side hunks");
check(hunkRange(hunks[0]!).join("-") === "5-5" && hunkRange(hunks[1]!).join("-") === "3-4", "G2 hunkRange: removed lines, or insertion point and the next line");
const text = readFileSync(join(FIX, "src", "controllers", "users.ts"), "utf8");
const s1 = scoreCase(map, [{ file: "src/controllers/users.ts", range: defectWindow(text, 5) }], [{ file: "src/controllers/users.ts", range: [5, 5] }]);
check(s1.c1 && s1.c2 && s1.c2NodeKinds.join() === "handler" && s1.c2Routes === 1, `G3 a hunk inside the list handler is C1 and C2 on one route, kind handler (${JSON.stringify(s1)})`);
const s2 = scoreCase(map, [{ file: "src/unrelated.ts", range: [1, 10] }], [{ file: "src/unrelated.ts", range: [3, 4] }]);
check(!s2.c1 && !s2.c2, "G4 a hunk in an unrelated file is neither C1 nor C2");
const s3 = scoreCase(map, [{ file: "src/repos/user-repo.ts", range: defectWindow(readFileSync(join(FIX, "src", "repos", "user-repo.ts"), "utf8"), 4) }], [{ file: "src/repos/user-repo.ts", range: [4, 4] }]);
check(s3.c2 && s3.c2NodeKinds.join() === "call@2,data@2", `G5 a hunk at the depth-2 data access is C2 through the call node (${s3.c2NodeKinds.join()})`);

// Smoke: the entry point refuses a root inside the repo through its process too.
const refused = spawnSync(process.execPath, [ENTRY, "--root", join(REPO, "src"), "--out", join(tmpdir(), "never.json")], { encoding: "utf8", env: process.env });
check(refused.status === 3 && /REFUSED/.test(refused.stdout), `F4 entry point exits 3 on a refused root (${refused.status})`);
void execFileSync;

out.write(failures === 0 ? "PASS: route-map rehearsal\n" : `FAIL: route-map rehearsal (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
