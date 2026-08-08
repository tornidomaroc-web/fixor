/**
 * Verdict census for the stability harness (recording half of the MEDIUM-lane fix).
 *
 * WHY THIS EXISTS. The harness scored a negative as `correctly-skipped` whenever
 * the detector emitted nothing. "Emitted nothing" is a PROXY for "the model said
 * this was safe", and the two came apart on run 30903038957: the model returned
 * `isVulnerable:true @ medium` on `env-exposure/negative/03` five times out of
 * five, every one was discarded by the MEDIUM suppression branch, and the fixture
 * scored `correctly-skipped 5/5 PASS`. More sampling would never have revealed it,
 * because the proxy is wrong at every sample size. This module counts the property
 * (what the model asserted) instead of the proxy (what came out the other end).
 *
 * RECORDING ONLY. Nothing here changes a DETECTION verdict. Positives, negatives
 * and the aggregate gates are computed exactly as before. What this adds is one
 * INSTRUMENT-INTEGRITY failure: if the census cannot account for every run, the
 * harness refuses to report rather than reporting a number it cannot stand behind.
 * That is the same fail-loud-never-fail-open posture the workflow's cost parser
 * already takes with its UNRECOGNIZED bucket, and it is deliberately NOT a
 * detection signal: a run can fail reconciliation while every detector is healthy.
 *
 * THE IDENTITY IS OVER RUNS, NOT CALLS, AND THAT IS NOT A SHORTCUT.
 * `FixtureStability.llmCalls` counts EVERY call a fixture caused, including the
 * H8 escalation second call. So "sum of verdict classes == ledger call count" is
 * FALSE whenever FIXOR_ESCALATE_MEDIUM is on, and a reconciliation built on it
 * would fail spuriously on a healthy escalating run. The load-bearing identity is
 * therefore:
 *
 *     countedRuns === actualRuns
 *
 * every run lands in exactly one bucket. That is what catches the failure this
 * module exists to prevent: a verdict shape the classifier does not know must
 * become a LOUD `UNCLASSIFIED`, never a silent omission that leaves the census
 * reading full while being short. The ledger is cross-checked separately and
 * DIRECTIONALLY (`llmCalls >= callingRuns`), with the surplus reported as
 * auxiliary/escalation calls rather than hidden or asserted away.
 *
 * WHAT GOES IN UNCLASSIFIED. Anything that is not pre-filtered, not a clean
 * no-verdict, and not one of the six recognized `{vuln,safe}/{high,medium,low}`
 * shapes. Concretely: a confidence string outside the enum (the detector types it
 * as `string`, so this is reachable without a cast), or an `isVulnerable` that is
 * not a boolean. It is never a silent drop and never folded into a neighbouring
 * bucket, for the same reason the cost parser refuses to treat an unknown cost
 * line as $0.00: silent undercounting is the defect, not the edge case.
 */

import type { FixtureStability } from "./stability-harness";

/** The six recognized verdict shapes. Anything else is UNCLASSIFIED. */
export const VERDICT_CLASSES = [
  "vuln/high",
  "vuln/medium",
  "vuln/low",
  "safe/high",
  "safe/medium",
  "safe/low",
] as const;

export type VerdictClass = (typeof VERDICT_CLASSES)[number];

const CONFIDENCES = new Set(["high", "medium", "low"]);

/** A negative fixture on which the model asserted vulnerability at least once. */
export interface MaskedNegative {
  file: string;
  /** Runs where the model asserted isVulnerable. */
  assertedRuns: number;
  totalRuns: number;
  /** The verdict classes observed on those runs, deduped and sorted. */
  classes: string[];
  /** Runs where the model asserted isVulnerable but nothing was emitted. */
  assertedButNotEmitted: number;
}

