import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { logger } from "../lib/logger.js";
import {
  DETECTORS,
  SHIPPING_DETECTOR_IDS,
} from "../analysis-engine/detectors/registry.js";
import {
  APP_ROUTER_ROUTE_DEF_RE,
  EXPRESS_ROUTE_DEF_RE,
  REMIX_HANDLER_DEF_RE,
  FASTAPI_ROUTE_DEF_RE,
  FLASK_ROUTE_DEF_RE,
  isRemixRoutePath,
  isPythonPath,
} from "../analysis-engine/detectors/shared/route-def-pattern.js";
import { resolveRemixRouteGuard } from "../analysis-engine/detectors/shared/route-guard-resolver.js";
import { SIDECAR_KINDS } from "../analysis-engine/sidecar-kinds.js";
import type { DetectorContext } from "../analysis-engine/detector.types.js";
import type { NormalizedFinding } from "../analysis-engine/detector.types.js";
import type { Finding } from "../analysis-engine/types.js";
import {
  coverageExitCode,
  llmCoverageSince,
  snapshotLlmCoverage,
} from "../lib/llm-coverage.js";
import { errText } from "../lib/err-text.js";
import { walkFiles } from "./file-walker.js";
import { buildSyntheticDiff } from "./diff-builder.js";
import {
  buildMarkdownReport,
  countCoverageDegradations,
  type FileScanResult,
} from "./report-builder.js";
import { collapseFindings } from "./finding-merge.js";

const DEFAULT_EXTENSIONS = ["ts", "tsx", "js", "jsx", "py", "go"];
const DELAY_MS = 1500;            // between files
const SUB_DELAY_MS = 800;         // between LLM-hitting detector calls within a file

// Cost model — corpus-shape-aware, not a flat per-file constant.
//
// A file that matches the route-shape prefilter (Next.js App Router
// HTTP-method-named export, Express-family router.METHOD(...), or
// Remix v2 loader/action export inside /routes/) routes to 3
// detectors' LLM stages: auth-bypass, admin-check, and
// webhook-unverified — all three
// ship whole-file context for App Router AND Remix route-def triggers
// (webhook joined this discipline 2026-05-23 in the Path-A structural
// follow-up to Phase F; Remix joined 2026-05-23 in Phase E; see
// project_fixor_webhook_payload_structural_followup and
// project_fixor_phase_e_remix_extension memories). Non-App-Router /
// non-Remix webhook triggers (express/flask/rails/go URL-name
// patterns) keep windowed payload because their prefilter signals are
// local. Pre-Phase-B the prefilters short-circuited most files; the
// flat $0.012/$0.024 constants encoded that assumption and
// undercounted App Router corpora ~2-3x at Phase D.
//
// Phase E (2026-05-23) consistency: Remix-shape files count exactly
// once when matched, only when isRemixRoutePath returns true. This
// mirrors the detector-side path filter so the estimator and runtime
// agree on which files trigger the 3-extra-call multiplier. A file
// matching multiple route-def regexes (e.g., both Next.js and Remix
// shapes in the same file during a framework migration) short-circuits
// via OR and counts once — matches detector behavior where each
// detector picks one route-def trigger per file regardless of trigger
// count.
//
// PER_CALL_COST_USD is Sonnet 4.6 empirical from the Phase D 182-file
// inbox-zero burn (~$0.007-0.010 per call); $0.012 leaves headroom on
// the never-below side per operator rule for a customer-facing estimate.
// Path-A's whole-file payload on webhook for App Router triggers raises
// the empirical average modestly (typical webhook handlers are small —
// 3-5KB measured against inbox-zero); the $0.012 buffer continues to
// absorb the rise without underestimating. A future re-baseline after
// Path-A is in production would refine this number; not blocking.
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

// Specialized detectors with a detect() pass — the only LLM-calling
// detectors that run on this path since H3 removed the central
// analyzeCode call (its SQL/XSS/CMDI/PT output is suppressed). The
// fix-only detectors for those families remain in DETECTORS but have
// no detect() pass, so iterating by id-allowlist (the shared
// SHIPPING_DETECTOR_IDS set from the registry) selects only the active
// ones.
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

interface CliOpts {
  repoPath: string;
  outputPath?: string;
  extensions: Set<string>;
  /** When true, skip the interactive cost/runtime confirmation prompt.
   *  Set via `--yes` (or `-y`). Required for any non-TTY caller — CI,
   *  piped scripts, smoke tests — that would otherwise block forever
   *  on `readline.question`. */
  assumeYes: boolean;
  /** When true (`--no-suggested-fix`), omit the per-finding remediation line
   *  and scope the report to detection. Used for the public proof corpus. */
  omitSuggestedFix: boolean;
}

