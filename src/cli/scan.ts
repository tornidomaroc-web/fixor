import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { logger } from "../lib/logger.js";
import { analyzeCode } from "../analysis-engine/analyze.js";
import { walkFiles } from "./file-walker.js";
import { buildSyntheticDiff } from "./diff-builder.js";
import { buildMarkdownReport, type FileScanResult } from "./report-builder.js";

const DEFAULT_EXTENSIONS = ["ts", "tsx", "js", "jsx", "py", "go"];
const DELAY_MS = 1500;
const ESTIMATED_COST_PER_FILE_USD = 0.01;

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

  const estCostUsd = files.length * ESTIMATED_COST_PER_FILE_USD;
  const estRuntimeSec = files.length * (DELAY_MS / 1000 + 2);

  output.write(`\nFiles to scan: ${files.length}\n`);
  output.write(`Estimated cost: ~$${estCostUsd.toFixed(2)} (rough)\n`);
  output.write(`Estimated runtime: ~${formatRuntime(estRuntimeSec)}\n\n`);

  const proceed = await confirm('Proceed? Type "yes" to continue: ');
  if (!proceed) {
    logger.info("Aborted by user.");
    return;
  }

  const results: FileScanResult[] = [];
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i]!;
    const rel = relative(opts.repoPath, filePath);
    logger.info({ file: rel, index: i + 1, total: files.length }, "scanning");
    try {
      const content = readFileSync(filePath, "utf8");
      const diff = buildSyntheticDiff(rel, content);
      const result = await analyzeCode(diff);
      results.push({ filePath: rel, findings: result.findings });
    } catch (err) {
      logger.error({ err, file: rel }, "scan failed for file");
      results.push({ filePath: rel, findings: [] });
    }
    if (i < files.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  const reportPath = opts.outputPath ?? defaultReportPath();
  const markdown = buildMarkdownReport(opts.repoPath, results);
  writeFileSync(reportPath, markdown, "utf8");

  const totalFindings = results.reduce((n, r) => n + r.findings.length, 0);
  logger.info(
    { reportPath, totalFindings, filesScanned: results.length },
    "scan complete",
  );
}

main().catch((err) => {
  logger.error({ err }, "scan crashed");
  process.exit(1);
});
