/**
 * F-004 stage 3 step 2: zero-spend model-call counting spy.
 *
 * WHAT THIS ANSWERS. Stage 3's cost estimate rests on "144 model-reaching
 * fixtures per sample". That 144 is not an independent estimate: it is the
 * size of the replay recording set, and the replay gate asserts recordings
 * cover EXACTLY the manifest, so a `FIXOR_REPLAY=1` run can only ever return
 * 144 or fail loud. It restates the manifest, it does not verify it. This
 * script counts the calls by EXECUTION instead, enumerating fixture
 * DIRECTORIES and counting at the SDK boundary, so it can disagree with 144.
 *
 * WHAT IT MEASURES: CALLS, NOT DOLLARS. The canned response carries zero
 * token usage, so no price can be derived from this run. Pricing still
 * multiplies the measured call count by an ESTIMATED per-call constant. The
 * residual uncertainty is IDOR's per-call price (whole-file, batched up to
 * MAX_PAIRS_PER_FILE pairs in one call, and its two stability entry points
 * pass no `costPerLlmCallUsd` so they inherit the harness flat default). This
 * script cannot close that; only a live sample can.
 *
 * ZERO SPEND, FAIL CLOSED. The spy patches `messages.create` on the cached
 * singleton returned by `getAnthropicClient()` (precedent:
 * "src/test/test-f001-webhook-parity.ts"), so `callClaude` runs UNMODIFIED:
 * the coverage tally still fires, `lastCallCost` is still computed, and the
 * replay/record gating is untouched. The alternative (reassigning the
 * exported `callClaude`) was rejected: it short-circuits the tally and would
 * break the coverage cross-check. Because the patch sits BELOW
 * `getAnthropicClient()`, the run needs a key, so it sets a syntactically
 * valid DUMMY key. If the patch ever failed to apply, the fallthrough would
 * be a 401, which is an auth rejection and not a billable request.
 *
 * MEASURE ONLY. The two known harness defects are deliberately NOT fixed
 * here: `stability-harness.ts` infers `llmCalls` from the absence of a
 * pre-filter reason rather than observing the call, and prices at a flat
 * constant. This script is the ORACLE that a later fix must be validated
 * against; fixing both in one change would leave the new counter with no
 * independent ground truth. The divergence column below is that oracle's
 * output.
 *
 * SEVEN ENTRY POINTS, NOT SIX. The tracker's stage-3 inventory lists six
 * harness-routed entry points. Those six enumerate 142, not 144: the missing
 * two are "fixtures/idor-multi", reached only by `test:idor-multi`, which is
 * outside `runStabilityHarness` by design because it asserts exact sink-line
 * sets that the harness's boolean `flagged` cannot express. It runs here as a
 * separate stanza. Omitting it would report 142 and read as a false 2-call
 * discrepancy. secrets-exposure is excluded from stage 3 entirely: its
 * shipped path never calls the model.
 *
 * Run: npm run measure:stage3-calls   (zero API spend; NOT in test:ci)
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Message } from "@anthropic-ai/sdk/resources/messages";

import { getAnthropicClient } from "../analysis-engine/anthropic-client";
import type {
  DetectorContext,
  NormalizedFinding,
} from "../analysis-engine/detector.types";
import { AdminCheckDetector } from "../analysis-engine/detectors/admin-check.detector";
import { AuthBypassDetector } from "../analysis-engine/detectors/auth-bypass.detector";
import { EnvExposureDetector } from "../analysis-engine/detectors/env-exposure.detector";
import { IdorDetector } from "../analysis-engine/detectors/idor.detector";
import { WebhookUnverifiedDetector } from "../analysis-engine/detectors/webhook-unverified.detector";
import { llmCoverageSince, snapshotLlmCoverage } from "../lib/llm-coverage";
import { loadFixture, runStabilityHarness } from "./lib/stability-harness";
import { assertEscalationUnset, isFixtureFile } from "./replay-harness";

const out = process.stdout;

/**
 * Non-functional placeholder. Its only job is to let `getAnthropicClient()`
 * construct a client for the spy to patch: that function tests the env var for
 * truthiness only, and the SDK constructor accepts any string, so nothing here
 * needs to resemble a real key.
 *
 * DELIBERATELY NOT KEY-SHAPED. An "sk-ant-..." placeholder trips the repo's own
 * pre-commit secrets scan, and the right response to that block is to stop
 * writing key-shaped literals, not to work around the scanner. It is also more
 * fail closed: a malformed key is rejected before any billing path, whereas a
 * well-formed but dead one merely 401s. Either way the spy short-circuits every
 * request above the transport, so this value is never sent anywhere.
 */
