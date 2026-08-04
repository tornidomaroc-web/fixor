/**
 * Keyless gate for the verdict census (recording half of the MEDIUM-lane fix).
 *
 * Run via: npm run test:verdict-census   (zero spend, no API key)
 *
 * WHAT THIS GUARDS. The harness used to score a negative as `correctly-skipped`
 * whenever the detector emitted nothing, which is a PROXY for "the model said
 * safe". Run 30903038957 pulled the two apart: `env-exposure/negative/03` scored
 * `correctly-skipped 5/5 PASS` while the model returned `isVulnerable:true @
 * medium` on all five runs. This gate asserts the census counts the property (what
 * was asserted) rather than the proxy (what was emitted), and that an unknown
 * verdict shape is LOUD rather than silently dropped.
 *
 * THE NEGATIVE CONTROL, AND WHY IT TARGETS THE LEDGER ARM. Recording changes no
 * detection verdict, so this gate cannot be validated by watching a detection gate
 * go red. It needs a demonstrated failure of its own. Note carefully that an
 * unknown verdict shape does NOT break reconciliation: it lands in UNCLASSIFIED,
 * which is a bucket, so `countedRuns === actualRuns` still holds. That is the
 * designed behaviour, not a gap. `classify()` is TOTAL, so the run-count arm of
 * reconciliation cannot fire against today's implementation; it is defense in
 * depth against a future classifier that grows an early return, and case 2 pins
 * the totality property that keeps it that way.
 *
 * The arm that IS reachable is the ledger arm: a run that reached the model while
 * the ledger saw no call. Case 5 constructs exactly that and asserts the specific
 * ledger error, so deleting the ledger check makes case 5 fail for precisely that
 * reason and for no other. That is the demonstrated failure mode this gate is
 * required to carry.
 */

import {
  buildVerdictCensus,
  formatVerdictCensus,
  scoreNegative,
  VERDICT_CLASSES,
} from "./lib/verdict-census";
import type { FixtureStability } from "./lib/stability-harness";

let passed = 0;
let failed = 0;

function pass(msg: string): void {
  passed++;
  process.stdout.write(`  PASS  ${msg}\n`);
}
function fail(msg: string): void {
  failed++;
  process.stdout.write(`  FAIL  ${msg}\n`);
}
function check(cond: boolean, msg: string): void {
  if (cond) pass(msg);
  else fail(msg);
}

type Verdict = { isVulnerable: boolean; confidence: string; reasoning: string };

/** Build one fixture. `llmCalls` defaults to the number of model-reaching runs. */
function fixture(
  file: string,
  isPositive: boolean,
  runs: Array<{ flagged: boolean; preFilterReason?: string; verdict?: Verdict | null }>,
  llmCallsOverride?: number,
): FixtureStability {
  const calling = runs.filter((r) => r.preFilterReason === undefined).length;
  return {
    file,
    isPositive,
    runs,
    flaggedCount: runs.filter((r) => r.flagged).length,
    llmCalls: llmCallsOverride ?? calling,
    llmErrors: 0,
    observedFailedCalls: 0,
    pricedCalls: llmCallsOverride ?? calling,
    measuredCostUsd: 0,
  } as FixtureStability;
}

const v = (isVulnerable: boolean, confidence: string): Verdict => ({
  isVulnerable,
  confidence,
  reasoning: "synthetic",
});

function runsOf(n: number, flagged: boolean, verdict: Verdict) {
  return Array.from({ length: n }, () => ({ flagged, verdict }));
}

