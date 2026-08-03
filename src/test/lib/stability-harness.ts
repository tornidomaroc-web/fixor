/**
 * Shared stability harness for per-detector accuracy validation.
 *
 * Replaces the n=1 single-pass pattern used by the original Phase 3-5
 * detector harnesses. The contract:
 *   - each fixture runs N_RUNS times (default 5)
 *   - per-iteration reasoning is printed so calibration sessions can
 *     audit *why* the LLM produced its verdict, not just *what*
 *   - sidecar files next to a fixture (`<fixture>.schema.prisma`,
 *     `<fixture>.policy.sql`, `<fixture>.middleware.ts`, ...) are
 *     loaded and injected into the DetectorContext via sidecarsByPath
 *   - per-fixture stability thresholds (e.g. 4/5 for positives, 5/5
 *     for negatives) gate per-fixture PASS/FAIL
 *   - aggregate detector thresholds (e.g. 7/10 positives passing) gate
 *     overall detector PASS/FAIL
 *   - any LLM error fails the run (a pre-filter skip that masquerades
 *     as a "pass" on a negative is the failure mode this guards against)
 *
 * Rules enforced by this harness (see docs/detector-test-rules.md):
 *   R1 single-pass is not real accuracy
 *   R2 reasoning logs printed every iteration
 *   R3 n=5 resolution caveat is responsibility of the report consumer
 *   R4 pre-filter SKIP is not a cognitive pass (tracked separately)
 *
 * Sidecar conventions (extension → kind):
 *   .schema.prisma   → "prisma-schema"
 *   .policy.sql      → "rls-policy"
 *   .middleware.ts   → "middleware"
 *   .config.ts       → "config"
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type {
  Detector,
  DetectorContext,
  NormalizedFinding,
} from "../../analysis-engine/detector.types";
import {
  SIDECAR_EXT_TO_KIND,
  SIDECAR_EXTS,
  SIDECAR_KINDS,
} from "../../analysis-engine/sidecar-kinds";
import {
  llmCallsSince,
  snapshotLlmCalls,
} from "../../lib/llm-call-ledger";
import {
  llmCoverageSince,
  snapshotLlmCoverage,
} from "../../lib/llm-coverage";
import { lfNormalize } from "../replay-harness";

/** Diagnostic shape every Phase 3-5 detector exposes via lastDiagnostics. */
interface DetectorDiag {
  preFilterReason?: string;
  verdict?: {
    isVulnerable: boolean;
    confidence: string;
    reasoning: string;
  } | null;
}

interface DetectorWithDiagnostics extends Detector {
  lastDiagnostics: DetectorDiag[];
}

export interface RunResult {
  flagged: boolean;
  preFilterReason?: string;
  verdict?: DetectorDiag["verdict"];
}

export interface FixtureStability {
  file: string;
  isPositive: boolean;
  runs: RunResult[];
  flaggedCount: number;
  /**
   * OBSERVED at the callClaude chokepoint via the call ledger, not inferred.
   * Counts EVERY call the fixture caused, including the H8 escalation second
   * call that the previous inference could not see.
   */
  llmCalls: number;
  /**
   * Calls that produced no usable verdict. Union of two distinct failures:
   * a transport failure (callClaude returned not-ok) and a parse failure (the
   * call succeeded but the tool input was malformed, which every detector
   * turns into a null verdict). Kept as a union deliberately: dropping the
   * parse half would LOOSEN the gate, because a negative that "passes" with no
   * verdict behind it is exactly the hollow pass this harness guards against.
   */
  llmErrors: number;
  /** Transport-level failures only, observed via the coverage tally. */
  observedFailedCalls: number;
  /** Calls that returned real usage. Unpriced ones are replayed or failed. */
  pricedCalls: number;
  /**
   * Sum of the REAL per-call USD for this fixture, from the ledger, computed
   * from real message.usage. Includes any escalation call. Zero when every
   * call was unpriced (replayed, failed, or a canned zero-token response).
   * This is a MEASURED figure, never a constant times a count.
   */
  measuredCostUsd: number;
}