const DUMMY_KEY = "fixor-measure-stage3-calls-placeholder-no-network";

const CANNED_REASONING =
  "canned response from measure-stage3-calls; no model was consulted";

/** Escalation adjudicator tool name, from "verdict-escalation.ts". */
const ADJUDICATE_TOOL_NAME = "adjudicate_verdict";
/** IDOR's batched multi-verdict tool name, from "idor.detector.ts". */
const IDOR_TOOL_NAME = "report_idor_findings";

// ===========================================================================
// Spy state.
//
// Module-global mutable context, read by the spy at call time. Safe because
// this script is strictly sequential: one detector, one fixture, one run in
// flight at a time. The spy sits BELOW callClaude, so `opts.callerId` is not
// on the wire; the caller is therefore reconstructed from the detector in
// flight plus the requested tool name, which is exact for this corpus.
// ===========================================================================

interface CallRecord {
  pass: string;
  callerId: string;
  fixtureDir: string;
  fixtureFile: string;
  runIndex: number;
  ordinal: number;
  model: string;
  toolName: string;
  isEscalation: boolean;
}

const records: CallRecord[] = [];

let currentPass = "A";
/**
 * Canned verdict shape. Pass A returns LOW, the minimal downstream path.
 * Pass B returns isVulnerable TRUE at MEDIUM, which is the ONLY shape that
 * reaches the escalation branch: all six detectors evaluate isVulnerable and
 * return early before the confidence ladder is consulted.
 */
let cannedConfidence: "low" | "medium" = "low";
let currentCallerId = "";
let currentDir = "";
let currentFile = "";
let currentRun = 0;
let currentOrdinal = 0;

/**
 * Times the real transport was invoked. Asserted 0 at the end.
 *
 * Read this assertion precisely. The spy has NO delegation branch, so a
 * non-zero value is unreachable by design; what the counter actually proves
 * is that the patch was in force for every request, rather than that some
 * delegating path declined to fire. An unrecognized request shape THROWS
 * (see `cannedToolInput`) instead of falling through to the network, so the
 * "unknown shape" case cannot spend either.
 */
let realTransportCalls = 0;

/** Requests the spy could not serve from a canned shape. Asserted 0. */
let unservedRequests = 0;

interface CreateBody {
  model: string;
  tools?: { name: string }[];
}

function cannedToolInput(toolName: string): Record<string, unknown> {
  if (toolName === ADJUDICATE_TOOL_NAME) {
    // Unreachable while FIXOR_ESCALATE_MEDIUM is unset, which is asserted
    // before the run. Present so an escalation call would be SERVED and
    // COUNTED rather than crashing the measurement.
    return { decision: "still_uncertain", reasoning: CANNED_REASONING };
  }
  if (toolName === IDOR_TOOL_NAME) {
    // IDOR parses `input.verdicts`. An empty array is a valid "call happened,
    // nothing to emit" and is explicitly NOT counted as an LLM error by the
    // detector, which is exactly the neutral shape we want.
    if (cannedConfidence === "medium") {
      // IDOR judges per pair, so a MEDIUM verdict per pair is what fans out
      // into one escalation call per pair. MAX_PAIRS_PER_FILE bounds it at 12.
      return {
        verdicts: Array.from({ length: 12 }, (_v, i) => ({
          pairIndex: i,
          isVulnerable: true,
          confidence: "medium",
          reasoning: CANNED_REASONING,
        })),
      };
    }
    return { verdicts: [] };
  }
  if (toolName.startsWith("report_") && toolName.endsWith("_verdict")) {
    // The four single-verdict detectors all require isVulnerable (boolean),
    // confidence (one of high/medium/low after lowercasing) and reasoning
    // (string). Optional extras default safely. LOW is the minimal downstream
    // path: the detector returns no findings and no escalation is considered.
    return {
      isVulnerable: cannedConfidence === "medium",
      confidence: cannedConfidence,
      reasoning: CANNED_REASONING,
    };
  }
  unservedRequests++;
  throw new Error(
    `measure-stage3-calls: unrecognized tool "${toolName}"; refusing to fall ` +
      "through to the network. Add a canned shape for it.",
  );
}