// ---------------------------------------------------------------------------
// Case 1: reproduce run 30903038957's shape. 45 vuln/high, 25 safe/low,
// 15 vuln/medium, all 15 suppressed, one of them a masked NEGATIVE.
// ---------------------------------------------------------------------------
{
  const fixtures: FixtureStability[] = [
    // 9 positives flagged high (45 runs)
    ...Array.from({ length: 9 }, (_, i) =>
      fixture(`positive/p${i}.ts`, true, runsOf(5, true, v(true, "high"))),
    ),
    // 2 positives the model called vulnerable at medium, suppressed (10 runs)
    fixture("positive/03-fastify-logs-env.ts", true, runsOf(5, false, v(true, "medium"))),
    fixture("positive/11-redacted-diagnostics.js", true, runsOf(5, false, v(true, "medium"))),
    // 5 negatives correctly safe (25 runs)
    ...Array.from({ length: 5 }, (_, i) =>
      fixture(`negative/n${i}.ts`, false, runsOf(5, false, v(false, "low"))),
    ),
    // 1 negative the model called vulnerable at medium, suppressed (5 runs)
    fixture("negative/03-fastify-redacted-logs.ts", false, runsOf(5, false, v(true, "medium"))),
  ];

  const c = buildVerdictCensus(fixtures, 5);

  check(c.byClass["vuln/high"] === 45, `vuln/high === 45 (got ${c.byClass["vuln/high"]})`);
  check(c.byClass["safe/low"] === 25, `safe/low === 25 (got ${c.byClass["safe/low"]})`);
  check(c.byClass["vuln/medium"] === 15, `vuln/medium === 15 (got ${c.byClass["vuln/medium"]})`);
  check(c.countedRuns === 85, `countedRuns === 85 (got ${c.countedRuns})`);
  check(c.countedRuns === c.actualRuns, "counted === actual (reconciled on runs)");
  check(c.reconciled, "run-4 shape reconciles");
  check(c.unclassified === 0, "no UNCLASSIFIED on a well-formed run");

  // The masked negative is REPORTED, not derived.
  check(
    c.maskedNegatives.length === 1,
    `exactly 1 masked negative (got ${c.maskedNegatives.length})`,
  );
  check(
    c.maskedNegatives[0]?.file === "negative/03-fastify-redacted-logs.ts",
    "the masked negative is negative/03",
  );
  check(
    c.maskedNegatives[0]?.assertedRuns === 5,
    `masked negative asserted on 5/5 (got ${c.maskedNegatives[0]?.assertedRuns})`,
  );
  check(
    c.assertedButNotEmitted === 15,
    `asserted-but-not-emitted === 15 (got ${c.assertedButNotEmitted})`,
  );

  // The whole point: the negative "passed" on silence. If the census reported
  // zero masked negatives here it would be repeating the original defect.
  check(
    c.maskedNegatives[0]?.assertedButNotEmitted === 5,
    "the masked negative's 5 assertions were all suppressed",
  );
}

// ---------------------------------------------------------------------------
// Case 2: an UNKNOWN verdict shape is LOUD, not dropped and not folded into a
// neighbouring bucket. This is the totality property that keeps the run-count
// arm of reconciliation unreachable-by-construction.
// ---------------------------------------------------------------------------
{
  const fixtures = [
    fixture("negative/weird.ts", false, [
      { flagged: false, verdict: v(true, "banana") },
      { flagged: false, verdict: v(false, "low") },
    ]),
  ];
  const c = buildVerdictCensus(fixtures, 2);

  check(c.unclassified === 1, `unknown confidence -> UNCLASSIFIED (got ${c.unclassified})`);
  check(
    c.countedRuns === c.actualRuns,
    "UNCLASSIFIED is COUNTED, not dropped (counted === actual)",
  );
  const knownTotal = VERDICT_CLASSES.reduce((s, k) => s + (c.byClass[k] ?? 0), 0);
  check(knownTotal === 1, `the unknown shape was NOT folded into a known bucket (known=${knownTotal})`);
  check(
    c.unclassifiedSamples.some((s) => s.includes("banana")),
    "the UNCLASSIFIED sample names the offending value",
  );
  // An UNCLASSIFIED shape that still asserts vulnerability must not escape the
  // masked-negative census just because its confidence was unparseable.
  check(
    c.maskedNegatives.length === 1 && c.maskedNegatives[0]?.assertedRuns === 1,
    "an UNCLASSIFIED shape that asserts isVulnerable still counts as a masked negative",
  );
}

// ---------------------------------------------------------------------------
// Case 3: a non-boolean isVulnerable is UNCLASSIFIED, not coerced.
// ---------------------------------------------------------------------------
{
  const bad = { isVulnerable: "yes", confidence: "high", reasoning: "x" } as unknown as Verdict;
  const c = buildVerdictCensus([fixture("negative/bad.ts", false, [{ flagged: false, verdict: bad }])], 1);
  check(c.unclassified === 1, "non-boolean isVulnerable -> UNCLASSIFIED");
  check(c.countedRuns === 1, "still counted");
  check(
    (c.byClass["vuln/high"] ?? 0) === 0,
    "truthy-but-not-boolean was NOT coerced into vuln/high",
  );
}

// ---------------------------------------------------------------------------
// Case 4: escalation surplus must NOT fail reconciliation. llmCalls counts the
// H8 second call, so ledger > callingRuns is HEALTHY and must be reported as
// auxiliary rather than asserted away.
// ---------------------------------------------------------------------------
{
  const c = buildVerdictCensus(
    [fixture("positive/esc.ts", true, runsOf(3, false, v(true, "medium")), 6)],
    3,
  );
  check(c.reconciled, "escalation surplus (ledger 6 > calling 3) still reconciles");
  check(c.auxiliaryCalls === 3, `auxiliary calls reported as 3 (got ${c.auxiliaryCalls})`);
}

