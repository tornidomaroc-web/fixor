/**
 * Route map, entry point. Pre-registration:
 *   docs/measurements/route-map-2026-10-04/route-map-prereg-2026-10-04.md
 *
 *   node dist/test/route-map.js --root <tree> --out <map.json> [--twice]
 *
 * Builds the map of the tree at --root and writes it. With --twice, builds it
 * again in a SECOND PROCESS, compares the two serialisations byte for byte
 * (C4), writes the second to <map.json>.run2, and exits 2 on a difference.
 * Reads the tree only; no network, no model, no key. Refuses to start when
 * any ANTHROPIC_* variable is set (section 7), and refuses a root inside
 * this repository's own checkout.
 *
 * Exit codes: 0 built (and identical when --twice); 2 the two runs differ;
 * 3 refused to start.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import { buildRouteMap, serializeMap } from "./lib/route-map";
import { sha256 } from "./lib/agentic-review";

const out = process.stdout;
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };

export function refuseReasons(root: string, env: NodeJS.ProcessEnv, cwd: string): string[] {
  const reasons: string[] = [];
  for (const k of Object.keys(env)) if (/^ANTHROPIC_/i.test(k)) reasons.push(`environment carries ${k}`);
  if (!existsSync(root) || !statSync(root).isDirectory()) reasons.push(`root is not a directory: ${root}`);
  const r = resolve(root) + sep, c = resolve(cwd) + sep;
  if (r.startsWith(c) && !r.startsWith(resolve(cwd, "fixtures") + sep)) reasons.push("root is inside this repository's checkout (only fixtures/ is allowed)");
  return reasons;
}

function main(): number {
  const root = arg("--root"), outFile = arg("--out");
  if (!root || !outFile) { out.write("usage: route-map --root <tree> --out <map.json> [--twice]\n"); return 3; }
  const reasons = refuseReasons(root, process.env, process.cwd());
  if (reasons.length) { for (const r of reasons) out.write(`REFUSED: ${r}\n`); return 3; }
  const t0 = Date.now();
  const map = buildRouteMap(root);
  const text = serializeMap(map);
  writeFileSync(outFile, text);
  const d = map.digest;
  out.write(`route-map: files=${d.files} parsed=${d.parsed} parseErrors=${d.parseErrors} receivers=${d.receivers} routes=${d.routes} noGuard=${d.routesNoGuard} noDataAccess=${d.routesNoDataAccess} unresolved=${d.unresolvedEdges} sha256=${sha256(text).slice(0, 16)} ms=${Date.now() - t0}\n`);
  if (process.argv.includes("--twice")) {
    const second = outFile + ".run2";
    execFileSync(process.execPath, [process.argv[1]!, "--root", root, "--out", second], { stdio: ["ignore", "ignore", "inherit"], env: process.env });
    const a = sha256(text), b = sha256(readFileSync(second, "utf8"));
    out.write(`route-map: two-run ${a === b ? "IDENTICAL" : "DIFFERENT"} ${a.slice(0, 16)} ${b.slice(0, 16)}\n`);
    if (a !== b) return 2;
  }
  return 0;
}

if (require.main === module) process.exit(main());