export interface StabilityReport {
  positives: FixtureStability[];
  negatives: FixtureStability[];
  positivesPassed: number;
  negativesPassed: number;
  totalLlmCalls: number;
  totalLlmErrors: number;
  /** Transport-level failures only, observed via the coverage tally. */
  totalObservedFailedCalls: number;
  /** Calls that returned real usage, observed via the call ledger. */
  totalPricedCalls: number;
  /**
   * Sum of the REAL per-call USD across all fixtures, from the ledger. This is
   * the harness's primary cost figure whenever calls were priced: no constant
   * participates. Zero on a fully unpriced run (replay or canned).
   */
  totalMeasuredCostUsd: number;
  /**
   * Legacy field, retained so downstream types do not break. It now holds ONLY
   * the would-cost-live PROJECTION on a fully-unpriced run when a projection
   * rate was supplied, and 0 otherwise. It is NOT a measured cost and is NOT
   * the primary figure. When calls are priced, read totalMeasuredCostUsd. A
   * projection is what a run WOULD cost live; an unpriced run's actual spend is
   * always $0.00 because no API call was made.
   */
  estimatedCostUsd: number;
  passed: boolean;
}

/**
 * Thrown when a run's MEASURED spend crosses the ceiling supplied for it.
 *
 * THROWN, NEVER RETURNED, and that is the whole point. Returning a truncated
 * StabilityReport would push a partial corpus through the normal PASS/FAIL
 * computation, and a run that stopped early could then print PASS: a brand-new
 * false-green surface inside the one gate whose entire job is to prevent them.
 * Throwing exits the entry point non-zero, which the stage-3 workflow's EXIT
 * trap already handles, reporting the abort with spend-so-far preserved (that
 * path was proven live by rehearsal (b)).
 */
export class SpendCeilingExceeded extends Error {
  readonly spentUsd: number;
  readonly ceilingUsd: number;
  constructor(spentUsd: number, ceilingUsd: number) {
    super(
      `SPEND CEILING EXCEEDED: MEASURED $${spentUsd.toFixed(4)} crossed the ` +
        `$${ceilingUsd.toFixed(4)} ceiling supplied for this run. Aborted before ` +
        `the next call. This figure is real summed cost from the call ledger, ` +
        `never a projection.`,
    );
    this.name = "SpendCeilingExceeded";
    this.spentUsd = spentUsd;
    this.ceilingUsd = ceilingUsd;
  }
}

/**
 * Run-wide MEASURED spend accumulator with an OPTIONAL ceiling.
 *
 * Inert when `ceilingUsd` is undefined: it still tracks, `check()` never
 * throws, and no existing caller changes behavior by even one byte. Same
 * deliberate asymmetry as `costPerLlmCallUsd`, which refuses a numeric default
 * for the same reason — a made-up default is how a guard starts lying.
 */
class SpendGuard {
  spentUsd = 0;
  constructor(readonly ceilingUsd: number | undefined) {}
  add(usd: number): void {
    this.spentUsd += usd;
  }
  check(): void {
    if (this.ceilingUsd !== undefined && this.spentUsd > this.ceilingUsd) {
      throw new SpendCeilingExceeded(this.spentUsd, this.ceilingUsd);
    }
  }
}

/**
 * Resolve the ceiling from an explicit option, else from FIXOR_HALT_USD.
 *
 * ABSENT IS INERT; SET-BUT-UNUSABLE THROWS. A typo'd ceiling that silently
 * meant "no ceiling" would be fail-OPEN, which is the exact shape of the bug
 * the stage-3 workflow already carries a case for: a secret of " " is non-empty
 * to `-z`, so it cleared the old guard and proceeded to spend. Unset the var to
 * disable the ceiling; do not pass it something unparseable and hope.
 */
