/**
 * Keyless gate for the stability harness's MEASURED spend ceiling.
 *
 * WHY THIS TEST HAD TO BE DESIGNED FOR, NOT ADDED AFTER. A ceiling that reads
 * MEASURED cost cannot fire on any ordinary keyless path in this repo: replayed
 * calls are unpriced, and the canned responses used by `measure:stage3-calls`
 * carry zero token usage (the harness prints a NOTE saying a real run cannot
 * produce $0.00 over a nonzero priced count). So a spend guard shipped without
 * a deliberate seam would sit in the tree having never once executed — the same
 * failure class this project keeps catching elsewhere: guard 1 asserts presence
 * and never validity; a merged workflow that never ran closes nothing; a green
 * `test:ci` proves wiring and never detection quality. A guard meant to bound
 * spending, built by our own hands, that has never bounded anything, would be
 * the worst instance of it yet, because it buys false confidence about money.
 *
 * THE SEAM. `recordLlmCall` is the single chokepoint the harness reads spend
 * from (`llmCallsSince(...).costUsd`). A fake detector calls it directly with a
 * synthetic priced cost, so the ledger prices calls that never happened. No
 * key, no client, no network, no fixtures/replay, no spend. The real
 * callClaude -> ledger edge is out of scope here and is already gated by
 * `test:ledger-usage-guard`.
 *
 * THE CONTROL THAT MATTERS MOST is case 2, not case 3. Proving the ceiling
 * FIRES is easy and half the story; a guard that halts everything is not a
 * guard, it is an outage. Case 2 proves it stays silent when it should, and
 * case 1 proves an absent ceiling changes nothing at all.
 *
 * Accuracy gating is meaningless here: the fake detector returns no findings
 * and the aggregate thresholds are floored, so the harness's own PASS/FAIL line
 * carries no signal. Only spend behavior is asserted.
 *
 * Run via: npm run test:spend-ceiling   (keyless, zero spend, in test:ci)
 */

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  NormalizedFinding,
  NormalizedFixSuggestion,
} from "../analysis-engine/detector.types";
import type { FindingType } from "../analysis-engine/types";
import { recordLlmCall } from "../lib/llm-call-ledger";
import { llmCoverageSince, snapshotLlmCoverage } from "../lib/llm-coverage";
import {
  resolveSpendCeilingUsd,
  runStabilityHarness,
  SpendCeilingExceeded,
} from "./lib/stability-harness";

const out = process.stdout;

/** Not key-shaped: an "sk-ant-" literal trips this repo's own secret scan. */
const DUMMY_KEY = "fixor-spend-ceiling-test-placeholder-no-network";

const PER_CALL_USD = 0.01;
const POSITIVES = 2;
const NEGATIVES = 2;
const N_RUNS = 3;
/** 2 + 2 fixtures x 3 runs = 12 calls x $0.01 = $0.12 for a complete run. */
const FULL_CALLS = (POSITIVES + NEGATIVES) * N_RUNS;
const FULL_USD = FULL_CALLS * PER_CALL_USD;

let failures = 0;
function pass(msg: string): void {
  out.write(`  PASS  ${msg}\n`);
}
function fail(msg: string): void {
  failures++;
  out.write(`  FAIL  ${msg}\n`);
}
/** Float-safe compare for accumulated USD. */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

/**
 * Records exactly one PRICED call per detect(), then returns no findings.
 * Counts its own invocations so a swallowed abort is visible as a call count
 * that reached the end of the corpus anyway.
 */
class FakePricedDetector {
  // Satisfies the real `Detector` shape so the cast below is a narrowing and
  // not a lie routed through `unknown`. None of these are consulted by the
  // harness; they exist so the compiler checks the same contract a real
  // detector signs.
  readonly id = "spend-ceiling-fake";
  readonly displayName = "Spend-ceiling fake detector";
  readonly supports: readonly FindingType[] = [];
  readonly languages: readonly string[] = ["ts"];

  lastDiagnostics: Array<{
    preFilterReason?: string;
    verdict?: {
      isVulnerable: boolean;
      confidence: string;
      reasoning: string;
    } | null;
  }> = [];
  calls = 0;

  fix(): Promise<NormalizedFixSuggestion> {
    return Promise.reject(
      new Error("fix() is never called by the stability harness"),
    );
  }

  async detect(): Promise<NormalizedFinding[]> {
    this.calls++;
    recordLlmCall({ costUsd: PER_CALL_USD });
    this.lastDiagnostics = [
      {
        verdict: {
          isVulnerable: false,
          confidence: "high",
          reasoning: "synthetic priced call; no model was consulted",
        },
      },
    ];
    return [];
  }
}

