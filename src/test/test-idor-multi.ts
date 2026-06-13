/**
 * IDOR multi-finding proving test (H6, Phase H Tier 2).
 *
 * The standard stability harness only checks "flagged at all" (>0
 * findings), so it cannot prove the one-finding ceiling is lifted. This
 * test calls analyzeFile directly and asserts the exact finding SET per
 * file (count + sink lines), n=5 K-of-N, so an unstable multi-verdict
 * (count flips run to run) fails the gate.
 *
 * Pinned (fixtures/idor-multi/META.md):
 *   A-two-independent-idors.ts → exactly 2 findings at sink lines {19,36}
 *   B-one-real-one-safe.ts     → exactly 1 finding at line 22; line 12 absent
 *
 * Coverage-gated: aborts on any failed LLM call (degraded measurement is
 * not a measurement).
 *
 * COST: 2 fixtures x n=5 = 10 Sonnet 4.6 whole-file calls ~= $0.10-0.15.
 * Not in test:ci (it spends). Run: npm run test:idor-multi.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { IdorDetector } from "../analysis-engine/detectors/idor.detector";
import {
  llmCoverageSince,
  snapshotLlmCoverage,
} from "../lib/llm-coverage";

const DIR = "fixtures/idor-multi";
const N_RUNS = 5;
const K = 4; // >=4/5 runs must produce the exact expected set

interface Case {
  file: string;
  expected: number[]; // sorted sink lines that MUST be flagged
  forbidden: number[]; // sink lines that must NOT be flagged
  label: string;
}

const CASES: Case[] = [
  {
    file: "A-two-independent-idors.ts",
    expected: [19, 36],
    forbidden: [],
    label: "two independent IDORs → BOTH flag (ceiling lifted)",
  },
  {
    file: "B-one-real-one-safe.ts",
    expected: [22],
    forbidden: [12],
    label: "one real + one safe → exactly the real one (line 22), line 12 absent",
  },
];

async function runOnce(file: string): Promise<number[]> {
  const detector = new IdorDetector();
  const content = readFileSync(join(DIR, file), "utf8");
  const lang = file.endsWith(".py") ? "py" : "ts";
  const findings = await detector.analyzeFile(file, content, lang);
  return findings.map((f) => f.startLine).sort((a, b) => a - b);
}

function setsEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write("ANTHROPIC_API_KEY is not set. Export it before running this test.\n");
    process.exit(1);
  }

  const snap = snapshotLlmCoverage();
  let failures = 0;

  for (const c of CASES) {
    process.stdout.write(`\n=== ${c.file} — ${c.label} ===\n`);
    const runs: number[][] = [];
    for (let i = 0; i < N_RUNS; i++) {
      const lines = await runOnce(c.file);
      runs.push(lines);
      process.stdout.write(`  [run ${i + 1}/${N_RUNS}] flagged sink lines: {${lines.join(", ")}}\n`);
    }
    const matches = runs.filter(
      (r) =>
        setsEqual(r, c.expected) &&
        c.forbidden.every((fl) => !r.includes(fl)),
    ).length;
    const ok = matches >= K;
    process.stdout.write(
      `  STABILITY: ${matches}/${N_RUNS} runs produced exactly {${c.expected.join(", ")}}` +
        (c.forbidden.length ? ` with {${c.forbidden.join(", ")}} absent` : "") +
        ` — ${ok ? "PASS" : "FAIL"} (need >=${K}/${N_RUNS})\n`,
    );
    if (!ok) failures++;
  }

  const cov = llmCoverageSince(snap);
  process.stdout.write(`\nLLM coverage: ${cov.attempted} attempted, ${cov.failed} failed\n`);
  if (cov.failed > 0) {
    process.stdout.write(
      `\n[idor-multi] ABORT — degraded coverage (${cov.failed} failed LLM calls). ` +
        `Measurement invalid. byReason=${JSON.stringify(cov.byReason)}\n`,
    );
    process.exit(2);
  }

  process.stdout.write(`\n[idor-multi] ${failures === 0 ? "PASS" : `FAIL (${failures})`}\n`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`[idor-multi] ERROR: ${(err as Error).message}\n`);
  process.exit(1);
});