export interface VerdictCensus {
  byClass: Record<string, number>;
  preFiltered: number;
  noVerdict: number;
  unclassified: number;
  /** Human-readable samples of what landed in UNCLASSIFIED, capped. */
  unclassifiedSamples: string[];
  /**
   * Per verdict class, runs where isVulnerable was asserted and NOTHING was
   * emitted. Exists so the rendered census can COUNT what it used to ASSERT:
   * the `vuln/medium` row carried a hardcoded "SUPPRESSED (not emitted)" label
   * inherited from the pre-#152 emit policy, which went false the moment
   * option C shipped and then contradicted this same census's own
   * asserted-but-not-emitted total further down the identical report.
   */
  notEmittedByClass: Record<string, number>;
  /** Sum of every bucket. Must equal actualRuns. */
  countedRuns: number;
  /** Sum of runs actually executed across all fixtures. */
  actualRuns: number;
  /** fixtures x nRuns. Lower actualRuns means a run aborted mid-flight. */
  expectedRuns: number;
  /** Runs that reached the model (everything not pre-filtered). */
  callingRuns: number;
  /** Ledger figure, summed across fixtures. */
  ledgerCalls: number;
  /** ledgerCalls - callingRuns. Escalation/auxiliary calls, reported not hidden. */
  auxiliaryCalls: number;
  /** True when countedRuns === actualRuns AND ledgerCalls >= callingRuns. */
  reconciled: boolean;
  reconciliationErrors: string[];
  /**
   * Negatives the model called vulnerable at least once. LANE MEMBERSHIP, not a
   * masked-FP census: since #152 such a verdict is usually EMITTED, and since
   * #151 an undeclared one FAILS the fixture rather than passing it quietly.
   * Read `assertedButNotEmitted` for masking and the `neg` scoring line for the
   * pass/fail; neither is decidable from membership alone.
   */
  maskedNegatives: MaskedNegative[];
  /** Runs, anywhere, where isVulnerable was asserted but nothing was emitted. */
  assertedButNotEmitted: number;
}

function classify(run: {
  flagged: boolean;
  preFilterReason?: string;
  verdict?: { isVulnerable: boolean; confidence: string; reasoning: string } | null;
}): { bucket: "pre-filtered" | "no-verdict" | "unclassified" | VerdictClass; why?: string } {
  if (run.preFilterReason !== undefined) return { bucket: "pre-filtered" };
  if (!run.verdict) return { bucket: "no-verdict" };

  const v = run.verdict;
  if (typeof v.isVulnerable !== "boolean") {
    return {
      bucket: "unclassified",
      why: `isVulnerable is ${typeof v.isVulnerable}, not boolean`,
    };
  }
  const conf = String(v.confidence).toLowerCase();
  if (!CONFIDENCES.has(conf)) {
    return { bucket: "unclassified", why: `confidence "${v.confidence}" is outside the enum` };
  }
  return { bucket: `${v.isVulnerable ? "vuln" : "safe"}/${conf}` as VerdictClass };
}

export function buildVerdictCensus(
  fixtures: FixtureStability[],
  nRuns: number,
): VerdictCensus {
  const byClass: Record<string, number> = {};
  const notEmittedByClass: Record<string, number> = {};
  for (const c of VERDICT_CLASSES) {
    byClass[c] = 0;
    notEmittedByClass[c] = 0;
  }

  let preFiltered = 0;
  let noVerdict = 0;
  let unclassified = 0;
  let actualRuns = 0;
  let ledgerCalls = 0;
  let assertedButNotEmitted = 0;
  const unclassifiedSamples: string[] = [];
  const maskedNegatives: MaskedNegative[] = [];

  for (const f of fixtures) {
    ledgerCalls += f.llmCalls;
    let negAsserted = 0;
    let negAssertedNotEmitted = 0;
    const negClasses = new Set<string>();

    for (const run of f.runs) {
      actualRuns++;
      const { bucket, why } = classify(run);

      if (bucket === "pre-filtered") preFiltered++;
      else if (bucket === "no-verdict") noVerdict++;
      else if (bucket === "unclassified") {
        unclassified++;
        if (unclassifiedSamples.length < 10) {
          unclassifiedSamples.push(`${f.file}: ${why ?? "unknown shape"}`);
        }
      } else {
        byClass[bucket] = (byClass[bucket] ?? 0) + 1;
      }

      // Asserted-but-not-emitted is counted from the RAW verdict, independent of
      // classification, so an UNCLASSIFIED shape that still asserts vulnerability
      // is not lost from this tally.
      const asserted = run.verdict?.isVulnerable === true;
      if (asserted && !run.flagged) {
        assertedButNotEmitted++;
        if (bucket !== "pre-filtered" && bucket !== "no-verdict" && bucket !== "unclassified") {
          notEmittedByClass[bucket] = (notEmittedByClass[bucket] ?? 0) + 1;
        }
      }
      if (!f.isPositive && asserted) {
        negAsserted++;
        if (!run.flagged) negAssertedNotEmitted++;
        if (bucket !== "pre-filtered" && bucket !== "no-verdict") {
          negClasses.add(bucket);
        }
      }
    }

    if (!f.isPositive && negAsserted > 0) {
      maskedNegatives.push({
        file: f.file,
        assertedRuns: negAsserted,
        totalRuns: f.runs.length,
        classes: [...negClasses].sort(),
        assertedButNotEmitted: negAssertedNotEmitted,
      });
    }
  }

  const classSum = Object.values(byClass).reduce((s, n) => s + n, 0);
  const countedRuns = classSum + preFiltered + noVerdict + unclassified;
  const callingRuns = classSum + noVerdict + unclassified;
  const expectedRuns = fixtures.length * nRuns;
  const auxiliaryCalls = ledgerCalls - callingRuns;

  const reconciliationErrors: string[] = [];
  if (countedRuns !== actualRuns) {
    reconciliationErrors.push(
      `census does not account for every run: counted ${countedRuns}, executed ${actualRuns}. ` +
        `${actualRuns - countedRuns} run(s) fell through classification and were silently dropped. ` +
        "This is the exact failure the UNCLASSIFIED bucket exists to prevent.",
    );
  }
  if (ledgerCalls < callingRuns) {
    reconciliationErrors.push(
      `ledger observed ${ledgerCalls} call(s) but ${callingRuns} run(s) reached the model. ` +
        "A run cannot reach the model without the ledger seeing a call; the ledger or the " +
        "diagnostics sink is lying.",
    );
  }

  return {
    byClass,
    notEmittedByClass,
    preFiltered,
    noVerdict,
    unclassified,
    unclassifiedSamples,
    countedRuns,
    actualRuns,
    expectedRuns,
    callingRuns,
    ledgerCalls,
    auxiliaryCalls,
    reconciled: reconciliationErrors.length === 0,
    reconciliationErrors,
    maskedNegatives,
    assertedButNotEmitted,
  };
}