function makeCorpus(): string {
  const root = mkdtempSync(join(tmpdir(), "fixor-spend-ceiling-"));
  for (const [cls, n] of [
    ["positive", POSITIVES],
    ["negative", NEGATIVES],
  ] as const) {
    mkdirSync(join(root, cls));
    for (let i = 1; i <= n; i++) {
      writeFileSync(
        join(root, cls, `0${i}-synthetic.ts`),
        `// ASSUMED-PATH: src/routes/synthetic-${cls}-${i}.ts\nexport const x = ${i};\n`,
        "utf8",
      );
    }
  }
  return root;
}

type RunOutcome =
  | { kind: "completed"; measuredUsd: number; calls: number }
  | { kind: "threw"; err: unknown; calls: number };

async function runWith(haltAboveUsd?: number): Promise<RunOutcome> {
  const detector = new FakePricedDetector();
  try {
    const report = await runStabilityHarness({
      detectorName: "spend-ceiling-fake",
      fixturesDir: makeCorpus(),
      detector: detector as Parameters<
        typeof runStabilityHarness
      >[0]["detector"],
      nRuns: N_RUNS,
      sleepMsBetween: 0,
      perPositiveThreshold: 0,
      perNegativeThreshold: 0,
      positivesMinPassing: 0,
      negativesMinPassing: 0,
      combinedMinPassing: 0,
      ...(haltAboveUsd === undefined ? {} : { haltAboveUsd }),
    });
    return {
      kind: "completed",
      measuredUsd: report.totalMeasuredCostUsd,
      calls: detector.calls,
    };
  } catch (err) {
    return { kind: "threw", err, calls: detector.calls };
  }
}