// ---------------------------------------------------------------------------
// Case 5: THE NEGATIVE CONTROL. A run reached the model but the ledger saw no
// call. Reconciliation must FAIL, and fail with the LEDGER error specifically.
// Delete the ledger check in verdict-census.ts and this case fails for exactly
// that reason and no other.
// ---------------------------------------------------------------------------
{
  const c = buildVerdictCensus(
    [fixture("negative/ghost.ts", false, runsOf(2, false, v(false, "low")), 0)],
    2,
  );
  check(!c.reconciled, "ledger 0 vs 2 model-reaching runs FAILS reconciliation");
  check(
    c.reconciliationErrors.some((e) => e.includes("ledger observed 0 call(s)")),
    "the failure names the ledger arm specifically",
  );
  check(
    c.reconciliationErrors.length === 1,
    `exactly one reconciliation error (got ${c.reconciliationErrors.length})`,
  );
}

// ---------------------------------------------------------------------------
// Case 6: a clean run reports no masked negatives at all.
// ---------------------------------------------------------------------------
{
  const c = buildVerdictCensus(
    [
      fixture("positive/ok.ts", true, runsOf(5, true, v(true, "high"))),
      fixture("negative/ok.ts", false, runsOf(5, false, v(false, "low"))),
    ],
    5,
  );
  check(c.maskedNegatives.length === 0, "clean corpus reports zero masked negatives");
  check(c.assertedButNotEmitted === 0, "clean corpus reports zero asserted-but-not-emitted");
  check(c.reconciled, "clean corpus reconciles");
  check(
    formatVerdictCensus(c).includes("Every negative's clean pass is backed by a safe verdict"),
    "the clean-corpus census says so explicitly",
  );
}

// ---------------------------------------------------------------------------
// Case 7: scoring on ASSERTION, not EMISSION. This is the whole fix.
// ---------------------------------------------------------------------------
{
  // env-exposure/negative/03 shape: emitted nothing 5/5, asserted vulnerable 5/5.
  const runs = runsOf(5, false, v(true, "medium"));

  // The OLD proxy: nRuns - flaggedCount === 5, so it scored correctly-skipped 5/5 PASS.
  const oldProxyClean = runs.length - runs.filter((r) => r.flagged).length;
  check(oldProxyClean === 5, "the OLD emission proxy would have scored this 5/5 clean");

  const s = scoreNegative("03-fastify-redacted-logs.ts", runs, {});
  check(s.cleanRuns === 0, `undeclared negative asserting vulnerable: clean 0/5 (got ${s.cleanRuns})`);
  check(s.violations === 5, `all 5 runs counted as violations (got ${s.violations})`);
  check(s.excused === 0, "nothing excused without a declaration");
  check(!s.declared, "fixture carries no declaration");
}

// ---------------------------------------------------------------------------
// Case 8: a DECLARED negative asserting its declared class passes, and the
// excusal is visible rather than silent.
// ---------------------------------------------------------------------------
{
  const s = scoreNegative(
    "14-app-router-apple-cross-file-verifier-helper.ts",
    runsOf(5, false, v(true, "medium")),
    { "14-app-router-apple-cross-file-verifier-helper.ts": ["vuln/medium"] },
  );
  check(s.cleanRuns === 5, `declared MEDIUM negative: clean 5/5 (got ${s.cleanRuns})`);
  check(s.violations === 0, "no violations when the asserted class is declared");
  check(s.excused === 5, `all 5 runs reported as excused (got ${s.excused})`);
  check(s.declared, "fixture is marked as carrying a declaration");
}

// ---------------------------------------------------------------------------
// Case 9: NEGATIVE CONTROL for the declaration. A declaration is NARROW: it
// excuses the class it names and nothing else. Weakening the lookup to "is this
// fixture declared at all" makes this case fail and no other.
// ---------------------------------------------------------------------------
{
  const s = scoreNegative(
    "14-app-router-apple-cross-file-verifier-helper.ts",
    runsOf(5, false, v(true, "high")), // HIGH, not the declared MEDIUM
    { "14-app-router-apple-cross-file-verifier-helper.ts": ["vuln/medium"] },
  );
  check(
    s.violations === 5,
    `a declared fixture asserting an UNDECLARED class still violates (got ${s.violations})`,
  );
  check(s.cleanRuns === 0, "a MEDIUM declaration does not excuse a HIGH assertion");
  check(s.excused === 0, "nothing excused when the class does not match");
}

// ---------------------------------------------------------------------------
// Case 10: a genuinely safe negative is clean with or without a declaration.
// ---------------------------------------------------------------------------
{
  const safe = runsOf(5, false, v(false, "low"));
  check(scoreNegative("n.ts", safe, {}).cleanRuns === 5, "safe/low negative: clean 5/5 undeclared");
  check(
    scoreNegative("n.ts", safe, { "n.ts": ["vuln/medium"] }).excused === 0,
    "a declaration excuses nothing when the model never asserted",
  );
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.stdout.write("FAIL\n");
  process.exit(1);
}
process.stdout.write("PASS\n");