/**
 * Per-fixture declarations of verdict classes that are EXPECTED on a negative.
 * Keyed by fixture basename. The undeclared default is "the model must not
 * assert isVulnerable"; an entry here is a narrow, evidenced exception.
 *
 * A declaration requires documentation that MEDIUM is the CORRECT outcome, with
 * a reason. It is NOT earned by observation alone: a live run showing a wrong
 * verdict documents that it OCCURRED, not that it is right, and treating
 * occurrence as licence would let any false positive declare itself legitimate.
 * That is declaring your way past a defect, which is the thing this whole
 * mechanism exists to stop.
 */
export type NegativeExpectations = Record<string, readonly string[]>;

export interface NegativeScore {
  /** Runs where the model did not assert vulnerability, or asserted a declared class. */
  cleanRuns: number;
  totalRuns: number;
  /** Runs where the model asserted a class this fixture does not declare. */
  violations: number;
  /** Runs excused by a declaration. Reported so an exception is never invisible. */
  excused: number;
  /** True when the fixture carries a declaration at all. */
  declared: boolean;
}

/**
 * Score one negative on ASSERTION rather than EMISSION.
 *
 * The old rule counted a run clean whenever the detector emitted nothing, which
 * is a proxy: `env-exposure/negative/03` emitted nothing on all five runs while
 * the model called it vulnerable on all five. Emission is what the suppression
 * branch controls; assertion is what the model actually judged.
 */
export function scoreNegative(
  fixtureFile: string,
  runs: ReadonlyArray<{ verdict?: { isVulnerable: boolean; confidence: string } | null }>,
  expectations: NegativeExpectations = {},
): NegativeScore {
  const allowed = expectations[fixtureFile];
  let cleanRuns = 0;
  let violations = 0;
  let excused = 0;

  for (const run of runs) {
    const v = run.verdict;
    if (!v || v.isVulnerable !== true) {
      cleanRuns++;
      continue;
    }
    const cls = `vuln/${String(v.confidence).toLowerCase()}`;
    if (allowed?.includes(cls)) {
      cleanRuns++;
      excused++;
    } else {
      violations++;
    }
  }

  return { cleanRuns, totalRuns: runs.length, violations, excused, declared: allowed !== undefined };
}