export function resolveSpendCeilingUsd(
  explicit: number | undefined,
  env: string | undefined,
): number | undefined {
  if (explicit !== undefined) {
    if (!Number.isFinite(explicit) || explicit <= 0) {
      throw new Error(
        `haltAboveUsd must be a positive finite number; got ${String(explicit)}.`,
      );
    }
    return explicit;
  }
  if (env === undefined) return undefined;
  const trimmed = env.trim();
  if (trimmed === "") {
    throw new Error(
      "FIXOR_HALT_USD is set but empty or whitespace-only. Unset it to disable " +
        "the ceiling, or give it a positive number. A blank ceiling is not a " +
        "disabled ceiling; it is an unstated one.",
    );
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `FIXOR_HALT_USD must be a positive finite number; got "${env}".`,
    );
  }
  return n;
}

export interface HarnessOptions {
  /** For log headers. */
  detectorName: string;
  /** e.g. "fixtures/admin-check"; the harness reads positive/ and negative/ subdirs. */
  fixturesDir: string;
  /** Detector instance with a detect() method and lastDiagnostics array. */
  detector: DetectorWithDiagnostics;
  /** Stability sample size per fixture. Default 5. */
  nRuns?: number;
  /** Per-fixture stability threshold for positives (flagged >= K of N). Default nRuns-1. */
  perPositiveThreshold?: number;
  /** Per-fixture stability threshold for negatives (correctly-skipped == K of N). Default nRuns. */
  perNegativeThreshold?: number;
  /** Aggregate: at least this many positives must hit per-fixture threshold. Default = all positives. */
  positivesMinPassing?: number;
  /** Aggregate: at least this many negatives must hit per-fixture threshold. Default = all negatives. */
  negativesMinPassing?: number;
  /** Optional combined gate. Default = positivesMinPassing + negativesMinPassing. */
  combinedMinPassing?: number;
  /** Sleep between iterations to space out API calls. Default 800ms. */
  sleepMsBetween?: number;
  /**
   * PROJECTION rate for the would-cost-live line on an UNPRICED run only. When
   * calls are priced the harness reports the ledger's real summed cost and this
   * value is not consulted. There is NO numeric default: absent rate means no
   * projection line is printed. This is deliberate. A single default cannot be
   * right for both idor (measured warm 0.0115263, see the idor per-call
   * measurement) and the four detectors that pass 0.00828, so a made-up default
   * would reintroduce exactly the flat-constant defect this reporting change
   * removes. The two idor entry points that pass nothing therefore print no
   * projection until 0.0115263 is supplied deliberately.
   */
  costPerLlmCallUsd?: number;
  /**
   * OPTIONAL hard ceiling on this run's MEASURED spend, in USD. When the
   * ledger's real summed cost crosses it the run throws SpendCeilingExceeded
   * before issuing another call, so overshoot is bounded to a single call.
   *
   * NO DEFAULT, and absent means inert — every existing entry point behaves
   * exactly as before. Falls back to the FIXOR_HALT_USD env var when not
   * passed, which is how the stage-3 workflow supplies it.
   *
   * WHAT THIS BOUNDS, STATED PLAINLY so it is not over-read. It bounds the
   * MAGNITUDE OF ONE RUN. It does NOT bound the NUMBER of runs: two dispatches
   * each carry their own ceiling, so two runs under a $1.00 ceiling can spend
   * $2.00 between them and neither halts. Single-spend still rests on
   * dispatching once. Anyone citing this guard as a reason to relax the
   * dispatch discipline is citing it for something it does not do.
   */
  haltAboveUsd?: number;
  /** Optional fingerprint string to print in the run header. */
  systemPromptFingerprint?: string;
}

