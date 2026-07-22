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
  estimatedCostUsd: number;
  passed: boolean;
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
  /** For cost estimate logging. Default 0.01 — Sonnet 4.6 detection-call
   *  empirical (~$0.007–0.013/call measured, Phase D burn + 2026-06-12
   *  estimation pass). The old 0.004 default was a Haiku-class figure and
   *  understated real spend ~2.5×; detection runs CLAUDE_MODELS.DETECTION
   *  (claude-sonnet-4-6), not Haiku. */
  costPerLlmCallUsd?: number;
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
    Pick<HarnessOptions, "detector">,
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
  const costPerLlmCallUsd = opts.costPerLlmCallUsd ?? 0.01;

  process.stdout.write(
    `${opts.detectorName} stability run (n=${nRuns} per fixture)\n` +
      (opts.systemPromptFingerprint
        ? `SYSTEM_PROMPT fingerprint: ${opts.systemPromptFingerprint}\n`
        : "") +
      `Per-fixture thresholds: positives flagged >= ${perPositiveThreshold}/${nRuns}, ` +
      `negatives correctly-skipped == ${perNegativeThreshold}/${nRuns}\n\n`,
  );

  process.stdout.write("Positives (should be flagged):\n");
  const positives = await stabilityRunDir(
    join(opts.fixturesDir, "positive"),
    true,
    { nRuns, sleepMsBetween, detector: opts.detector },
  );

  process.stdout.write("\nNegatives (should NOT be flagged):\n");
  const negatives = await stabilityRunDir(
    join(opts.fixturesDir, "negative"),
    false,
    { nRuns, sleepMsBetween, detector: opts.detector },
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
  const estimatedCostUsd = totalLlmCalls * costPerLlmCallUsd;

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
      `no-verdict: ${totalLlmErrors}, transport failures: ${totalObservedFailedCalls}, ` +
      `estimated cost ~$${estimatedCostUsd.toFixed(2)}\n`,
  );
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
    estimatedCostUsd,
    passed,
  };
}