/**
 * Render the census. Returns a string; the caller decides where it goes.
 *
 * EVERY ANNOTATION HERE IS A COUNT, NEVER A POLICY CLAIM. Three claims on this
 * surface went false when option C shipped (#152) and no test read any of them,
 * so a paid run printed a report that argued with itself:
 *
 *   1. the `vuln/medium` row was labelled "SUPPRESSED (not emitted)" from the
 *      hardcoded pre-#152 emit policy, while the same report's own
 *      asserted-but-not-emitted total two sections down read 0;
 *   2. "N negative(s) passed on silence rather than on a safe verdict" — since
 *      #151 a negative is scored on ASSERTION, so silence is not what makes one
 *      pass, and the run that printed it passed both on DECLARATIONS with
 *      "0 not emitted" on the line two rows above;
 *   3. "Read these as masked false positives, not as clean negatives" — nothing
 *      was masked (both emitted) and both are documented correct cross-file
 *      uncertainties, not false positives.
 *
 * The rule that keeps this from recurring: this module measures lane
 * MEMBERSHIP. It must never render a claim about emit policy, about why a
 * fixture passed, or about whether a verdict is right — three properties it
 * does not measure. State the count, point at the surface that owns the rest.
 */
export function formatVerdictCensus(c: VerdictCensus): string {
  const lines: string[] = [];
  lines.push("\n=== VERDICT CENSUS (counts RUNS, not calls) ===");

  for (const cls of VERDICT_CLASSES) {
    const n = c.byClass[cls] ?? 0;
    if (n === 0) continue;
    // Counted, not asserted: emission is read off the runs, so this line stays
    // true across any future change to the emit policy.
    const notEmitted = c.notEmittedByClass[cls] ?? 0;
    const note = cls.startsWith("vuln/")
      ? `   asserted vulnerable: ${n - notEmitted} emitted, ${notEmitted} not`
      : "";
    lines.push(`  ${cls.padEnd(16)} ${String(n).padStart(4)}${note}`);
  }
  if (c.preFiltered > 0) {
    lines.push(`  ${"pre-filtered".padEnd(16)} ${String(c.preFiltered).padStart(4)}`);
  }
  if (c.noVerdict > 0) {
    lines.push(`  ${"no-verdict".padEnd(16)} ${String(c.noVerdict).padStart(4)}`);
  }
  lines.push(
    `  ${"UNCLASSIFIED".padEnd(16)} ${String(c.unclassified).padStart(4)}` +
      (c.unclassified > 0 ? "   <-- UNKNOWN VERDICT SHAPE, see below" : ""),
  );
  for (const s of c.unclassifiedSamples) lines.push(`      ! ${s}`);

  lines.push("  " + "-".repeat(42));
  lines.push(
    `  counted ${c.countedRuns} of ${c.actualRuns} executed run(s)` +
      (c.actualRuns !== c.expectedRuns
        ? ` (expected ${c.expectedRuns}; a run aborted)`
        : "") +
      `  ${c.countedRuns === c.actualRuns ? "RECONCILED" : "*** MISMATCH ***"}`,
  );
  lines.push(
    `  ledger ${c.ledgerCalls} call(s); ${c.callingRuns} run(s) reached the model; ` +
      `${c.auxiliaryCalls} auxiliary/escalation`,
  );

  lines.push("\n=== NEGATIVES THE MODEL CALLED VULNERABLE ===");
  if (c.maskedNegatives.length === 0) {
    // NOT "every clean pass is backed by a safe verdict": scoreNegative also
    // counts a run with NO verdict at all as clean, so that phrasing claimed a
    // safe verdict this census never saw. It says only what it measured.
    lines.push("  none. No negative had isVulnerable asserted on any run.");
  } else {
    for (const m of c.maskedNegatives) {
      lines.push(
        `  ${m.file}: isVulnerable on ${m.assertedRuns}/${m.totalRuns} run(s) ` +
          `[${m.classes.join(", ")}], ${m.assertedButNotEmitted} not emitted`,
      );
    }
    lines.push(
      `  ${c.maskedNegatives.length} negative(s) had isVulnerable asserted on at least one run. ` +
        "This census measures lane MEMBERSHIP only. Whether an entry is a false positive or a " +
        "correct uncertainty is NOT decided here - read the recorded reasoning. Whether the " +
        "fixture passed, and whether on a declaration, is on its `neg` line above.",
    );
  }
  lines.push(
    `\nAsserted-but-not-emitted across all fixtures: ${c.assertedButNotEmitted} run(s).`,
  );

  return lines.join("\n") + "\n";
}