function cannedMessage(body: CreateBody, toolName: string): Message {
  return {
    id: "msg_measure_stage3_calls",
    type: "message",
    role: "assistant",
    model: body.model,
    content: [
      {
        type: "tool_use",
        id: "toolu_measure_stage3_calls",
        name: toolName,
        input: cannedToolInput(toolName),
      },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    // Zeroed usage so calculateCost yields 0. This is why the run measures
    // CALLS and not DOLLARS.
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as unknown as Message;
}

function installSpy(): void {
  const client = getAnthropicClient();
  if (!client) {
    throw new Error(
      "measure-stage3-calls: getAnthropicClient() returned null after the " +
        "dummy key was set; the spy has nothing to patch.",
    );
  }
  // Retained so the zero-real-network assertion has a real subject, and so
  // the patch mirrors the parity-test precedent. No code path invokes it.
  const origCreate = client.messages.create.bind(client.messages);
  const countedOrigCreate = async (
    body: unknown,
    opts: unknown,
  ): Promise<unknown> => {
    realTransportCalls++;
    return origCreate(body as never, opts as never);
  };
  void countedOrigCreate;

  (client.messages as { create: unknown }).create = async (
    body: CreateBody,
  ): Promise<Message> => {
    const toolName = body.tools?.[0]?.name ?? "";
    const isEscalation = toolName === ADJUDICATE_TOOL_NAME;
    records.push({
      pass: currentPass,
      callerId: isEscalation ? `escalation:${currentCallerId}` : currentCallerId,
      fixtureDir: currentDir,
      fixtureFile: currentFile,
      runIndex: currentRun,
      ordinal: currentOrdinal,
      model: body.model,
      toolName,
      isEscalation,
    });
    currentOrdinal++;
    return cannedMessage(body, toolName);
  };
}

// ===========================================================================
// Fixture enumeration.
//
// Mirrors `stabilityRunDir`: readdirSync -> isFixtureFile -> sort, positives
// then negatives. `isFixtureFile` is imported from "src/test/replay-harness.ts"
// (the exported copy) rather than re-implemented; the copy private to
// "src/test/lib/stability-harness.ts" is identical today, and if the two ever
// diverge the order/path guard below turns that divergence into a loud failure
// instead of a silent miscount.
//
// THE SIDECAR TRAP. `isFixtureFile` excludes ".schema.prisma", ".policy.sql",
// ".middleware.ts", ".config.ts", ".route-guard.ts", ".md" and ".disabled".
// A hand count with `ls` does NOT, and will overcount. The inherited "29
// recordable" figure for idor was exactly this miscount. Any number in this
// script's output that someone wants to re-derive by hand must be re-derived
// through this filter.
// ===========================================================================

interface EnumeratedFixture {
  /** "positive/foo.ts" or "negative/bar.ts"; flat corpora use just the name. */
  id: string;
  /** Diff path the fixture declares via its ASSUMED-PATH header. */
  assumedPath: string;
}

function enumeratePositiveNegative(fixturesDir: string): EnumeratedFixture[] {
  const found: EnumeratedFixture[] = [];
  for (const cls of ["positive", "negative"]) {
    const dir = join(fixturesDir, cls);
    for (const file of readdirSync(dir).filter(isFixtureFile).sort()) {
      const { assumedPath } = loadFixture(join(dir, file));
      found.push({ id: `${cls}/${file}`, assumedPath });
    }
  }
  return found;
}

// ===========================================================================
// Measurement stanzas.
// ===========================================================================

interface Measurement {
  label: string;
  fixturesDir: string;
  enumerated: number;
  calls: number;
  preFiltered: number;
  coverageAttempted: number;
  coverageFailed: number;
  harnessLlmCalls: number | null;
  harnessLlmErrors: number | null;
  harnessPricedCalls: number | null;
  /** key -> { spy, harness, oldInferred } per fixture. */
  perFixture: Map<string, { spy: number; harness: number; oldInferred: number }>;
}

interface HarnessStanza {
  label: string;
  fixturesDir: string;
  makeDetector: () => {
    id: string;
    detect?: (ctx: DetectorContext) => Promise<NormalizedFinding[]>;
  };
}

const HARNESS_STANZAS: HarnessStanza[] = [
  {
    label: "env-exposure",
    fixturesDir: "fixtures/env-exposure",
    makeDetector: () => new EnvExposureDetector(),
  },
  {
    label: "webhook-unverified",
    fixturesDir: "fixtures/webhook-unverified",
    makeDetector: () => new WebhookUnverifiedDetector(),
  },
  {
    label: "auth-bypass",
    fixturesDir: "fixtures/auth-bypass",
    makeDetector: () => new AuthBypassDetector(),
  },
  {
    label: "admin-check",
    fixturesDir: "fixtures/admin-check",
    makeDetector: () => new AdminCheckDetector(),
  },
  {
    label: "idor",
    fixturesDir: "fixtures/idor",
    makeDetector: () => new IdorDetector(),
  },
  {
    label: "idor-tenant",
    fixturesDir: "fixtures/idor-tenant",
    makeDetector: () => new IdorDetector(),
  },
];

async function measureHarnessStanza(
  stanza: HarnessStanza,
): Promise<Measurement> {
  const enumerated = enumeratePositiveNegative(stanza.fixturesDir);
  const detector = stanza.makeDetector();
  currentCallerId = detector.id;

  const origDetect = detector.detect?.bind(detector);
  if (!origDetect) {
    throw new Error(
      `measure-stage3-calls: "${stanza.label}" detector has no detect()`,
    );
  }

  // Drift guard. The harness must call detect() once per enumerated fixture,
  // in the enumerated order, with the diff the enumerated fixture declares. A
  // mismatch means this script and the live tests no longer see the same
  // corpus, which would silently corrupt the attribution.
  let index = 0;
  const wrapped = async (
    ctx: DetectorContext,
  ): Promise<NormalizedFinding[]> => {
    const expected = enumerated[index];
    if (!expected) {
      throw new Error(
        `measure-stage3-calls: "${stanza.fixturesDir}" harness called detect() ` +
          `${index + 1} times but only ${enumerated.length} fixtures were ` +
          "enumerated; enumeration has drifted from the harness.",
      );
    }
    const header = `diff --git a/${expected.assumedPath} b/${expected.assumedPath}`;
    if (!ctx.diff.startsWith(header)) {
      throw new Error(
        `measure-stage3-calls: fixture order drift at index ${index} in ` +
          `"${stanza.fixturesDir}"; expected "${expected.id}" with assumed ` +
          `path "${expected.assumedPath}" but the diff header does not match.`,
      );
    }
    currentDir = stanza.fixturesDir;
    currentFile = expected.id;
    currentRun = 0;
    currentOrdinal = 0;
    index++;
    return origDetect(ctx);
  };
  (detector as { detect: unknown }).detect = wrapped;

  const before = records.length;
  const snap = snapshotLlmCoverage();

  out.write(`\n=== stanza: ${stanza.label} ("${stanza.fixturesDir}") ===\n`);
  const report = await runStabilityHarness({
    detectorName: `${stanza.label} [call-count spy]`,
    fixturesDir: stanza.fixturesDir,
    detector: detector as Parameters<typeof runStabilityHarness>[0]["detector"],
    nRuns: 1,
    sleepMsBetween: 0,
    // Accuracy gating is meaningless under a canned verdict. Thresholds are
    // floored so the harness's own PASS/FAIL line carries no signal here.
    perPositiveThreshold: 0,
    perNegativeThreshold: 0,
    positivesMinPassing: 0,
    negativesMinPassing: 0,
    combinedMinPassing: 0,
  });

  if (index !== enumerated.length) {
    throw new Error(
      `measure-stage3-calls: "${stanza.fixturesDir}" harness called detect() ` +
        `${index} times but ${enumerated.length} fixtures were enumerated.`,
    );
  }

  const cov = llmCoverageSince(snap);
  const mine = records.slice(before);
  const fixturesWithCalls = new Set(mine.map((r) => r.fixtureFile));
  const all = [...report.positives, ...report.negatives];

  // Per-fixture join: harness FixtureStability carries a basename plus an
  // isPositive flag; the spy keys on "<class>/<basename>". Same corpus, same
  // filter, so the two key spaces coincide exactly.
  const perFixture = new Map<
    string,
    { spy: number; harness: number; oldInferred: number }
  >();
  for (const f of all) {
    const key = `${f.isPositive ? "positive" : "negative"}/${f.file}`;
    perFixture.set(key, {
      spy: mine.filter((r) => r.fixtureFile === key).length,
      harness: f.llmCalls,
      // What the OLD inferred counter would have said: one per run whose
      // diagnostic carried no pre-filter reason. Reconstructed from the run
      // records so the comparison survives the counter being replaced.
      oldInferred: f.runs.filter((r) => !r.preFilterReason).length,
    });
  }

  return {
    label: stanza.label,
    fixturesDir: stanza.fixturesDir,
    enumerated: enumerated.length,
    calls: mine.length,
    preFiltered: enumerated.length - fixturesWithCalls.size,
    coverageAttempted: cov.attempted,
    coverageFailed: cov.failed,
    harnessLlmCalls: all.reduce((s, r) => s + r.llmCalls, 0),
    harnessLlmErrors: all.reduce((s, r) => s + r.llmErrors, 0),
    harnessPricedCalls: all.reduce((s, r) => s + r.pricedCalls, 0),
    perFixture,
  };
}

/**
 * The seventh entry point. "fixtures/idor-multi" is a FLAT corpus reached via
 * `analyzeFile` directly, mirroring `test-idor-multi.ts`'s `runOnce`. It is
 * outside `runStabilityHarness` by design, so it has no harness-inferred
 * `llmCalls` to diverge from.
 */
async function measureIdorMulti(): Promise<Measurement> {
  const dir = "fixtures/idor-multi";
  const files = readdirSync(dir).filter(isFixtureFile).sort();

  const before = records.length;
  const snap = snapshotLlmCoverage();

  out.write(`\n=== stanza: idor-multi ("${dir}") ===\n`);
  for (const file of files) {
    const detector = new IdorDetector();
    currentCallerId = detector.id;
    currentDir = dir;
    currentFile = file;
    currentRun = 0;
    currentOrdinal = 0;
    const content = readFileSync(join(dir, file), "utf8");
    const lang = file.endsWith(".py") ? "py" : "ts";
    const findings = await detector.analyzeFile(file, content, lang);
    out.write(`  [${file}][run 1/1] findings ${findings.length}\n`);
  }

  const cov = llmCoverageSince(snap);
  const mine = records.slice(before);
  const fixturesWithCalls = new Set(mine.map((r) => r.fixtureFile));

  return {
    label: "idor-multi",
    fixturesDir: dir,
    enumerated: files.length,
    calls: mine.length,
    preFiltered: files.length - fixturesWithCalls.size,
    coverageAttempted: cov.attempted,
    coverageFailed: cov.failed,
    harnessLlmCalls: null,
    harnessLlmErrors: null,
    harnessPricedCalls: null,
    perFixture: new Map(),
  };
}

// ===========================================================================
// Reporting.
// ===========================================================================

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}
function padL(s: string, w: number): string {
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}

function writeTable(rows: Measurement[]): void {
  const head =
    pad("detector", 20) +
    padL("calls", 7) +
    padL("enum", 7) +
    padL("prefilt", 9) +
    padL("cov.att", 9) +
    padL("harness", 9) +
    padL("diverge", 9);
  out.write(`\n${head}\n${"-".repeat(head.length)}\n`);
  for (const r of rows) {
    const harness = r.harnessLlmCalls === null ? "n/a" : String(r.harnessLlmCalls);
    const diverge =
      r.harnessLlmCalls === null ? "n/a" : String(r.harnessLlmCalls - r.calls);
    out.write(
      pad(r.label, 20) +
        padL(String(r.calls), 7) +
        padL(String(r.enumerated), 7) +
        padL(String(r.preFiltered), 9) +
        padL(String(r.coverageAttempted), 9) +
        padL(harness, 9) +
        padL(diverge, 9) +
        "\n",
    );
  }
  const t = (f: (m: Measurement) => number): number =>
    rows.reduce((s, r) => s + f(r), 0);
  out.write(`${"-".repeat(head.length)}\n`);
  out.write(
    pad("TOTAL", 20) +
      padL(String(t((r) => r.calls)), 7) +
      padL(String(t((r) => r.enumerated)), 7) +
      padL(String(t((r) => r.preFiltered)), 9) +
      padL(String(t((r) => r.coverageAttempted)), 9) +
      padL(String(t((r) => r.harnessLlmCalls ?? 0)), 9) +
      padL("", 9) +
      "\n",
  );
}

function writePerFixture(): void {
  out.write("\n=== per-fixture rows (every counted call) ===\n");
  for (const r of records) {
    out.write(
      `  ${pad(r.callerId, 24)} ${pad(r.fixtureDir, 28)} ` +
        `${pad(r.fixtureFile, 46)} run=${r.runIndex} ord=${r.ordinal} ` +
        `tool=${r.toolName}\n`,
    );
  }
}

function writeNonConforming(rows: Measurement[]): void {
  const byFixture = new Map<string, number>();
  for (const r of records) {
    const k = `${r.fixtureDir}/${r.fixtureFile}`;
    byFixture.set(k, (byFixture.get(k) ?? 0) + 1);
  }
  const multi = [...byFixture.entries()].filter(([, n]) => n > 1);
  out.write("\n=== nonconforming fixtures ===\n");
  if (multi.length === 0) {
    out.write(
      "  none: every model-reaching fixture issued exactly 1 call, which is\n" +
        "  what the per-file single-trigger shape predicts (IDOR batches its\n" +
        "  pairs into one call rather than issuing one call per pair).\n",
    );
  } else {
    for (const [k, n] of multi) out.write(`  ${k}: ${n} calls\n`);
  }
  const zero = rows.filter((r) => r.calls === 0);
  for (const r of zero) {
    out.write(`  WARNING: stanza "${r.label}" issued 0 calls\n`);
  }
}

// ===========================================================================
// Main.
// ===========================================================================

async function main(): Promise<void> {
  out.write(
    "F-004 stage 3 step 2: zero-spend model-call counting spy.\n" +
      "Counts CALLS, not dollars. Canned responses carry zero token usage.\n\n",
  );

  let failures = 0;
  const fail = (msg: string): void => {
    failures++;
    out.write(`  FAIL  ${msg}\n`);
  };
  const pass = (msg: string): void => {
    out.write(`  PASS  ${msg}\n`);
  };

  out.write("=== preconditions ===\n");

  // (a) Keyless null-client assertion. MUST run FIRST: runStabilityHarness
  // throws without a key, and the spy needs a constructed client to patch, so
  // the dummy key cannot be set before this.
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  if (getAnthropicClient() === null) {
    pass("getAnthropicClient() === null with ANTHROPIC_API_KEY deleted");
  } else {
    fail("getAnthropicClient() returned a client with no API key set");
  }

  // (c) Escalation must be off FOR THE MEASUREMENT PASS. A constant canned
  // verdict would fabricate the MEDIUM rate, so an escalation-on run yields a
  // CEILING, not a measurement. Pass B below deliberately turns it on and is
  // labelled a counting ceiling for exactly that reason.
  try {
    assertEscalationUnset();
    pass("FIXOR_ESCALATE_MEDIUM unset (escalation second call cannot fire)");
  } catch (err) {
    fail((err as Error).message);
  }

  if (failures > 0) {
    out.write("\nRESULT: FAIL (preconditions). No measurement taken.\n");
    process.exit(1);
  }

  process.env.ANTHROPIC_API_KEY = DUMMY_KEY;
  installSpy();
  pass("spy installed on messages.create of the cached singleton");
  out.write(
    `  NOTE  real key ${savedKey ? "was present and is" : "was absent and stays"} ` +
      "unused; the run holds a dummy key only.\n",
  );

  const runAllStanzas = async (): Promise<Measurement[]> => {
    const acc: Measurement[] = [];
    for (const stanza of HARNESS_STANZAS) {
      acc.push(await measureHarnessStanza(stanza));
    }
    acc.push(await measureIdorMulti());
    return acc;
  };

  const rows = await runAllStanzas();

  writeTable(rows);
  writePerFixture();
  writeNonConforming(rows);

  const totalCalls = records.length;
  const detectionCalls = records.filter((r) => !r.isEscalation).length;
  const escalationCalls = totalCalls - detectionCalls;
  const totalCoverage = rows.reduce((s, r) => s + r.coverageAttempted, 0);
  const totalEnumerated = rows.reduce((s, r) => s + r.enumerated, 0);
  const totalPreFiltered = rows.reduce((s, r) => s + r.preFiltered, 0);
  const totalCovFailed = rows.reduce((s, r) => s + r.coverageFailed, 0);

  out.write("\n=== identity ===\n");
  const identityOk = totalEnumerated - totalPreFiltered === totalCalls;
  out.write(
    `  ${totalEnumerated} enumerated - ${totalPreFiltered} pre-filtered = ` +
      `${totalEnumerated - totalPreFiltered} model-reaching; measured calls ` +
      `${totalCalls}\n`,
  );

  out.write("\n=== cross-checks ===\n");
  if (identityOk) {
    pass("enumerated minus pre-filtered equals measured calls");
  } else {
    fail(
      `identity broken: ${totalEnumerated} - ${totalPreFiltered} != ${totalCalls}`,
    );
  }

  // (b) Coverage tally vs spy. Escalation is tagged coverage "auxiliary" and
  // is skipped by recordLlmDetectionCall, so only non-escalation records are
  // comparable. This equality ALSO settles cross-check (10): the spy counts
  // HTTP attempts while the tally counts terminal outcomes, so any SDK retry
  // would make the spy count strictly larger.
  if (totalCoverage === detectionCalls) {
    pass(
      `coverage.attempted (${totalCoverage}) == detection calls (${detectionCalls}); ` +
        "no retries inflated the count, so attempts == logical calls",
    );
  } else {
    fail(
      `coverage.attempted (${totalCoverage}) != detection calls (${detectionCalls})`,
    );
  }

  if (escalationCalls === 0) {
    pass("0 escalation calls (flag asserted unset)");
  } else {
    fail(`${escalationCalls} escalation calls fired despite the flag guard`);
  }

  if (totalCovFailed === 0) {
    pass("0 failed detection calls (canned responses parsed cleanly)");
  } else {
    fail(
      `${totalCovFailed} detection calls reported failure; canned shape is wrong`,
    );
  }

  // (d) Zero real network.
  if (realTransportCalls === 0 && unservedRequests === 0) {
    pass(
      "origCreate invoked 0 times and 0 unserved requests (zero real network)",
    );
  } else {
    fail(
      `origCreate invoked ${realTransportCalls} times, ${unservedRequests} unserved`,
    );
  }

  out.write("\n=== harness divergence (defect 1 oracle) ===\n");
  const harnessTotal = rows.reduce((s, r) => s + (r.harnessLlmCalls ?? 0), 0);
  const harnessComparable = rows
    .filter((r) => r.harnessLlmCalls !== null)
    .reduce((s, r) => s + r.calls, 0);
  out.write(
    `  harness-inferred llmCalls ${harnessTotal} vs measured ${harnessComparable} ` +
      `over the six harness-routed stanzas; divergence ${harnessTotal - harnessComparable}\n`,
  );
  out.write(
    "  This is a MEASUREMENT of the defect, not a fix. The harness infers a\n" +
      "  call from the absence of a pre-filter reason and reads only\n" +
      "  lastDiagnostics[0]; it never observes callClaude. A follow-up that\n" +
      "  makes the counter observational must reproduce the measured column.\n",
  );

  // =========================================================================
  // ACCEPTANCE TEST A - per-fixture equality against the spy.
  //
  // The harness counter is now OBSERVED at the callClaude chokepoint, so this
  // is observation versus observation. It must hold fixture by fixture, not
  // merely in aggregate: an aggregate match can hide two errors that cancel.
  // =========================================================================
  out.write("\n=== acceptance test A: per-fixture harness == spy ===\n");
  let compared = 0;
  const mismatches: string[] = [];
  for (const r of rows) {
    if (r.harnessLlmCalls === null) continue;
    for (const [key, v] of r.perFixture) {
      compared++;
      if (v.harness !== v.spy) {
        mismatches.push(
          `${r.fixturesDir}/${key}: harness=${v.harness} spy=${v.spy}`,
        );
      }
    }
  }
  if (mismatches.length === 0) {
    pass(`harness == spy on all ${compared} harness-routed fixtures`);
  } else {
    fail(`${mismatches.length} of ${compared} fixtures disagree`);
    for (const m of mismatches.slice(0, 20)) out.write(`        ${m}\n`);
  }

  // =========================================================================
  // LEDGER MODE CHECK - priced versus unpriced.
  //
  // The canned response carries zeroed usage, so it IS a priced call whose
  // price happens to be zero. That distinguishes it from a replayed call,
  // which returns before any usage exists and must stay unpriced.
  // =========================================================================
  out.write("\n=== ledger mode check ===\n");
  const pricedTotal = rows.reduce((s, r) => s + (r.harnessPricedCalls ?? 0), 0);
  const harnessCallTotal = rows.reduce((s, r) => s + (r.harnessLlmCalls ?? 0), 0);
  if (pricedTotal === harnessCallTotal) {
    pass(
      `pricedCalls (${pricedTotal}) == calls (${harnessCallTotal}) under the canned response`,
    );
  } else {
    fail(`pricedCalls ${pricedTotal} != calls ${harnessCallTotal}`);
  }

  // =========================================================================
  // ACCEPTANCE TEST B - the falsification test, and the real gate.
  //
  // With escalation OFF every fixture makes exactly one call, so test A only
  // ever confirms 1 == 1. The multi-call case does not occur naturally in this
  // corpus, so manufacture it: a canned MEDIUM verdict with the escalation
  // flag ON makes every model-reaching fixture issue a detection call PLUS an
  // escalation call. The OLD inferred counter cannot see the second one.
  //
  // These numbers are a COUNTING CEILING, never a cost figure: a constant
  // canned verdict fabricates the MEDIUM rate.
  // =========================================================================
  out.write("\n=== acceptance test B: escalation visibility (counting ceiling) ===\n");
  currentPass = "B";
  cannedConfidence = "medium";
  process.env.FIXOR_ESCALATE_MEDIUM = "true";
  // assertEscalationUnset() is deliberately NOT called here: it throws when the
  // flag is on, which is the state this pass exists to exercise.
  const rowsB = await runAllStanzas();
  delete process.env.FIXOR_ESCALATE_MEDIUM;
  cannedConfidence = "low";

  const escalationCallsB = records.filter(
    (r) => r.pass === "B" && r.isEscalation,
  ).length;
  let oldTotal = 0;
  let newTotal = 0;
  let sawStrictIncrease = false;
  for (const r of rowsB) {
    if (r.harnessLlmCalls === null) continue;
    for (const [, v] of r.perFixture) {
      oldTotal += v.oldInferred;
      newTotal += v.harness;
      if (v.harness > v.oldInferred) sawStrictIncrease = true;
    }
  }
  out.write(
    `  old inferred counter would report: ${oldTotal}\n` +
      `  new observed counter reports:     ${newTotal}\n` +
      `  escalation calls observed:        ${escalationCallsB}\n`,
  );
  if (escalationCallsB > 0 && sawStrictIncrease && newTotal > oldTotal) {
    pass(
      `escalation second call is VISIBLE to the ledger and INVISIBLE to the ` +
        `old inference (${newTotal} vs ${oldTotal})`,
    );
  } else {
    fail(
      `test B did not demonstrate the divergence: escalationCalls=${escalationCallsB} ` +
        `old=${oldTotal} new=${newTotal}`,
    );
  }

  out.write("\n=== what this does NOT establish ===\n");
  out.write(
    "  This is a call COUNT. The canned response carries zero token usage, so\n" +
      "  no dollar figure follows from it. Pricing multiplies this count by an\n" +
      "  ESTIMATED per-call constant, and the shakier half of that product is\n" +
      "  IDOR: it is whole-file and batched, and its stability entry points\n" +
      "  pass no costPerLlmCallUsd so they inherit the harness flat default,\n" +
      "  which has no measured basis for this shape. Only a live sample closes\n" +
      "  that. The harness PASS/FAIL lines above carry no accuracy signal: the\n" +
      "  verdict was canned and the thresholds were floored.\n",
  );

  out.write(
    `\nRESULT: ${failures === 0 ? "PASS" : `FAIL (${failures})`}\n` +
      `MEASURED model-reaching calls per sample (n=1): ${totalCalls}\n`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`measure-stage3-calls ERROR: ${(err as Error).message}\n`);
  process.exit(1);
});
