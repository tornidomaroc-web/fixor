/**
 * Route map, milestone-1 run over the DEVELOPMENT set (section 2.1 of the
 * pre-registration). This is not the measurement: the 22 cases are the ones
 * the extractor is built against, and nothing here may be reported as a
 * result on the measurement set.
 *
 *   node dist/test/measure-route-map-dev.js --cases <tsv> --repos <dir> --diffs <dir>
 *        --maps <dir> --out <results.json>
 *
 * Cases TSV: set, case, repo, fixCommit, parentCommit. For each case the tree
 * at <repos>/<set>-<case> is the PARENT checkout and <diffs>/<set>-<case>.diff
 * is `git diff -U0 parent fix`. Per case: build the map twice (C4), compute
 * the defect windows (A1 3.3 `defectWindow` on each hunk's parent-side start),
 * score C1 and C2 (section 4), and classify a miss mechanically. Writes flags,
 * counts and the map digests; never a route path, a symbol or a line of
 * source. Maps stay under <maps>, outside the repository.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { defectWindow, nonTestSource, sha256 } from "./lib/agentic-review";
import { EXPRESS_ROUTE_DEF_RE } from "../analysis-engine/detectors/shared/route-def-pattern";
import { hunkRange, parseUnifiedDiff, scoreCase, type RouteMap } from "./lib/route-map";

const out = process.stdout;
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };

export type MissCause = "resolved" | "located-only" | "no-route-in-tree" | "defect-file-declares-routes-unrecognised" | "defect-file-imported-by-chain-not-followed" | "defect-file-not-reached";

interface CaseResult {
  set: string; case: string; repo: string; fix: string; parent: string;
  defectFiles: number; hunks: number;
  c1: boolean; c2: boolean; c4: boolean; c1Routes: number; c2Routes: number; c2NodeKinds: string[];
  defectFilesRouteShaped: number; defectFilesInAnyChain: number; defectFilesImportedByChainFile: number;
  cause: MissCause;
  digest: RouteMap["digest"]; mapSha256: string; ms: number;
}

function main(): number {
  const cases = arg("--cases"), repos = arg("--repos"), diffs = arg("--diffs"), maps = arg("--maps"), outFile = arg("--out");
  if (!cases || !repos || !diffs || !maps || !outFile) { out.write("usage: --cases <tsv> --repos <dir> --diffs <dir> --maps <dir> --out <json>\n"); return 3; }
  for (const k of Object.keys(process.env)) if (/^ANTHROPIC_/i.test(k)) { out.write(`REFUSED: environment carries ${k}\n`); return 3; }
  const rows = readFileSync(cases, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const [set, c, repo, fix, parent] = l.split("\t"); return { set: set!, case: c!, repo: repo!, fix: fix!, parent: parent! }; });
  const results: CaseResult[] = [];
  const entry = join(__dirname, "route-map.js");
  for (const r of rows) {
    const id = `${r.set}-${r.case}`;
    const root = join(repos, id);
    const diffFile = join(diffs, `${id}.diff`);
    if (!existsSync(root) || !existsSync(diffFile)) { out.write(`${id}: SKIPPED (no tree or diff)\n`); continue; }
    const mapFile = join(maps, `${id}.json`);
    const t0 = Date.now();
    let c4 = true;
    try { execFileSync(process.execPath, [entry, "--root", root, "--out", mapFile, "--twice"], { stdio: ["ignore", "ignore", "inherit"], env: process.env }); }
    catch (e) { const code = (e as { status?: number }).status; if (code === 2) c4 = false; else throw e; }
    const map = JSON.parse(readFileSync(mapFile, "utf8")) as RouteMap;
    const hunks = parseUnifiedDiff(readFileSync(diffFile, "utf8")).filter((h) => nonTestSource(h.file));
    const files = [...new Set(hunks.map((h) => h.file))].sort();
    const texts = new Map<string, string>();
    for (const f of files) { try { texts.set(f, readFileSync(join(root, f), "utf8")); } catch { /* added by the fix: no parent text */ } }
    const windows = hunks.filter((h) => texts.has(h.file)).map((h) => ({ file: h.file, range: defectWindow(texts.get(h.file)!, hunkRange(h)[0]) }));
    const ranges = hunks.filter((h) => texts.has(h.file)).map((h) => ({ file: h.file, range: hunkRange(h) }));
    const score = scoreCase(map, windows, ranges);
    const parentFiles = [...texts.keys()];
    const routeShaped = parentFiles.filter((f) => EXPRESS_ROUTE_DEF_RE.test(texts.get(f)!));
    const chainFiles = new Set<string>();
    for (const rt of map.routes) { chainFiles.add(rt.declaration.file); chainFiles.add(rt.handler.span.file); for (const g of rt.guards) chainFiles.add(g.span.file); for (const c of rt.calls) chainFiles.add(c.span.file); }
    const inChain = parentFiles.filter((f) => chainFiles.has(f));
    // "imported by a chain file": a chain file's text names the defect file's basename in an import specifier.
    const importedBy = parentFiles.filter((f) => { const base = f.replace(/^.*\//, "").replace(/\.[^.]+$/, ""); for (const cf of chainFiles) { let t: string; try { t = readFileSync(join(root, cf), "utf8"); } catch { continue; } if (new RegExp(`from\\s+["'][^"']*/${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.[a-z]+)?["']|require\\(["'][^"']*/${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.[a-z]+)?["']\\)`).test(t)) return true; } return false; });
    let cause: MissCause;
    if (score.c2) cause = "resolved";
    else if (score.c1) cause = "located-only";
    else if (map.routes.length === 0) cause = "no-route-in-tree";
    else if (routeShaped.length && !inChain.some((f) => routeShaped.includes(f))) cause = "defect-file-declares-routes-unrecognised";
    else if (importedBy.length) cause = "defect-file-imported-by-chain-not-followed";
    else cause = "defect-file-not-reached";
    const res: CaseResult = {
      ...r, defectFiles: files.length, hunks: hunks.length, c1: score.c1, c2: score.c2, c4, c1Routes: score.c1Routes, c2Routes: score.c2Routes, c2NodeKinds: score.c2NodeKinds,
      defectFilesRouteShaped: routeShaped.length, defectFilesInAnyChain: inChain.length, defectFilesImportedByChainFile: importedBy.length, cause,
      digest: map.digest, mapSha256: sha256(readFileSync(mapFile, "utf8")), ms: Date.now() - t0,
    };
    results.push(res);
    out.write(`${id}: C1=${res.c1 ? "Y" : "n"} C2=${res.c2 ? "Y" : "n"} C4=${res.c4 ? "Y" : "n"} routes=${map.digest.routes} cause=${cause} ms=${res.ms}\n`);
  }
  const totals = { cases: results.length, c1: results.filter((x) => x.c1).length, c2: results.filter((x) => x.c2).length, c4: results.filter((x) => x.c4).length, causes: Object.fromEntries([...new Set(results.map((x) => x.cause))].sort().map((c) => [c, results.filter((x) => x.cause === c).length])) };
  writeFileSync(outFile, JSON.stringify({ note: "development set; not the measurement", totals, results }, null, 1) + "\n");
  out.write(`totals: ${JSON.stringify(totals)}\n`);
  return 0;
}

if (require.main === module) process.exit(main());