function parseArgs(argv: string[]): CliOpts | null {
  const args = argv.slice(2);
  if (args.length === 0) return null;
  let repoPath: string | null = null;
  let outputPath: string | undefined;
  let extensions = new Set(DEFAULT_EXTENSIONS);
  let assumeYes = false;
  let omitSuggestedFix = false;
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
    } else if (a === "--no-suggested-fix") {
      omitSuggestedFix = true;
    } else if (!a.startsWith("--")) {
      if (!repoPath) repoPath = a;
    }
  }
  if (!repoPath) return null;
  return {
    repoPath: resolve(repoPath),
    outputPath,
    extensions,
    assumeYes,
    omitSuggestedFix,
  };
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
      // Python (slices FastAPI 1/1b + Flask): mirror the detectors'
      // lang-gating — on `.py`, count the FastAPI decorator shorthand and
      // the Flask `@app.route` decorator. (Before this, the estimator
      // under-counted Flask route files because EXPRESS_ROUTE_DEF_RE only
      // coincidentally matched FastAPI's `router.get(`, never `.route`.)
      if (isPythonPath(path)) {
        return FASTAPI_ROUTE_DEF_RE.test(c) || FLASK_ROUTE_DEF_RE.test(c);
      }
      // Phase E (2026-05-23): Remix v2 `loader`/`action` exports count
      // as route-shape only when the file sits in a Remix v2 route
      // position (`/routes/` segment, or `app/root.{ts,tsx}`). This
      // mirrors the detector-side path-aware filter so the estimator
      // does not over-count utility modules that happen to export
      // `loader` or `action`.
      return (
        APP_ROUTER_ROUTE_DEF_RE.test(c) ||
        EXPRESS_ROUTE_DEF_RE.test(c) ||
        (REMIX_HANDLER_DEF_RE.test(c) && isRemixRoutePath(path))
      );
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
  // H3: the central analyzeCode call (formerly one unconditional LLM
  // call per file — `files.length * PER_CALL_COST_USD`) was removed
  // because its output is 100% suppressed. The remaining cost is the
  // specialized detectors, which only call the LLM when their pre-
  // filter fires: route-shape files trigger 3 route detectors; the 3
  // content-prefilter detectors (secrets/env/idor) are the worst-case
  // upper bound (most files short-circuit before any LLM call).
  const routeShapeUsd =
    routeShape.count * ROUTE_SHAPE_EXTRA_DETECTORS * PER_CALL_COST_USD;
  const contentMaxUsd =
    files.length * CONTENT_PREFILTER_DETECTORS * PER_CALL_COST_USD;
  const estTypicalUsd = routeShapeUsd;
  const estWorstUsd = routeShapeUsd + contentMaxUsd;
  // Worst-case runtime: per file = DELAY_MS sleep + up to N specialized
  // detectors × (~3s LLM + SUB_DELAY_MS sleep). No central call.
  const estRuntimeSec =
    files.length *
    (DELAY_MS / 1000 + newDetectors.length * (3 + SUB_DELAY_MS / 1000));

  const routeShapeNote = routeShape.sampled
    ? `${routeShape.count} (estimated from ${routeShape.sampleSize}-file sample; each triggers 3 additional LLM calls)`
    : `${routeShape.count} (each triggers 3 additional LLM calls)`;

  output.write(`\nFiles to scan:       ${files.length}\n`);
  output.write(
    `Detectors per file:  ${newDetectors.length} specialized (pre-filtered; no central pass)\n`,
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

  // Coverage integrity: snapshot the LLM tally for the whole scan and
  // per file, so failed detection calls surface in the report (banner +
  // per-file gaps) and the exit code instead of silently reading as
  // "no findings". See src/lib/llm-coverage.ts for the defect history.
  const scanSnap = snapshotLlmCoverage();

  const results: FileScanResult[] = [];
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i]!;
    const rel = relative(opts.repoPath, filePath);
    const fileSnap = snapshotLlmCoverage();
    logger.info(
      {
        file: rel,
        index: i + 1,
        total: files.length,
        detectors: newDetectors.length,
      },
      "scanning (N specialized detectors)",
    );

    const allFindings: Finding[] = [];
    const detectorFailures: Array<{ detectorId: string; reason: string }> = [];
    let notAnalyzed: { stage: string; reason: string } | undefined;
    // Names the stage the outer catch caught, so a report can distinguish an
    // unreadable file from a route-guard resolution that blew up. The catch
    // has always spanned more than the read.
    let stage = "read";
    try {
      const content = readFileSync(filePath, "utf8");
      stage = "build-diff";
      const diff = buildSyntheticDiff(rel, content);

      // Phase G: resolve any cross-file parent-layout auth guard for
      // Remix/RR v7 routes (read above the scan root via the absolute
      // path), so auth-bypass/admin-check can recognize a route gated by
      // an ancestor `_layout.tsx` loader instead of false-positiving.
      stage = "resolve-route-guard";
      const guardBody = resolveRemixRouteGuard(filePath);
      stage = "detect";
      const detectorCtx: DetectorContext = guardBody
        ? {
            diff,
            sidecarsByPath: {
              [rel]: { [SIDECAR_KINDS.ROUTE_GUARD]: guardBody },
            },
          }
        : { diff };

      // Specialized detectors only. The central LLM analyzer
      // (analyzeCode) was removed from this path in H3 (Phase H): every
      // finding type it can emit (sql/xss/cmdi/path-traversal) is
      // suppressed at the customer boundary
      // (src/config/finding-suppressions.ts), so its output was 100%
      // discarded — one unconditional LLM call per file paying for
      // nothing. See analyze.ts for the re-enable conditions.
      //
      // Specialized detectors. Each has its own pre-filter +
      //    LLM gate; most short-circuit on path/regex misses, so the
      //    extra cost is small.
      for (const detector of newDetectors) {
        if (!detector.detect) continue;
        try {
          const dFindings = await detector.detect(detectorCtx);
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
          // A detector that threw contributed zero findings for a reason
          // that has nothing to do with the code under scan, so its silence
          // carries no information. Recorded as a named casualty (file +
          // detector id) and counted toward degraded coverage; logging it
          // and continuing was a null-and-continue path.
          detectorFailures.push({
            detectorId: detector.id,
            reason: errText(err),
          });
          logger.error(
            { err, detector: detector.id, file: rel },
            "detector FAILED; file not fully analyzed by this detector",
          );
        }
      }
    } catch (err) {
      // The file contributed nothing and was never analyzed. It must not be
      // counted as scanned, and its zero findings must never read as clean.
      notAnalyzed = { stage, reason: errText(err) };
      logger.error(
        { err, file: rel, stage },
        "file NOT ANALYZED: scan aborted for this file",
      );
    }

    const merged = collapseFindings(allFindings);
    const fileCov = llmCoverageSince(fileSnap);
    if (fileCov.failed > 0) {
      logger.error(
        { file: rel, failed: fileCov.failed, byReason: fileCov.byReason },
        "file NOT fully analyzed: LLM detection call(s) failed",
      );
    }
    results.push({
      filePath: rel,
      findings: merged,
      llmFailures: fileCov.failed,
      llmFailuresByReason: fileCov.byReason,
      ...(notAnalyzed ? { notAnalyzed } : {}),
      ...(detectorFailures.length > 0 ? { detectorFailures } : {}),
    });

    if (i < files.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  const coverage = llmCoverageSince(scanSnap);

  const reportPath = opts.outputPath ?? defaultReportPath();
  const markdown = buildMarkdownReport(opts.repoPath, results, {
    omitSuggestedFix: opts.omitSuggestedFix,
    coverage,
  });
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

  const filesNotAnalyzed = results.filter((r) => r.notAnalyzed);
  const failedDetectorRuns = results.reduce(
    (n, r) => n + (r.detectorFailures?.length ?? 0),
    0,
  );
  const degradations = countCoverageDegradations(results, coverage);

  logger.info(
    {
      reportPath,
      totalFindings,
      filesEnumerated: results.length,
      filesAnalyzed: results.length - filesNotAnalyzed.length,
      byType: countsByType,
      llmCallsAttempted: coverage.attempted,
      llmCallsFailed: coverage.failed,
      filesNotAnalyzed: filesNotAnalyzed.length,
      failedDetectorRuns,
    },
    "scan complete",
  );

  // Exit 2 on degraded coverage so CI/automation can never mistake a
  // partially-blind run for a clean one. The report is still written
  // (partial findings are real); only the "clean" claim is withheld.
  //
  // Three channels reach this gate, not one: a failed LLM detection call, a
  // file whose analysis aborted, and a detector that threw. Previously only
  // the first could, so a run that read no files at all exited 0 while the
  // report asserted full coverage. Every casualty is named in the log and in
  // the report; the count is only how the exit code is chosen.
  if (degradations > 0) {
    logger.error(
      {
        degradations,
        llmCallsFailed: coverage.failed,
        llmCallsAttempted: coverage.attempted,
        byReason: coverage.byReason,
        filesNotAnalyzed: filesNotAnalyzed.map((r) => r.filePath),
        failedDetectorRuns,
      },
      "scan coverage DEGRADED — report must not be read as a clean result (exit 2)",
    );
    process.exitCode = coverageExitCode(degradations);
  }
}

main().catch((err) => {
  logger.error({ err }, "scan crashed");
  process.exit(1);
});