export function loadFixture(filepath: string): {
  assumedPath: string;
  content: string;
} {
  const raw = readFileSync(filepath, "utf8");
  const lines = raw.split(/\r?\n/);
  const isShebang = (lines[0] ?? "").startsWith("#!");
  const headerIdx = isShebang ? 1 : 0;
  const headerLine = lines[headerIdx] ?? "";
  const m = headerLine.match(/(?:\/\/|#)\s*ASSUMED-PATH:\s*(.+?)\s*$/);
  const assumedPath = m
    ? m[1]!
    : `src/app/handlers/unknown/${basename(filepath)}`;
  if (m) lines.splice(headerIdx, 1);
  // Strip any consecutive `// SIDECAR:` / `# SIDECAR:` header lines so
  // they don't reach the LLM. Markers are human-auditor metadata; the
  // sidecar BODY reaches the LLM via the addendum-labeled block. Same
  // discipline as ASSUMED-PATH.
  while (
    lines[headerIdx] !== undefined &&
    /^\s*(?:\/\/|#)\s*SIDECAR:/i.test(lines[headerIdx]!)
  ) {
    lines.splice(headerIdx, 1);
  }
  return { assumedPath, content: lines.join("\n") };
}

export function buildSyntheticDiff(filePath: string, content: string): string {
  const lines = content.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const N = lines.length;
  const header =
    `diff --git a/${filePath} b/${filePath}\n` +
    `new file mode 100644\n` +
    `--- /dev/null\n` +
    `+++ b/${filePath}\n` +
    `@@ -0,0 +1,${N} @@\n`;
  const body = lines.map((l) => "+" + l).join("\n");
  return header + body + "\n";
}

/**
 * Loads sibling sidecar files for a fixture and returns a kind→body map.
 * E.g. `negative/foo.ts` may have `negative/foo.schema.prisma` next to it;
 * the return is `{ "prisma-schema": "<schema body>" }`.
 */
export function loadFixtureSidecars(
  fixturePath: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  // Strip outermost extension only (so foo.ts → foo, not foo.schema.prisma → foo.schema)
  const base = fixturePath.replace(/\.[^.\\/]+$/, "");
  for (const ext of SIDECAR_EXTS) {
    const sidecarPath = base + ext;
    if (existsSync(sidecarPath)) {
      const kind = SIDECAR_EXT_TO_KIND[ext]!;
      out[kind] = lfNormalize(readFileSync(sidecarPath, "utf8"));
    }
  }
  return out;
}

function isFixtureFile(name: string): boolean {
  if (name.startsWith(".")) return false;
  if (name.endsWith(".md")) return false;
  // .disabled suffix temporarily excludes a fixture or sidecar without
  // deletion; restore by renaming. Used by the Day 5 sidecar falsifier.
  if (name.endsWith(".disabled")) return false;
  for (const ext of SIDECAR_EXTS) {
    if (name.endsWith(ext)) return false;
  }
  return true;
}

async function stabilityRunDir(
  dir: string,
  isPositive: boolean,
  opts: Required<
    Pick<HarnessOptions, "nRuns" | "sleepMsBetween">
  > &
    Pick<HarnessOptions, "detector"> & { guard: SpendGuard },
): Promise<FixtureStability[]> {
  const files = readdirSync(dir).filter(isFixtureFile).sort();
  const out: FixtureStability[] = [];

  for (const file of files) {
    const filepath = join(dir, file);
    const { assumedPath, content } = loadFixture(filepath);
    const sidecars = loadFixtureSidecars(filepath);
    const diff = buildSyntheticDiff(assumedPath, content);

    const ctx: DetectorContext = { diff };
    if (Object.keys(sidecars).length > 0) {
      ctx.sidecarsByPath = { [assumedPath]: sidecars };
      // Backwards-compat: also populate prismaSchemasByPath if a
      // prisma-schema sidecar is present, so detectors still reading
      // the old channel (e.g. Mass-Assignment Phase 1a) keep working.
      if (sidecars[SIDECAR_KINDS.PRISMA_SCHEMA]) {
        ctx.prismaSchemasByPath = {
          [assumedPath]: sidecars[SIDECAR_KINDS.PRISMA_SCHEMA],
        };
      }
    }

    const runs: RunResult[] = [];
    let llmCalls = 0;
    let llmErrors = 0;
    let observedFailedCalls = 0;
    let pricedCalls = 0;
    let measuredCostUsd = 0;

    for (let i = 0; i < opts.nRuns; i++) {
      let result: RunResult = { flagged: false };
      // Snapshot BOTH instruments around the call so the counts are observed
      // rather than reconstructed from diagnostics afterwards.
      const ledgerBefore = snapshotLlmCalls();
      const coverageBefore = snapshotLlmCoverage();
      try {
        const findings: NormalizedFinding[] = opts.detector.detect
          ? await opts.detector.detect(ctx)
          : [];
        const diag = opts.detector.lastDiagnostics[0];
        result = {
          flagged: findings.length > 0,
          preFilterReason: diag?.preFilterReason,
          verdict: diag?.verdict ?? null,
        };
        const ledger = llmCallsSince(ledgerBefore);
        const coverage = llmCoverageSince(coverageBefore);
        llmCalls += ledger.calls;
        pricedCalls += ledger.pricedCalls;
        // Real summed cost for this run, straight from the ledger. Includes the
        // escalation call. Zero when the calls were unpriced.
        measuredCostUsd += ledger.costUsd;
        observedFailedCalls += coverage.failed;
        // A call happened but yielded no verdict: transport failure OR parse
        // failure. Both make any pass on this fixture hollow.
        if (ledger.calls > 0 && !diag?.verdict) llmErrors++;
      } catch (err) {
        result = {
          flagged: false,
          preFilterReason: `error: ${(err as Error).message}`,
        };
      }

      // Run-wide MEASURED spend for the ceiling, read from the ledger OUTSIDE
      // the try above. Two reasons, both load-bearing:
      //
      //   1. The catch above swallows EVERY error into an "error:" result. A
      //      ceiling breach raised inside that try would be caught, relabelled
      //      as a fixture error, and the run would CONTINUE SPENDING. The guard
      //      would appear to exist and would never stop anything.
      //   2. A detector that throws mid-call still spent. The in-try
      //      accumulation below is skipped on that path, so a guard fed from it
      //      would under-count exactly when things are going wrong.
      //
      // `llmCallsSince` is a pure delta from `ledgerBefore`, so reading it a
      // second time here cannot double-count: the in-try read feeds the
      // per-fixture report figure and is left untouched, this one feeds only
      // the ceiling.
      opts.guard.add(llmCallsSince(ledgerBefore).costUsd);

      runs.push(result);

      const mark = result.flagged ? "FLAG" : "skip";
      const detail = result.preFilterReason
        ? `pre-filter:${result.preFilterReason}`
        : result.verdict
          ? `LLM:${result.verdict.isVulnerable ? "vuln" : "safe"}/${result.verdict.confidence}`
          : "no-verdict";
      process.stdout.write(
        `  [${file}][run ${i + 1}/${opts.nRuns}] ${mark}  ${detail}\n`,
      );
      if (result.verdict?.reasoning) {
        process.stdout.write(
          `      reasoning: ${result.verdict.reasoning}\n`,
        );
      }

      // Checked PER ITERATION rather than per fixture, so overshoot past the
      // ceiling is bounded to a single call. Placed after the iteration's log
      // lines so the transcript shows the call that crossed it, and before the
      // sleep so an aborting run does not idle first.
      opts.guard.check();

      if (i < opts.nRuns - 1 || file !== files[files.length - 1]) {
        await sleep(opts.sleepMsBetween);
      }
    }

    const flaggedCount = runs.filter((r) => r.flagged).length;
    out.push({
      file,
      isPositive,
      runs,
      flaggedCount,
      llmCalls,
      llmErrors,
      observedFailedCalls,
      pricedCalls,
      measuredCostUsd,
    });

    process.stdout.write(
      `  -> ${file}: flagged ${flaggedCount}/${opts.nRuns}` +
        (llmErrors > 0 ? `  [LLM errors: ${llmErrors}]` : "") +
        `\n\n`,
    );
  }

  return out;
}

export async function runStabilityHarness(
  opts: HarnessOptions,
): Promise<StabilityReport> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Export it before running this test.",
    );
  }

  const nRuns = opts.nRuns ?? 5;
  const perPositiveThreshold = opts.perPositiveThreshold ?? nRuns - 1;
  const perNegativeThreshold = opts.perNegativeThreshold ?? nRuns;
  const sleepMsBetween = opts.sleepMsBetween ?? 800;
  // No numeric default: absent rate means no would-cost-live projection is
  // printed, rather than a fabricated constant. See HarnessOptions.
  const costPerLlmCallUsd = opts.costPerLlmCallUsd;
  // Resolved BEFORE any fixture runs, so a malformed ceiling fails the run
  // before it can spend rather than after. ONE guard spans positives and
  // negatives: a per-directory guard would silently double the real ceiling.
  const ceilingUsd = resolveSpendCeilingUsd(
    opts.haltAboveUsd,
    process.env.FIXOR_HALT_USD,
  );
  const guard = new SpendGuard(ceilingUsd);

  process.stdout.write(
    `${opts.detectorName} stability run (n=${nRuns} per fixture)\n` +
      (opts.systemPromptFingerprint
        ? `SYSTEM_PROMPT fingerprint: ${opts.systemPromptFingerprint}\n`
        : "") +
      `Per-fixture thresholds: positives flagged >= ${perPositiveThreshold}/${nRuns}, ` +
      `negatives correctly-skipped == ${perNegativeThreshold}/${nRuns}\n` +
      (ceilingUsd !== undefined
        ? `Spend ceiling: $${ceilingUsd.toFixed(4)} MEASURED. Aborts before the ` +
          `next call; bounds THIS run only, not the number of runs.\n`
        : "") +
      "\n",
  );

  process.stdout.write("Positives (should be flagged):\n");
  const positives = await stabilityRunDir(
    join(opts.fixturesDir, "positive"),
    true,
    { nRuns, sleepMsBetween, detector: opts.detector, guard },
  );

  process.stdout.write("\nNegatives (should NOT be flagged):\n");
  const negatives = await stabilityRunDir(
    join(opts.fixturesDir, "negative"),
    false,
    { nRuns, sleepMsBetween, detector: opts.detector, guard },
  );

  const positivesMinPassing = opts.positivesMinPassing ?? positives.length;
  const negativesMinPassing = opts.negativesMinPassing ?? negatives.length;
  const combinedMinPassing =
    opts.combinedMinPassing ?? positivesMinPassing + negativesMinPassing;

  process.stdout.write("\n=== STABILITY REPORT ===\n");
  let positivesPassed = 0;
  for (const r of positives) {
    const ok = r.flaggedCount >= perPositiveThreshold;
    if (ok) positivesPassed++;
    process.stdout.write(
      `  pos ${r.file}: flagged ${r.flaggedCount}/${nRuns} ` +
        `${ok ? "PASS" : "FAIL"}\n`,
    );
  }
  let negativesPassed = 0;
  for (const r of negatives) {
    const correctlySkipped = nRuns - r.flaggedCount;
    const ok = correctlySkipped >= perNegativeThreshold;
    if (ok) negativesPassed++;
    process.stdout.write(
      `  neg ${r.file}: correctly-skipped ${correctlySkipped}/${nRuns} ` +
        `${ok ? "PASS" : "FAIL"}\n`,
    );
  }

  const totalLlmCalls = [...positives, ...negatives].reduce(
    (s, r) => s + r.llmCalls,
    0,
  );
  const totalLlmErrors = [...positives, ...negatives].reduce(
    (s, r) => s + r.llmErrors,
    0,
  );
  const totalObservedFailedCalls = [...positives, ...negatives].reduce(
    (s, r) => s + r.observedFailedCalls,
    0,
  );
  const totalPricedCalls = [...positives, ...negatives].reduce(
    (s, r) => s + r.pricedCalls,
    0,
  );
  const totalMeasuredCostUsd = [...positives, ...negatives].reduce(
    (s, r) => s + r.measuredCostUsd,
    0,
  );

  // Mode is derived from what the ledger OBSERVED (priced vs total calls), not
  // from the environment: a nominally-live run that hit no_api_key on every
  // call reports honestly as unpriced. The would-cost-live projection is only
  // printed when a rate was supplied, and it is never called a cost.
  const unpricedCalls = totalLlmCalls - totalPricedCalls;
  const projectionUsd =
    costPerLlmCallUsd !== undefined
      ? totalLlmCalls * costPerLlmCallUsd
      : undefined;
  // estimatedCostUsd is the legacy field: the projection on a fully-unpriced
  // run, else 0. It is never the measured cost.
  const estimatedCostUsd =
    totalPricedCalls === 0 && projectionUsd !== undefined ? projectionUsd : 0;

  let costLine: string;
  if (totalLlmCalls === 0) {
    costLine = "cost: no calls made";
  } else if (totalPricedCalls === totalLlmCalls) {
    // MEASURED: real summed cost, no constant.
    costLine =
      `cost: MEASURED $${totalMeasuredCostUsd.toFixed(4)} over ` +
      `${totalPricedCalls} priced call(s)` +
      (totalMeasuredCostUsd === 0
        ? " (NOTE $0.00 over a nonzero priced count means synthetic " +
          "zero-token responses; a real run cannot produce this)"
        : "");
  } else if (totalPricedCalls === 0) {
    // NOT MEASURED: no usage came back, so actual spend is $0.00.
    costLine =
      `cost: NOT MEASURED, actual $0.00 over ${totalLlmCalls} call(s), ` +
      "0 returned usage" +
      (projectionUsd !== undefined
        ? ` | would-cost-live PROJECTION ~$${projectionUsd.toFixed(2)} ` +
          `at $${costPerLlmCallUsd!.toFixed(5)}/call (ESTIMATE, not a cost)`
        : " | no projection (no rate supplied)");
  } else {
    // MIXED: report the measured subset and name the excluded remainder.
    // Never blend into one total.
    costLine =
      `cost: MIXED. MEASURED $${totalMeasuredCostUsd.toFixed(4)} over ` +
      `${totalPricedCalls} priced call(s); ${unpricedCalls} call(s) unpriced ` +
      "and NOT included in that figure";
  }

  process.stdout.write(
    `\nPositives: ${positivesPassed}/${positives.length} ` +
      `at >= ${perPositiveThreshold}/${nRuns} (aggregate need >= ${positivesMinPassing})\n`,
  );
  process.stdout.write(
    `Negatives: ${negativesPassed}/${negatives.length} ` +
      `at ${perNegativeThreshold}/${nRuns} (aggregate need >= ${negativesMinPassing})\n`,
  );
  process.stdout.write(
    `Combined: ${positivesPassed + negativesPassed}/${positives.length + negatives.length} ` +
      `(aggregate need >= ${combinedMinPassing})\n`,
  );
  process.stdout.write(
    `LLM calls: ${totalLlmCalls} (OBSERVED at callClaude; ${totalPricedCalls} priced), ` +
      `no-verdict: ${totalLlmErrors}, transport failures: ${totalObservedFailedCalls}\n`,
  );
  process.stdout.write(`${costLine}\n`);
  if (opts.systemPromptFingerprint) {
    process.stdout.write(
      `SYSTEM_PROMPT fingerprint: ${opts.systemPromptFingerprint}\n`,
    );
  }
  process.stdout.write(
    `\nResolution caveat: n=${nRuns} catches stochasticity at ${Math.round(
      100 / nRuns,
    )}% resolution. ` +
      `Zero FP at n=${nRuns} means "no FP at this resolution," not "calibrated."\n`,
  );

  const hardGatePositives = positivesPassed >= positivesMinPassing;
  const hardGateNegatives = negativesPassed >= negativesMinPassing;
  const hardGateCombined =
    positivesPassed + negativesPassed >= combinedMinPassing;
  // Strictly tighter than before: the previous gate was totalLlmErrors === 0
  // alone. Adding the observed transport-failure count can only ADD failures,
  // never remove one, so no run that failed before can start passing.
  const passed =
    totalLlmErrors === 0 &&
    totalObservedFailedCalls === 0 &&
    hardGatePositives &&
    hardGateNegatives &&
    hardGateCombined;

  if (totalLlmErrors > 0 || totalObservedFailedCalls > 0) {
    process.stdout.write(
      `\nFAIL: ${totalLlmErrors} call(s) yielded no usable verdict, ${totalObservedFailedCalls} failed at transport. Any pass on a negative may be hollow.\n`,
    );
  }

  return {
    positives,
    negatives,
    positivesPassed,
    negativesPassed,
    totalLlmCalls,
    totalLlmErrors,
    totalObservedFailedCalls,
    totalPricedCalls,
    totalMeasuredCostUsd,
    estimatedCostUsd,
    passed,
  };
}
