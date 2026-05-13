import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { logger } from "../lib/logger.js";
import { analyzeCode } from "../analysis-engine/analyze.js";
import { DETECTORS } from "../analysis-engine/detectors/registry.js";
import type { NormalizedFinding } from "../analysis-engine/detector.types.js";
import type { Finding } from "../analysis-engine/types.js";
import { walkFiles } from "./file-walker.js";
import { buildSyntheticDiff } from "./diff-builder.js";
import { buildMarkdownReport, type FileScanResult } from "./report-builder.js";

const DEFAULT_EXTENSIONS = ["ts", "tsx", "js", "jsx", "py", "go"];
const DELAY_MS = 1500;            // between files
const SUB_DELAY_MS = 800;         // between LLM-hitting detector calls within a file
const ESTIMATED_COST_BEST_USD = 0.012;   // realistic — most detectors short-circuit
const ESTIMATED_COST_WORST_USD = 0.02;   // worst case — all 5 detectors hit LLM

// Phase 5 detectors: invoked here in addition to analyzeCode (which covers
// the original SQL/XSS/CMDI/PT families). The 4 original detectors only
// generate fixes — they have no detect() pass — so iterating DETECTORS by
// id-allowlist is enough.
const NEW_DETECTOR_IDS = new Set<string>([
  "auth-bypass-multi",
  "secrets-exposure-multi",
  "webhook-unverified-multi",
  "env-exposure-multi",
  "admin-check-multi",
  "idor-multi",
]);

const newDetectors = DETECTORS.filter(
  (d) => NEW_DETECTOR_IDS.has(d.id) && typeof d.detect === "function",
);

function normalizedToFinding(n: NormalizedFinding): Finding {
  const severity: Finding["severity"] =
    n.severity === "low" ? "medium" : n.severity;
  return {
    type: n.type,
    file: n.file,
    line: n.startLine,
    confidence: n.confidence,
    severity,
    explanation: n.explanation,
    why_it_matters: n.message,
    suggested_fix: "",
    example_fix: "",
    original_snippet: n.originalCode,
  };
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const key = `${f.file}:${f.line}:${f.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

interface CliOpts {
  repoPath: string;
  outputPath?: string;
  extensions: Set<string>;
}

function parseArgs(argv: string[]): CliOpts | null {
  const args = argv.slice(2);
  if (args.length === 0) return null;
  let repoPath: string | null = null;
  let outputPath: string | undefined;
  let extensions = new Set(DEFAULT_EXTENSIONS);
  for (const a of args) {
    if (a.startsWith("--output=")) {
      outputPath = a.slice("--output=".length);
    } else if (a.startsWith("--ext=")) {
      const list = a
        .slice("--ext=".length)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (list.length > 0) extensions = new Set(list);
    } else if (!a.startsWith("--")) {
      if (!repoPath) repoPath = a;
    }
  }
  if (!repoPath) return null;
  return { repoPath: resolve(repoPath), outputPath, extensions };
}

function defaultReportPath(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`;
  return `scan-report-${stamp}.md`;
}

function formatRuntime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(prompt);
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  if (!opts) {
    logger.error(
      "Usage: npm run scan -- <repo-path> [--output=path] [--ext=ts,js,py,go]",
    );
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    logger.error(
      "ANTHROPIC_API_KEY is not set. Export it before running the scan.",
    );
    process.exit(1);
  }

  logger.info({ root: opts.repoPath }, "discovering files");
  const files = walkFiles({ root: opts.repoPath, extensions: opts.extensions });

  if (files.length === 0) {
    logger.warn("No matching files found. Exiting.");
    return;
  }

  const estBestUsd = files.length * ESTIMATED_COST_BEST_USD;
  const estWorstUsd = files.length * ESTIMATED_COST_WORST_USD;
  // Worst-case runtime: per file = analyzeCode (~3s) + DELAY_MS sleep +
  // up to N detectors × (~3s LLM + SUB_DELAY_MS sleep).
  const estRuntimeSec =
    files.length *
    (3 + DELAY_MS / 1000 + newDetectors.length * (3 + SUB_DELAY_MS / 1000));

  output.write(`\nFiles to scan:       ${files.length}\n`);
  output.write(
    `Detectors per file:  1 central (analyzeCode) + ${newDetectors.length} specialized\n`,
  );
  output.write(
    `Estimated cost:      ~$${estBestUsd.toFixed(2)} typical / ~$${estWorstUsd.toFixed(2)} worst-case\n`,
  );
  output.write(
    `Estimated runtime:   ~${formatRuntime(estRuntimeSec)} (worst case)\n\n`,
  );

  const proceed = await confirm('Proceed? Type "yes" to continue: ');
  if (!proceed) {
    logger.info("Aborted by user.");
    return;
  }

  const results: FileScanResult[] = [];
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i]!;
    const rel = relative(opts.repoPath, filePath);
    logger.info(
      {
        file: rel,
        index: i + 1,
        total: files.length,
        detectors: 1 + newDetectors.length,
      },
      "scanning (analyzeCode + N specialized)",
    );

    const allFindings: Finding[] = [];
    try {
      const content = readFileSync(filePath, "utf8");
      const diff = buildSyntheticDiff(rel, content);

      // 1. Central LLM analyzer — original 4 families (SQL/XSS/CMDI/PT).
      const central = await analyzeCode(diff);
      allFindings.push(...central.findings);

      // 2. Phase 5 specialized detectors. Each has its own pre-filter +
      //    LLM gate; most short-circuit on path/regex misses, so the
      //    extra cost is small.
      for (const detector of newDetectors) {
        if (!detector.detect) continue;
        try {
          const dFindings = await detector.detect({ diff });
          for (const nf of dFindings) {
            const f = normalizedToFinding(nf);
            allFindings.push(f);
            logger.info(
              { file: f.file, line: f.line, type: f.type, detector: detector.id },
              "detector hit",
            );
          }
          // Sleep only when the detector likely made an LLM call (no
          // pre-filter shortcut). lastDiagnostics is exposed publicly by
          // each Phase 5 detector for exactly this purpose.
          const diag = (
            detector as {
              lastDiagnostics?: Array<{ preFilterReason?: string }>;
            }
          ).lastDiagnostics?.[0];
          if (diag && !diag.preFilterReason) {
            await sleep(SUB_DELAY_MS);
          }
        } catch (err) {
          logger.warn(
            { err, detector: detector.id, file: rel },
            "detector failed; continuing",
          );
        }
      }
    } catch (err) {
      logger.error({ err, file: rel }, "scan failed for file");
    }

    const merged = dedupeFindings(allFindings);
    results.push({ filePath: rel, findings: merged });

    if (i < files.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  const reportPath = opts.outputPath ?? defaultReportPath();
  const markdown = buildMarkdownReport(opts.repoPath, results);
  writeFileSync(reportPath, markdown, "utf8");

  const countsByType: Record<string, number> = {};
  for (const r of results) {
    for (const f of r.findings) {
      countsByType[f.type] = (countsByType[f.type] ?? 0) + 1;
    }
  }
  const totalFindings = Object.values(countsByType).reduce(
    (a, b) => a + b,
    0,
  );

  logger.info(
    {
      reportPath,
      totalFindings,
      filesScanned: results.length,
      byType: countsByType,
    },
    "scan complete",
  );
}

main().catch((err) => {
  logger.error({ err }, "scan crashed");
  process.exit(1);
});