async function main(): Promise<void> {
  process.env.ANTHROPIC_API_KEY = DUMMY_KEY;
  delete process.env.FIXOR_HALT_USD;
  const coverageBefore = snapshotLlmCoverage();

  out.write(
    "stability-harness spend ceiling (keyless).\n" +
      "Mode: no key, no client, no network, no spend. Synthetic priced calls via the ledger.\n" +
      `Corpus: ${POSITIVES} pos + ${NEGATIVES} neg x n=${N_RUNS} = ${FULL_CALLS} calls, $${FULL_USD.toFixed(2)} complete.\n\n`,
  );

  // -- case 1: INERT WHEN ABSENT ------------------------------------------
  out.write("case 1: no ceiling supplied -> behaves exactly as before\n");
  {
    const r = await runWith(undefined);
    if (r.kind !== "completed") {
      fail(`no-ceiling run threw: ${String((r as { err: unknown }).err)}`);
    } else if (r.calls !== FULL_CALLS) {
      fail(`no-ceiling run made ${r.calls} calls; expected ${FULL_CALLS}`);
    } else if (!near(r.measuredUsd, FULL_USD)) {
      fail(`no-ceiling measured $${r.measuredUsd}; expected $${FULL_USD}`);
    } else {
      pass(
        `absent ceiling is inert: ${r.calls}/${FULL_CALLS} calls, measured $${r.measuredUsd.toFixed(4)}`,
      );
    }
  }

  // -- case 2: THE CONTROL. Ceiling above the total must NOT fire ---------
  out.write("\ncase 2 (the control): ceiling ABOVE the total -> must complete\n");
  {
    const ceiling = FULL_USD * 4;
    const r = await runWith(ceiling);
    if (r.kind !== "completed") {
      fail(
        `ceiling $${ceiling.toFixed(2)} fired on a $${FULL_USD.toFixed(2)} run. ` +
          "A guard that halts everything is not a guard.",
      );
    } else if (r.calls !== FULL_CALLS) {
      fail(`run stopped at ${r.calls}/${FULL_CALLS} calls with headroom`);
    } else if (!near(r.measuredUsd, FULL_USD)) {
      fail(
        `ceiling disturbed the reported figure: $${r.measuredUsd} vs $${FULL_USD}`,
      );
    } else {
      pass(
        `ceiling $${ceiling.toFixed(2)} stayed silent over $${FULL_USD.toFixed(2)}; ` +
          "reported figure unchanged",
      );
    }
  }

  // -- case 3: fires, and the abort ESCAPES the harness's catch-all -------
  out.write("\ncase 3: ceiling BELOW the total -> throws and stops early\n");
  {
    // Ceiling placed STRICTLY BETWEEN two call boundaries on purpose. An exact
    // multiple like $0.05 is not a safe choice: accumulating 0.01 five times
    // yields 0.05000000000000001, which is already above a $0.05 ceiling, so
    // the abort lands a call earlier than the arithmetic suggests. $0.055 sits
    // between call 5 ($0.05) and call 6 ($0.06) with room for float noise on
    // either side, so the expected stopping point is unambiguous.
    const ceiling = 0.055;
    const expectedCalls = 6;
    const r = await runWith(ceiling);
    if (r.kind !== "threw") {
      fail(
        `ceiling $${ceiling} did not fire on a $${FULL_USD.toFixed(2)} run. If the ` +
          "check sits inside stabilityRunDir's try/catch, the abort is swallowed " +
          "into an 'error:' result and the run keeps spending.",
      );
    } else if (!(r.err instanceof SpendCeilingExceeded)) {
      fail(`threw ${String(r.err)}; expected SpendCeilingExceeded`);
    } else {
      const e = r.err;
      const problems: string[] = [];
      if (r.calls !== expectedCalls) {
        problems.push(`stopped after ${r.calls} calls, expected ${expectedCalls}`);
      }
      if (!(e.spentUsd > e.ceilingUsd)) {
        problems.push(`spent $${e.spentUsd} not above ceiling $${e.ceilingUsd}`);
      }
      // THE BOUND: overshoot may never exceed a single call.
      if (e.spentUsd - e.ceilingUsd > PER_CALL_USD + 1e-9) {
        problems.push(
          `overshoot $${(e.spentUsd - e.ceilingUsd).toFixed(4)} exceeds one call ` +
            `($${PER_CALL_USD}); the check is not per-iteration`,
        );
      }
      if (problems.length > 0) fail(problems.join("; "));
      else {
        pass(
          `threw SpendCeilingExceeded at $${e.spentUsd.toFixed(4)} over $${e.ceilingUsd.toFixed(4)}, ` +
            `after ${r.calls}/${FULL_CALLS} calls, overshoot <= one call`,
        );
      }
    }
  }

  // -- case 4: the env path the workflow actually uses --------------------
  out.write("\ncase 4: FIXOR_HALT_USD env path (how the workflow supplies it)\n");
  {
    process.env.FIXOR_HALT_USD = "0.055";
    const r = await runWith(undefined);
    delete process.env.FIXOR_HALT_USD;
    if (r.kind !== "threw" || !(r.err instanceof SpendCeilingExceeded)) {
      fail("FIXOR_HALT_USD=0.055 did not abort the run");
    } else if (r.calls !== 6) {
      fail(`FIXOR_HALT_USD aborted after ${r.calls} calls; expected 6`);
    } else {
      pass(
        `FIXOR_HALT_USD honored: aborted at $${r.err.spentUsd.toFixed(4)} after ${r.calls} calls`,
      );
    }
  }

  // -- case 5: fail-closed parsing. Set-but-unusable must NEVER mean off --
  out.write(
    "\ncase 5: a ceiling that is set but unusable must THROW, never silently disable\n",
  );
  {
    // Local tally: this case's verdict must not depend on earlier cases.
    const before = failures;
    const bad = ["", "   ", "abc", "0", "-1", "NaN", "Infinity"];
    for (const v of bad) {
      let threw = false;
      try {
        resolveSpendCeilingUsd(undefined, v);
      } catch {
        threw = true;
      }
      if (!threw) {
        fail(
          `FIXOR_HALT_USD=${JSON.stringify(v)} was accepted. Fail-open: a typo'd ` +
            "ceiling would read as no ceiling.",
        );
      }
    }
    if (resolveSpendCeilingUsd(undefined, undefined) !== undefined) {
      fail("an UNSET FIXOR_HALT_USD produced a ceiling; absent must be inert");
    }
    if (resolveSpendCeilingUsd(undefined, " 1.25 ") !== 1.25) {
      fail("a valid padded FIXOR_HALT_USD was not parsed to 1.25");
    }
    if (resolveSpendCeilingUsd(2.5, "0.01") !== 2.5) {
      fail("an explicit haltAboveUsd did not take precedence over the env var");
    }
    let explicitThrew = false;
    try {
      resolveSpendCeilingUsd(-1, undefined);
    } catch {
      explicitThrew = true;
    }
    if (!explicitThrew) fail("a negative explicit haltAboveUsd was accepted");
    if (failures === before) {
      pass(
        `${bad.length} unusable values rejected; unset stays inert; explicit wins over env`,
      );
    }
  }

  // -- case 6: nothing in this file ever reached callClaude ---------------
  out.write("\ncase 6: keyless proof\n");
  {
    const cov = llmCoverageSince(coverageBefore);
    if (cov.attempted === 0) {
      pass("zero callClaude attempts recorded across the whole test");
    } else {
      fail(`${cov.attempted} callClaude attempt(s) recorded; expected 0`);
    }
  }

  out.write("\n");
  if (failures > 0) {
    out.write(`RESULT: FAIL (${failures} failing assertion(s))\n`);
    process.exit(1);
  }
  out.write(
    "RESULT: PASS\n" +
      "NOTE: bounds the MAGNITUDE OF ONE RUN. It does NOT bound the NUMBER of runs;\n" +
      "      two dispatches each carry their own ceiling. Single-spend still rests\n" +
      "      on dispatching once.\n",
  );
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
