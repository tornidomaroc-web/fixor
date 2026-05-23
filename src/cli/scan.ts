import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { logger } from "../lib/logger.js";
import { analyzeCode } from "../analysis-engine/analyze.js";
import {
  DETECTORS,
  SHIPPING_DETECTOR_IDS,
} from "../analysis-engine/detectors/registry.js";
import {
  APP_ROUTER_ROUTE_DEF_RE,
  EXPRESS_ROUTE_DEF_RE,
} from "../analysis-engine/detectors/shared/route-def-pattern.js";
import { isSuppressedFindingType } from "../config/finding-suppressions.js";
import type { NormalizedFinding } from "../analysis-engine/detector.types.js";
import type { Finding } from "../analysis-engine/types.js";
import { walkFiles } from "./file-walker.js";
import { buildSyntheticDiff } from "./diff-builder.js";
import { buildMarkdownReport, type FileScanResult } from "./report-builder.js";

const DEFAULT_EXTENSIONS = ["ts", "tsx", "js", "jsx", "py", "go"];
const DELAY_MS = 1500;            // between files
const SUB_DELAY_MS = 800;         // between LLM-hitting detector calls within a file

// Cost model — corpus-shape-aware, not a flat per-file constant.
//
// A file that matches the route-shape prefilter (Next.js App Router
// HTTP-method-named export, or Express-family router.METHOD(...)) routes
// to 3 additional detectors' LLM stages on top of the base analyzeCode
// call: auth-bypass + admin-check (both ship whole-file context) and
// webhook-unverified (windowed). Pre-Phase-B the prefilters short-
// circuited most files; the flat $0.012/$0.024 constants encoded that
// assumption and undercounted App Router corpora ~2-3x at Phase D.
//
// PER_CALL_COST_USD is Sonnet 4.6 empirical from the Phase D 182-file
// inbox-zero burn (~$0.007-0.010 per call); $0.012 leaves headroom on
// the never-below side per operator rule for a customer-facing estimate.
// Worst-case math counts all 3 content prefilters (secrets/env/idor)
// hitting per file — intentionally inflated so a worst-case figure
// rarely gets exceeded in practice.
const PER_CALL_COST_USD = 0.012;
const ROUTE_SHAPE_EXTRA_DETECTORS = 3;
const CONTENT_PREFILTER_DETECTORS = 3;

// Pre-count itself reads each file once. On very large repos this can
// become slow enough to be a small version of the problem the estimator
// is meant to fix. Above the threshold we stride-sample and extrapolate
// — surfaced in the output so the customer knows the figure is sampled.
const PRECOUNT_FULL_THRESHOLD = 2000;
const PRECOUNT_SAMPLE_SIZE = 500;

// Specialized detectors invoked here in addition to analyzeCode (which
// covers the original SQL/XSS/CMDI/PT families, output-suppressed). Those
// 4 original detectors only generate fixes — they have no detect() pass —
// so iterating DETECTORS by id-allowlist (the shared SHIPPING_DETECTOR_IDS
// set from the registry) is enough.
const newDetectors = DETECTORS.filter(
  (d) => SHIPPING_DETECTOR_IDS.has(d.id) && typeof d.detect === "function",
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

// Drop admin_check_risk findings on any (file, line) where auth_bypass_risk
// also fires. Rationale: auth-bypass on a route with no auth at all already
// subsumes the admin-check signal — reporting both inflates the count without
// adding remediation value. Admin-check findings on file:line without an
// auth-bypass sibling (e.g. ADMIN_EMAILS literal) are preserved.
function suppressAdminCheckWhereAuthBypass(findings: Finding[]): Finding[] {
  const authBypassKeys = new Set(
    findings
      .filter((f) => f.type === "auth_bypass_risk")
      .map((f) => `${f.file}:${f.line}`),
  );
  return findings.filter(
    (f) =>
      !(f.type === "admin_check_risk" && authBypassKeys.has(`${f.file}:${f.line}`)),
  );
}

interface CliOpts {
  repoPath: string;
  outputPath?: string;
  extensions: Set<string>;
  /** When true, skip the interactive cost/runtime confirmation prompt.
   *  Set via `--yes` (or `-y`). Required for any non-TTY caller — CI,
   *  piped scripts, smoke tests — that would otherwise block forever
   *  on `readline.question`. */
  assumeYes: boolean;
}

function parseArgs(argv: string[]): CliOpts | null {
  const args = argv.slice(2);
  if (args.length === 0) return null;
  let repoPath: string | null = null;
  let outputPath: string | undefined;
  let extensions = new Set(DEFAULT_EXTENSIONS);
  let assumeYes = false;
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
    } else if (a === "--yes" || a === "-y") {
      assumeYes = true;
    } else if (!a.startsWith("--")) {
      if (!repoPath) repoPath = a;
    }
  }
  if (!repoPath) return null;
  return { repoPath: resolve(repoPath), outputPath, extensions, assumeYes };
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

