/**
 * Forced-routing runner (pre-registered 2026-09-28). See lib/forced-routing.ts
 * for what it measures and how it reaches the shipped model stage.
 *
 * THIS IS THE ONLY ENTRY POINT THAT CAN SPEND, AND ONLY WITH --mode live
 * AND --key-file. It refuses when ANTHROPIC_API_KEY is already in the
 * environment (so `.env` loading can never feed it), when the pinned
 * pre-registration or admission text has changed, when any corpus file
 * fails its blob-sha check, when a shipped prompt fingerprint differs from
 * the pinned set, or when the requested ceiling exceeds the pre-registered
 * $18.00. It is not in test:ci; `test:forced-routing-rehearsal` drives it in
 * --mode mock, which constructs no client and touches no network.
 *
 *   node dist/test/forced-routing-runner.js --mode live --key-file <path> --out <dir>
 *   node dist/test/forced-routing-runner.js --mode mock --out <dir> [--corpus-root <dir>]
 *        [--allow-unverified-corpus] [--mock-usage-multiplier N] [--mock-flag-parent]
 *        [--runs N] [--ceiling-usd N]
 *
 * Exit codes: 0 completed; 2 stopped by the ceiling or an error, partial
 * results written; 3 refused to start, nothing written.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  CeilingRefusal,
  INPUTS_DIR,
  forcedCall,
  makeDetectors,
  makeGuard,
  readPrereg,
  readTargets,
  score,
  shippedFingerprints,
  verifyCorpus,
  wireLive,
  wireMock,
  type FileResult,
  type Guard,
  type Side,
  type Target,
} from "./lib/forced-routing";

const out = process.stdout;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<number> {
  const mode = arg("--mode");
  const outDir = arg("--out");
  if ((mode !== "live" && mode !== "mock") || !outDir) {
    out.write("usage: forced-routing-runner --mode live|mock --out <dir> [--key-file <path>] ...\n");
    return 3;
  }
  const repoRoot = process.cwd();
  const corpusRoot = resolve(arg("--corpus-root") ?? join(repoRoot, ".."));

  // Pre-registered inputs, read from the committed documents.
  const prereg = readPrereg(repoRoot);
  const runs = Number(arg("--runs") ?? prereg.runs);
  const ceiling = Number(arg("--ceiling-usd") ?? prereg.ceilingUsd);
  if (!(ceiling > 0) || ceiling > prereg.ceilingUsd) {
    out.write(`refused: ceiling $${ceiling} is not within (0, $${prereg.ceilingUsd}] pre-registered\n`);
    return 3;
  }
  const targets = readTargets(repoRoot, corpusRoot);
  const bad = verifyCorpus(targets);
  if (bad.length > 0 && !(mode === "mock" && flag("--allow-unverified-corpus"))) {
    out.write(`refused: ${bad.length} corpus file(s) missing or not matching their recorded blob sha:\n  ${bad.slice(0, 10).join("\n  ")}\n`);
    return 3;
  }
  if (mode === "live" && flag("--allow-unverified-corpus")) {
    out.write("refused: --allow-unverified-corpus is a rehearsal flag and is not accepted in live mode\n");
    return 3;
  }
  const pinnedFp = (JSON.parse(readFileSync(join(repoRoot, INPUTS_DIR, "shipped-fingerprints-2026-09-28.json"), "utf8")) as { fingerprints: Record<string, string> }).fingerprints;
  const fp = shippedFingerprints();
  for (const [lane, v] of Object.entries(fp)) {
    if (pinnedFp[lane] !== v) {
      out.write(`refused: ${lane} SYSTEM_PROMPT_FINGERPRINT ${v} differs from the pinned ${pinnedFp[lane]}\n`);
      return 3;
    }
  }
  if (mode === "live" && !arg("--key-file")) {
    out.write("refused: --mode live needs --key-file; the key is taken from that file and from nowhere else\n");
    return 3;
  }
  if (mode === "mock" && arg("--key-file")) {
    out.write("refused: --key-file is not accepted in --mode mock\n");
    return 3;
  }
  if (existsSync(outDir) && existsSync(join(outDir, "calls.jsonl"))) {
    out.write(`refused: ${outDir} already holds a run; choose a fresh directory\n`);
    return 3;
  }
  mkdirSync(outDir, { recursive: true });

  let currentSide: Side | undefined;
  const guardFactory = (inner: Guard["create"]): Guard => makeGuard({ inner, ceilingUsd: ceiling, outDir });
  const guard =
    mode === "live"
      ? wireLive(arg("--key-file")!, guardFactory)
      : wireMock({ usageMultiplier: Number(arg("--mock-usage-multiplier") ?? 1), flagParent: flag("--mock-flag-parent"), side: () => currentSide }, guardFactory);

  const startedAt = new Date().toISOString();
  writeFileSync(
    join(outDir, "run.json"),
    JSON.stringify({ mode, startedAt, runs, ceilingUsd: ceiling, corpusVerified: bad.length === 0, fingerprints: fp, targets: targets.length, callsPlanned: targets.length * runs }, null, 2),
  );

  const dets = makeDetectors();
  const results: FileResult[] = targets.map((t) => ({ set: t.set, case: t.case, side: t.side, lane: t.lane, repo: t.repo, path: t.path, verdicts: [] }));
  const contents = new Map<string, string>();
  const read = (t: Target): string => {
    let c = contents.get(t.abs);
    if (c === undefined) {
      c = readFileSync(t.abs, "utf8");
      contents.set(t.abs, c);
    }
    return c;
  };

  let stop: string | null = null;
  let crossCheckMismatches = 0;
  const flush = (): void => {
    const summary = score(results, runs);
    writeFileSync(join(outDir, "results.json"), JSON.stringify({ mode, startedAt, updatedAt: new Date().toISOString(), runs, ceilingUsd: ceiling, measuredUsd: guard.measuredUsd(), calls: guard.calls(), callsPlanned: targets.length * runs, stop, crossCheckMismatches, summary, results }, null, 2));
  };
  flush();
  try {
    // Runs outer, files inner: a stop leaves every file at the same depth.
    for (let run = 1; run <= runs && !stop; run++) {
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i]!;
        currentSide = t.side;
        const { abs, ...rest } = t;
        void abs;
        guard.setContext({ target: rest, run });
        const before = guard.measuredUsd();
        const { verdict, lastCallCostUsd } = await forcedCall(dets, t.lane, t.path, read(t), t.anchorLine);
        const spent = guard.measuredUsd() - before;
        if (lastCallCostUsd !== null && Math.abs(lastCallCostUsd - spent) > 1e-9) crossCheckMismatches++;
        if (guard.refused()) {
          // The attempt was refused inside callClaude (which returned ok:false
          // and a null verdict); the verdict is NOT recorded and the run stops.
          throw new CeilingRefusal(guard.refused()!);
        }
        results[i]!.verdicts.push(verdict);
        flush();
      }
    }
  } catch (err) {
    stop = err instanceof CeilingRefusal ? `ceiling: ${err.message}` : `error: ${(err as Error).stack ?? String(err)}`;
    flush();
  }
  const summary = score(results, runs);
  out.write(
    `${mode}: calls ${guard.calls()} of ${targets.length * runs} planned; measured $${guard.measuredUsd().toFixed(4)} (ceiling $${ceiling.toFixed(2)}); ` +
      `held-out ${summary["heldOutCaseHits"]} of ${summary["heldOutCases"]} -> ${summary["recallVerdict"]}; clean flags ${summary["cleanFlagCount"]} of 30 -> ${summary["noiseVerdict"]}; ` +
      `cross-check mismatches ${crossCheckMismatches}${stop ? `; STOPPED (${stop.split("\n")[0]})` : ""}\n`,
  );
  return stop ? 2 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`forced-routing-runner refused: ${(err as Error).message}\n`);
    process.exit(3);
  },
);