/**
 * Counts files whose content matches the route-shape prefilter. Each
 * match adds ROUTE_SHAPE_EXTRA_DETECTORS LLM calls to the per-file cost.
 * For repos above PRECOUNT_FULL_THRESHOLD, stride-samples and reports
 * `sampled: true` so the output can flag the figure as an estimate.
 */
function countRouteShapeFiles(files: string[]): {
  count: number;
  sampled: boolean;
  sampleSize?: number;
} {
  const matches = (path: string): boolean => {
    try {
      const c = readFileSync(path, "utf8");
      return APP_ROUTER_ROUTE_DEF_RE.test(c) || EXPRESS_ROUTE_DEF_RE.test(c);
    } catch {
      // The walker enumerated this path; if we can't read it during the
      // pre-count the real scan will surface the error. Don't let the
      // estimator fail the scan.
      return false;
    }
  };

  if (files.length <= PRECOUNT_FULL_THRESHOLD) {
    let count = 0;
    for (const f of files) if (matches(f)) count++;
    return { count, sampled: false };
  }

  const stride = Math.max(1, Math.floor(files.length / PRECOUNT_SAMPLE_SIZE));
  let sampleMatches = 0;
  let sampled = 0;
  for (let i = 0; i < files.length; i += stride) {
    if (matches(files[i]!)) sampleMatches++;
    sampled++;
  }
  const rate = sampled > 0 ? sampleMatches / sampled : 0;
  return {
    count: Math.round(rate * files.length),
    sampled: true,
    sampleSize: sampled,
  };
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
      "Usage: npm run scan -- <repo-path> [--output=path] [--ext=ts,js,py,go] [--yes|-y]",
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
  const { files, skippedDirs, ignoredNegations } = walkFiles({
    root: opts.repoPath,
    extensions: opts.extensions,
  });

  if (files.length === 0) {
    logger.warn("No matching files found. Exiting.");
    return;
  }

  const routeShape = countRouteShapeFiles(files);
  const baseCallsUsd = files.length * PER_CALL_COST_USD;
  const routeShapeUsd =
    routeShape.count * ROUTE_SHAPE_EXTRA_DETECTORS * PER_CALL_COST_USD;
  const contentMaxUsd =
    files.length * CONTENT_PREFILTER_DETECTORS * PER_CALL_COST_USD;
  const estTypicalUsd = baseCallsUsd + routeShapeUsd;
  const estWorstUsd = baseCallsUsd + routeShapeUsd + contentMaxUsd;
  // Worst-case runtime: per file = analyzeCode (~3s) + DELAY_MS sleep +
  // up to N detectors × (~3s LLM + SUB_DELAY_MS sleep).
  const estRuntimeSec =
    files.length *
    (3 + DELAY_MS / 1000 + newDetectors.length * (3 + SUB_DELAY_MS / 1000));

  const routeShapeNote = routeShape.sampled
    ? `${routeShape.count} (estimated from ${routeShape.sampleSize}-file sample; each triggers 3 additional LLM calls)`
    : `${routeShape.count} (each triggers 3 additional LLM calls)`;

  output.write(`\nFiles to scan:       ${files.length}\n`);
  output.write(
    `Detectors per file:  1 central (analyzeCode) + ${newDetectors.length} specialized\n`,
  );
  output.write(
    `Estimated cost:      ~$${estTypicalUsd.toFixed(2)} typical / ~$${estWorstUsd.toFixed(2)} worst-case\n`,
  );
  output.write(`Route-shape files:   ${routeShapeNote}\n`);
  output.write(
    `                     Estimate accounts for route-shape files that trigger additional analysis.\n`,
  );
  output.write(
    `Estimated runtime:   ~${formatRuntime(estRuntimeSec)} (worst case)\n`,
  );

  // Load-bearing UX: show what we are NOT scanning, with rule
  // attribution, BEFORE the cost-confirmation prompt. A customer who
  // sees their first-party `vendor/` or `out/` dir on this list can
  // abort here, before any LLM call. Mitigates the silent-fail class
  // where Fixor returns "0 findings" because it never scanned the code.
  if (skippedDirs.length > 0) {
    const byRule = { "default-skip": 0, gitignore: 0 };
    const defaultExamples: string[] = [];
    const gitignoreExamples: string[] = [];
    for (const s of skippedDirs) {
      byRule[s.rule]++;
      if (s.rule === "default-skip" && defaultExamples.length < 5) {
        defaultExamples.push(s.path);
      } else if (s.rule === "gitignore" && gitignoreExamples.length < 5) {
        gitignoreExamples.push(s.path);
      }
    }
    if (byRule["default-skip"] > 0) {
      const more =
        byRule["default-skip"] > defaultExamples.length
          ? `, +${byRule["default-skip"] - defaultExamples.length} more`
          : "";
      output.write(
        `Skipped (default):   ${byRule["default-skip"]} dirs (${defaultExamples.join(", ")}${more})\n`,
      );
    }
    if (byRule.gitignore > 0) {
      const more =
        byRule.gitignore > gitignoreExamples.length
          ? `, +${byRule.gitignore - gitignoreExamples.length} more`
          : "";
      output.write(
        `Skipped (gitignore): ${byRule.gitignore} dirs (${gitignoreExamples.join(", ")}${more})\n`,
      );
    }
  }
  // Loud warning when .gitignore had !negation patterns: the walker
  // does not honor negation today, so any file the customer intended
  // to re-include is silently dropped. Surfacing here gives them a
  // chance to abort before paying for an incomplete scan.
  if (ignoredNegations.length > 0) {
    const shown = ignoredNegations.slice(0, 5);
    const more =
      ignoredNegations.length > shown.length
        ? `, +${ignoredNegations.length - shown.length} more`
        : "";
    output.write(
      `\nWARNING: .gitignore has ${ignoredNegations.length} !negation pattern(s) that Fixor does not honor.\n` +
        `         Files those patterns would re-include inside skipped dirs are silently dropped.\n` +
        `         Patterns ignored: ${shown.join(", ")}${more}\n`,
    );
  }
  output.write(`\n`);

  if (opts.assumeYes) {
    output.write('Proceed? --yes flag set, skipping confirmation.\n\n');
  } else {
    const proceed = await confirm('Proceed? Type "yes" to continue: ');
    if (!proceed) {
      logger.info("Aborted by user.");
      return;
    }
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
      //    Suppressed types (see src/config/finding-suppressions.ts) are
      //    dropped at the boundary so the report mirrors what the webhook
      //    would deliver to a customer.
      const central = await analyzeCode(diff);
      const centralFindings = central.findings.filter(
        (f) => !isSuppressedFindingType(f.type),
      );
      allFindings.push(...centralFindings);

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

    const merged = suppressAdminCheckWhereAuthBypass(dedupeFindings(allFindings));
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
