/**
 * F-004 stage 2b.0 - shared, parameterized replay recorder + replay gate.
 *
 * WHY THIS EXISTS: stage 2a shipped a recorder and a replay gate hard-wired to
 * the env-exposure detector. Every later detector (webhook-unverified, auth-
 * bypass, admin-check, idor, secrets-exposure) needs the SAME mechanism -
 * build the detector input from a fixture, run the real detector end to end
 * against a FROZEN recorded response, and assert an outcome - differing only in
 * (a) which fixtures/detector, (b) how a fixture maps to detector input (layout
 * + optional sidecars), and (c) the outcome shape asserted. This module lifts
 * the mechanism out so each per-detector file is a thin spec, not a copy.
 *
 * SCOPE AND LIMITS (F-008 guardrail; unchanged from 2a, kept in the shared code):
 *   The replay gate verifies detector WIRING, tool-input PARSING, and LANE /
 *   confidence-ladder logic against FROZEN recorded model samples only. It does
 *   NOT verify detection quality or model behavior. A replayed response is ONE
 *   frozen sample, not repeated sampling. A green replay gate is NOT "detection
 *   verified". Model-judgment coverage remains stage 3 (opt-in live), never here.
 *
 * BYTE-BEHAVIOR CONTRACT: loadFixture and buildSyntheticDiff below are moved
 * VERBATIM from the 2a env-exposure record/replay files. Replay looks fixtures
 * up by request-key, and the key hashes the exact diff bytes fed to detect().
 * A one-byte change to either helper would miss every committed key and fail
 * loud - so these two functions must never be "cleaned up".
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type {
  DetectorContext,
  NormalizedFinding,
} from "../analysis-engine/detector.types";
import {
  resolveReplayMode,
  lastRecordedFixture,
  resetLastRecordedFixture,
  type ReplayFixture,
} from "../analysis-engine/llm-replay";
import {
  lastCallCost,
  resetLastCallCost,
} from "../analysis-engine/anthropic-client";

const out = process.stdout;

// ===========================================================================
// Byte-frozen fixture -> diff builders (moved VERBATIM from the 2a files).
// ===========================================================================

/** Read a fixture, parse the `// ASSUMED-PATH:` header, strip it from content. */
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
  return { assumedPath, content: lines.join("\n") };
}

/** Build a whole-file "new file" synthetic unified diff at `filePath`. */
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

// ===========================================================================
// Structural detector view + spec + layout + outcome-assertion contracts.
// ===========================================================================

/**
 * Minimal structural view of a detector the harness drives. Each detector
 * declares its own private `FileDiagnostic` interface; we only rely on the
 * fields the gates read (verdict for lane/confidence display, preFilterReason
 * for the record-time SKIP message).
 */
export interface HarnessDetector {
  detect(ctx: DetectorContext): Promise<NormalizedFinding[]>;
  lastDiagnostics: ReadonlyArray<{
    preFilterReason?: string;
    verdict?: { isVulnerable: boolean; confidence: string } | null;
  }>;
}

/**
 * How a detector's fixtures are laid out on disk and turned into detector
 * input. Isolated behind this interface so env-exposure's positive/negative
 * subdirs, idor's four heterogeneous layouts, and the flat lane files each
 * plug in without touching the engines.
 */
export interface Layout {
  /** Resolve a CLI selector token to a canonical id (throws if ambiguous/invalid). */
  resolveSelector(sel: string): string;
  /**
   * Build the detector input for one id: the synthetic diff, plus any sidecars
   * (RLS/middleware/config bodies) the detector reads as labeled context. A
   * layout with no sidecars returns `{ diff }` with NO sidecarsByPath key, so
   * the call is byte-identical to `detect({ diff })`.
   */
  buildContext(id: string): DetectorContext;
}

/** Everything the replay gate's outcome assertion needs for one fixture. */
export interface OutcomeInput {
  id: string;
  findings: NormalizedFinding[];
  detector: HarnessDetector;
  recording: ReplayFixture;
}

/** The per-detector outcome shape: how a replayed run is judged pass/fail. */
export type OutcomeAssertion = (o: OutcomeInput) => {
  pass: boolean;
  detail: string;
};

/**
 * An expected verdict-lane for one fixture id. For detectors with a
 * MEDIUM/review-queue anchor (webhook-unverified negatives 14/15), the lane is
 * NOT observable from `findings` - a MEDIUM verdict returns [] with escalation
 * off, byte-identical to LOW/drop, and any emitted finding is always
 * confidence:"high". The lane is observable ONLY on the recorded diagnostic's
 * verdict, so this descriptor is matched against
 * `detector.lastDiagnostics[0].verdict` (see verdictLaneOutcome and the
 * record-time lane check in recordOne).
 */
export interface ExpectedLane {
  isVulnerable: boolean;
  confidence: string;
}

/**
 * One detector's full replay configuration. The engines below are pure
 * functions of a spec; a per-detector file supplies a spec and calls
 * `recordFixtures` / `runReplayGate`.
 */
export interface DetectorReplaySpec {
  /** Stable detector id = replay subdir under fixtures/replay + callClaude callerId. */
  detectorId: string;
  /** The detector's own SYSTEM_PROMPT_FINGERPRINT, for the human-legible drift guard. */
  systemPromptFingerprint: string;
  /** Source fixtures dir (for messages), e.g. "fixtures/env-exposure". */
  sourceDir: string;
  /** Recording dir, e.g. "fixtures/replay/env-exposure-multi". */
  replayDir: string;
  /** Ids that MUST each have a recording (completeness ground truth). */
  manifest: readonly string[];
  /** Disk layout + input builder. */
  layout: Layout;
  /** Fresh detector instance per call (never shared across fixtures). */
  makeDetector(): HarnessDetector;
  /** Record-time expected class per id: drives the class assertion + meta.expectedFlagged. */
  expectedFlagged(id: string): boolean;
  /**
   * Optional record-time/replay-time expected verdict-lane per id, for
   * detectors with a MEDIUM/review-queue anchor (webhook-unverified 14/15).
   * Returns undefined for ids with no declared lane. The record-time lane
   * check (recordOne) and the replay-time verdictLaneOutcome BOTH read this,
   * so both gates share one source of truth. Optional: env-exposure and other
   * lane-free specs omit it and are unaffected.
   */
  expectedLane?(id: string): ExpectedLane | undefined;
  /** Optional human note stamped into a recording's meta.note. */
  note?(id: string): string | undefined;
  /** Replay-time outcome shape (see the *Outcome helper factories below). */
  assertOutcome: OutcomeAssertion;
}

// ===========================================================================
// Outcome helper factories.
//
// The engine treats the outcome as a pluggable function: ANY shape is supported
// by supplying an OutcomeAssertion. `flaggedOutcome` below is the one shape
// exercised so far (env-exposure). Other shapes a later detector needs - e.g. a
// MEDIUM-vs-LOW verdict-lane assertion (webhook-unverified) or an exact
// finding-set assertion (idor-multi) - are added as sibling factories in the PR
// that wires AND fixture-tests them, not speculatively here.
// ===========================================================================

/**
 * flagged (>=1 finding) === recording.meta.expectedFlagged. The 2a env-exposure
 * shape. Used by any plain positive/negative "did it flag" detector (auth-bypass).
 */
export function flaggedOutcome(): OutcomeAssertion {
  return ({ findings, detector, recording }) => {
    const expected = recording.meta.expectedFlagged;
    if (typeof expected !== "boolean") {
      return { pass: false, detail: "meta.expectedFlagged missing" };
    }
    const flagged = findings.length > 0;
    const verdict = detector.lastDiagnostics[0]?.verdict ?? null;
    const vstr = verdict
      ? `isVulnerable:${verdict.isVulnerable}@${verdict.confidence}`
      : "verdict:none";
    return {
      pass: flagged === expected,
      detail: `flagged:${flagged} ${flagged === expected ? "==" : "!="} expected:${expected}  (${vstr})`,
    };
  };
}

/**
 * MEDIUM/review-queue verdict-lane assertion (webhook-unverified 14/15 anchor).
 *
 * WHY THIS READS THE DIAGNOSTIC, NOT THE FINDING: with escalation off (the
 * only record/replay mode, enforced by assertEscalationUnset), a MEDIUM verdict
 * routes to "review-queue" and the detector returns [] - byte-identical to LOW
 * and to drop - and any emitted finding is hard-coded confidence:"high". So the
 * lane is invisible in `findings`; it lives ONLY on
 * `detector.lastDiagnostics[0].verdict`. Each fixture is a single-file synthetic
 * diff (positiveNegativeLayout builds one file), so exactly one diagnostic is
 * pushed and lastDiagnostics[0] is unambiguous.
 *
 * The expected lane is read from the SAME source the recorder uses (the spec's
 * expectedLane); this factory is closed over that accessor and dispatched by the
 * spec's assertOutcome ONLY to ids that declare a lane. An id reaching here with
 * no declared lane is a dispatch/config error, reported as a loud pass:false
 * rather than silently passing.
 *
 * Parameterized by the declared lane's {isVulnerable, confidence} (a trivial
 * equality against the descriptor the spec already carries) rather than
 * hard-coding "medium"; for webhook the declared lane is
 * {isVulnerable:true, confidence:"medium"}, so this encodes the locked
 * MEDIUM/review-queue anchor contract while staying reusable.
 */
export function verdictLaneOutcome(
  expectedLane: (id: string) => ExpectedLane | undefined,
): OutcomeAssertion {
  return ({ id, detector }) => {
    const lane = expectedLane(id);
    if (!lane) {
      return {
        pass: false,
        detail: `verdictLaneOutcome dispatched to ${id} with no declared expectedLane (config error)`,
      };
    }
    const verdict = detector.lastDiagnostics[0]?.verdict ?? null;
    const vstr = verdict
      ? `isVulnerable:${verdict.isVulnerable}@${verdict.confidence}`
      : "verdict:none";
    const pass =
      verdict !== null &&
      verdict.isVulnerable === lane.isVulnerable &&
      verdict.confidence === lane.confidence;
    return {
      pass,
      detail: `lane ${vstr} ${pass ? "==" : "!="} expected:isVulnerable:${lane.isVulnerable}@${lane.confidence}`,
    };
  };
}

// ===========================================================================
// Shared preconditions.
// ===========================================================================

/**
 * Both the recorder and the replay gate MUST stay single-call. When
 * FIXOR_ESCALATE_MEDIUM=true, a MEDIUM verdict fires a SECOND callClaude with
 * callerId `escalation:<detectorId>` - whose colon is an illegal Windows path
 * segment for a fixture dir. Assert the flag is unset so record + replay stay
 * single-call and Windows-safe. (New in 2b.0; in CI the flag is never set, so
 * this passes trivially and does not change any 2a outcome.)
 */
export function assertEscalationUnset(): void {
  if (process.env.FIXOR_ESCALATE_MEDIUM === "true") {
    throw new Error(
      "FIXOR_ESCALATE_MEDIUM=true is unsupported for record/replay: the second " +
        "escalation callClaude uses a colon-path callerId that is an invalid " +
        "Windows fixture dir. Unset FIXOR_ESCALATE_MEDIUM and re-run.",
    );
  }
}

/**
 * admin-check resolves `llmValidation` as: env FIXOR_ADMIN_CHECK_LLM_OPT_IN wins
 * when defined (`=== "true"`), else the constructor option, else false. The
 * shipped registry constructs `new AdminCheckDetector()`, so the default is
 * false: literal-tier first-triggers take the Option G bypass and never reach
 * callClaude.
 *
 * With the flag set to "true" that bypass disappears and EVERY trigger goes to
 * the model. Any manifest that partitions this corpus into "deterministic" and
 * "model-reaching" is therefore only valid while the flag is unset - the
 * partition is silently wrong otherwise, not loudly wrong. Assert it.
 *
 * Only the exact string "true" enables the opt-in (mirroring the detector's own
 * comparison), so "false"/"1"/unset all resolve to the shipped default and pass.
 */
export function assertAdminCheckOptInUnset(): void {
  if (process.env.FIXOR_ADMIN_CHECK_LLM_OPT_IN === "true") {
    throw new Error(
      "FIXOR_ADMIN_CHECK_LLM_OPT_IN=true is unsupported for the admin-check " +
        "deterministic gate: it routes every trigger through callClaude, so the " +
        "Option G bypass fixtures would reach the model and the bucket partition " +
        "no longer holds. Unset FIXOR_ADMIN_CHECK_LLM_OPT_IN and re-run.",
    );
  }
}

// ===========================================================================
// Record engine (owner-local, spends). Generalized from record-env-exposure.
//
// PRECONDITIONS the thin entry file MUST establish BEFORE importing this and
// the detector chain: ANTHROPIC_API_KEY present, FIXOR_REPLAY unset,
// FIXOR_RECORD=1. This engine asserts the escalation guard and refuses on an
// empty / non-manifest selection, then records each selected fixture.
// ===========================================================================

const SLEEP_MS_BETWEEN = 800;

interface RecordRow {
  id: string;
  sha: string | null;
  isVulnerable: boolean | null;
  confidence: string | null;
  flagged: boolean;
  expected: boolean;
  match: boolean;
  costUsd: number | null;
  recorded: boolean;
  /** Declared expected lane for this id, or null when the spec declares none. */
  laneExpected: ExpectedLane | null;
  /**
   * Record-time lane assertion result. True when no lane is declared (not
   * applicable) OR the recorded verdict matches the declared lane. A false here
   * is a hard failure, exactly like a class (flagged) mismatch: it would freeze
   * a recording whose verdict violates the locked lane contract (e.g. a live
   * model returning LOW for webhook negatives 14/15).
   */
  laneOk: boolean;
  error?: string;
}

async function recordOne(
  spec: DetectorReplaySpec,
  id: string,
): Promise<RecordRow> {
  const ctx = spec.layout.buildContext(id);
  const expected = spec.expectedFlagged(id);

  resetLastCallCost();
  resetLastRecordedFixture();

  const detector = spec.makeDetector();
  const findings = await detector.detect(ctx);
  const diag = detector.lastDiagnostics[0];
  const flagged = findings.length > 0;
  const verdict = diag?.verdict ?? null;
  const cost = lastCallCost;
  const rec = lastRecordedFixture;

  // Additional record-time lane pin (ADDITIVE; the flagged check below is
  // unchanged). Only ids the spec declares a lane for are checked. Read from
  // the SAME source verdictLaneOutcome uses at replay time. Computed from the
  // verdict already in scope, so it needs no detector API change.
  const lane = spec.expectedLane?.(id) ?? null;
  const laneOk =
    lane === null
      ? true
      : verdict !== null &&
        verdict.isVulnerable === lane.isVulnerable &&
        verdict.confidence === lane.confidence;

  const row: RecordRow = {
    id,
    sha: rec?.key ?? null,
    isVulnerable: verdict ? verdict.isVulnerable : null,
    confidence: verdict ? verdict.confidence : null,
    flagged,
    expected,
    match: flagged === expected,
    costUsd: cost ? cost.costUsd : null,
    recorded: rec !== null,
    laneExpected: lane,
    laneOk,
  };

  if (!rec) {
    row.error = `no fixture written (pre-filter SKIP: ${diag?.preFilterReason ?? "unknown"})`;
    return row;
  }

  // Augment the just-written file's meta with provenance (post-write).
  const fixture = JSON.parse(readFileSync(rec.path, "utf8")) as ReplayFixture;
  fixture.meta.sourceFixture = id;
  fixture.meta.expectedFlagged = expected;
  const note = spec.note?.(id);
  if (note) fixture.meta.note = note;
  writeFileSync(rec.path, `${JSON.stringify(fixture, null, 2)}\n`);

  return row;
}

/**
 * Record the selected fixtures for `spec`. `argv` is the raw CLI tail; "all"
 * records the whole manifest, otherwise each token is resolved via the layout
 * and validated against the manifest. Exits the process non-zero on any class
 * mismatch or any selected fixture that produced no recording (pre-filter SKIP).
 */
export async function recordFixtures(
  spec: DetectorReplaySpec,
  argv: string[],
): Promise<void> {
  assertEscalationUnset();

  if (argv.length === 0) {
    out.write(
      "REFUSING: no fixture selection. Name fixtures to record, e.g.\n" +
        `  ... positive/01 positive/02\n` +
        `or "all" for the whole ${spec.manifest.length}-fixture manifest. (Nothing was recorded.)\n`,
    );
    process.exit(1);
  }

  let ids: string[];
  try {
    ids =
      argv.length === 1 && argv[0] === "all"
        ? [...spec.manifest]
        : argv.map((a) => spec.layout.resolveSelector(a));
  } catch (err) {
    out.write(`REFUSING: ${(err as Error).message}\n`);
    process.exit(1);
    return;
  }

  const manifestSet = new Set(spec.manifest);
  const unknown = ids.filter((id) => !manifestSet.has(id));
  if (unknown.length > 0) {
    out.write(
      `REFUSING: not recordable (pre-filter SKIP or unknown): ${unknown.join(", ")}\n`,
    );
    process.exit(1);
  }

  out.write(
    `Recording ${ids.length} ${spec.detectorId} fixture(s) with your key.\n`,
  );
  out.write(`Target: ${spec.replayDir}/\n\n`);

  const rows: RecordRow[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const row = await recordOne(spec, id);
    rows.push(row);
    const v =
      row.isVulnerable === null
        ? "verdict:none"
        : `isVulnerable:${row.isVulnerable}@${row.confidence}`;
    const usd = row.costUsd === null ? "n/a" : `$${row.costUsd.toFixed(5)}`;
    const rowOk = row.match && row.laneOk;
    const laneLine = row.laneExpected
      ? `        lane:${row.laneOk ? "OK" : "MISMATCH"} expected:isVulnerable:${row.laneExpected.isVulnerable}@${row.laneExpected.confidence}\n`
      : "";
    out.write(
      `  [${i + 1}/${ids.length}] ${rowOk ? "OK  " : "MISMATCH"} ${id}\n` +
        `        ${v}  flagged:${row.flagged} expected:${row.expected}  cost:${usd}\n` +
        laneLine +
        `        sha:${row.sha ?? "(none)"}${row.error ? `  ERROR: ${row.error}` : ""}\n`,
    );
    if (i < ids.length - 1) await sleep(SLEEP_MS_BETWEEN);
  }

  const measured = rows.filter((r) => r.costUsd !== null).map((r) => r.costUsd!);
  const total = measured.reduce((a, b) => a + b, 0);
  const avg = measured.length > 0 ? total / measured.length : 0;
  const mismatches = rows.filter((r) => !r.match);
  const notRecorded = rows.filter((r) => !r.recorded);
  const laneMismatches = rows.filter((r) => !r.laneOk);

  out.write("\n=== BATCH SUMMARY ===\n");
  out.write(`  recorded:          ${rows.filter((r) => r.recorded).length}/${rows.length}\n`);
  out.write(`  measured total:    $${total.toFixed(5)}\n`);
  out.write(`  measured per-call: $${avg.toFixed(5)} (avg over ${measured.length})\n`);
  out.write(
    `  projected manifest: ~$${(avg * spec.manifest.length).toFixed(4)} (extrapolated; cache-warm reads make later calls cheaper)\n`,
  );
  out.write(`  class mismatches:  ${mismatches.length}\n`);
  out.write(`  lane mismatches:   ${laneMismatches.length}\n`);

  if (notRecorded.length > 0) {
    out.write(`\n  NOT RECORDED (no fixture file written):\n`);
    for (const r of notRecorded) out.write(`    ${r.id}: ${r.error}\n`);
  }
  if (mismatches.length > 0) {
    out.write(`\n  CLASS MISMATCHES (recorded verdict-outcome != expected class):\n`);
    for (const r of mismatches) {
      out.write(
        `    ${r.id}: flagged:${r.flagged} expected:${r.expected}` +
          ` (isVulnerable:${r.isVulnerable}@${r.confidence})\n`,
      );
    }
    out.write(
      "\n  A mismatch means the frozen response would misrepresent the detector's\n" +
        "  behavior. Review before committing; do not freeze it as-is.\n",
    );
  }
  if (laneMismatches.length > 0) {
    out.write(
      `\n  LANE MISMATCHES (recorded verdict != declared MEDIUM/review-queue lane):\n`,
    );
    for (const r of laneMismatches) {
      const got =
        r.isVulnerable === null
          ? "verdict:none"
          : `isVulnerable:${r.isVulnerable}@${r.confidence}`;
      const want = r.laneExpected
        ? `isVulnerable:${r.laneExpected.isVulnerable}@${r.laneExpected.confidence}`
        : "(no lane)";
      out.write(`    ${r.id}: got ${got}  want ${want}\n`);
    }
    out.write(
      "\n  A lane mismatch means the live verdict does not match the locked lane\n" +
        "  contract (e.g. a negative anchor returned LOW instead of MEDIUM). Freezing\n" +
        "  it would silence the anchor. Do not record it as-is; re-check the tune.\n",
    );
  }

  if (mismatches.length > 0 || notRecorded.length > 0 || laneMismatches.length > 0) {
    out.write("\nRESULT: FAIL\n");
    process.exit(1);
  }
  out.write("\nRESULT: PASS (all recorded, all classes matched, all lanes matched)\n");
}

// ===========================================================================
// Replay engine (free, in CI). Generalized from test-replay-env-exposure.
//
// The thin entry file MUST set FIXOR_REPLAY=1 and delete FIXOR_RECORD BEFORE
// importing this and the detector chain.
// ===========================================================================

/** Index the committed recordings by their meta.sourceFixture. */
function loadRecordings(
  replayDir: string,
  fail: (label: string) => void,
): Map<string, ReplayFixture> {
  // A wholly ABSENT recordings dir (a spec whose fixtures have not been recorded
  // yet) is treated as zero recordings, NOT a crash: readdirSync would throw a
  // raw ENOENT and mask the real problem. Returning [] lets the manifest
  // completeness check downstream report each expected fixture id as a clean,
  // loud "missing recordings for: ..." failure. Only ENOENT is swallowed; any
  // other fs error (EACCES, ENOTDIR, ...) still throws. The populated-dir path
  // is unchanged: when the dir exists, readdirSync succeeds exactly as before.
  let entries: string[];
  try {
    entries = readdirSync(replayDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    entries = [];
  }
  const files = entries.filter((f) => f.endsWith(".json"));
  const bySource = new Map<string, ReplayFixture>();
  for (const f of files) {
    const fixture = JSON.parse(
      readFileSync(join(replayDir, f), "utf8"),
    ) as ReplayFixture;
    const src = fixture.meta.sourceFixture;
    if (!src) {
      fail(`recording ${f} has no meta.sourceFixture`);
      continue;
    }
    if (bySource.has(src)) {
      fail(`duplicate recording for sourceFixture ${src} (${f})`);
      continue;
    }
    bySource.set(src, fixture);
  }
  return bySource;
}

/**
 * Run the deterministic replay round-trip gate for `spec`. Offline, no key, no
 * network, no DB. Exits the process non-zero on any failure. Fails LOUD (never
 * skips green) on a missing/drifted recording, an incomplete manifest, prompt
 * drift, or an outcome-assertion mismatch.
 */
export async function runReplayGate(spec: DetectorReplaySpec): Promise<void> {
  let failures = 0;
  const fail = (label: string): void => {
    failures++;
    out.write(`  FAIL  ${label}\n`);
  };
  const pass = (label: string): void => {
    out.write(`  PASS  ${label}\n`);
  };

  out.write(
    `F-004 replay round-trip gate (${spec.detectorId}).\n` +
      "SCOPE: wiring / tool-input parsing / lane + confidence-ladder logic against\n" +
      "FROZEN recorded samples ONLY. NOT detection quality or model behavior; a\n" +
      "green run here is NOT 'detection verified'. Model judgment = stage 3 (live).\n" +
      "Mode: replay, offline, no key, no network, no DB.\n\n",
  );

  const finish = (): void => {
    out.write(
      `\n${failures === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failures})`}\n`,
    );
    out.write(
      "NOTE: wiring/parsing gate only. Detection quality is not verified here.\n",
    );
    if (failures > 0) process.exit(1);
  };

  // Precondition: escalation must stay off (single-call, Windows-safe).
  try {
    assertEscalationUnset();
  } catch (err) {
    fail((err as Error).message);
    finish();
    return;
  }

  // Precondition: replay mode must be active, else a keyless run would exercise
  // a live path and silently mark everything unflagged.
  if (resolveReplayMode() !== "replay") {
    fail("replay mode is not active (resolveReplayMode() !== 'replay')");
    finish();
    return;
  }
  pass("replay mode active (offline; no key required)");

  const recordings = loadRecordings(spec.replayDir, fail);

  // Completeness: the recordings must cover exactly the manifest.
  const manifestSet = new Set(spec.manifest);
  const recordedSet = new Set(recordings.keys());
  const missing = spec.manifest.filter((s) => !recordedSet.has(s));
  const extra = [...recordedSet].filter((s) => !manifestSet.has(s));
  if (missing.length > 0) fail(`missing recordings for: ${missing.join(", ")}`);
  if (extra.length > 0) fail(`unexpected recordings for: ${extra.join(", ")}`);
  if (missing.length === 0 && extra.length === 0) {
    pass(`recordings cover exactly the ${spec.manifest.length}-fixture manifest`);
  }

  const detector = spec.makeDetector();

  for (const id of spec.manifest) {
    const rec = recordings.get(id);
    if (!rec) continue; // already reported as missing above

    // Human-legible prompt-drift guard (redundant with the request key, which
    // already covers the prompt, but it names the drift explicitly).
    if (rec.meta.systemPromptFingerprint !== spec.systemPromptFingerprint) {
      fail(
        `${id}: systemPromptFingerprint ${rec.meta.systemPromptFingerprint} != ` +
          `detector ${spec.systemPromptFingerprint} (prompt drift; re-record)`,
      );
      continue;
    }
    if (rec.meta.detectorId !== spec.detectorId) {
      fail(`${id}: detectorId ${rec.meta.detectorId} != ${spec.detectorId}`);
      continue;
    }

    const ctx = spec.layout.buildContext(id);

    let findings: NormalizedFinding[];
    try {
      // Any throw here (notably ReplayFixtureMissing from a missing / drifted
      // recording) is a LOUD failure for this fixture; it never skips green.
      findings = await detector.detect(ctx);
    } catch (err) {
      fail(
        `${id}: detect() threw ${(err as Error).name}: ${(err as Error).message}`,
      );
      continue;
    }

    const outcome = spec.assertOutcome({ id, findings, detector, recording: rec });
    if (outcome.pass) {
      pass(`${id}  ${outcome.detail}`);
    } else {
      fail(`${id}  ${outcome.detail}`);
    }
  }

  finish();
}

// ===========================================================================
// Reusable layouts.
// ===========================================================================

/**
 * The env-exposure / auth-bypass layout: fixtures live under
 * `<dir>/{positive,negative}/`, one file per id, id = "<class>/<file>". A
 * `// ASSUMED-PATH:` header (stripped by loadFixture) sets the diff path.
 * `loadSidecars`, when supplied, injects sidecar bodies for an id (idor
 * negatives); omit it and buildContext returns a bare `{ diff }`.
 */
export function positiveNegativeLayout(opts: {
  dir: string;
  loadSidecars?: (
    id: string,
    assumedPath: string,
  ) => DetectorContext["sidecarsByPath"];
}): Layout {
  const { dir } = opts;
  const listClass = (cls: "positive" | "negative"): string[] =>
    readdirSync(join(dir, cls))
      .filter((f) => !f.endsWith(".md") && !f.startsWith("."))
      .sort();

  return {
    resolveSelector(sel: string): string {
      const slash = sel.indexOf("/");
      if (slash < 0) {
        throw new Error(`selector must be "positive|negative/<name>": ${sel}`);
      }
      const cls = sel.slice(0, slash);
      const token = sel.slice(slash + 1);
      if (cls !== "positive" && cls !== "negative") {
        throw new Error(`selector class must be positive|negative: ${sel}`);
      }
      const files = listClass(cls);
      const exact = files.find((f) => f === token);
      const prefixed = files.filter((f) => f.startsWith(token));
      const file = exact ?? (prefixed.length === 1 ? prefixed[0] : undefined);
      if (!file) {
        throw new Error(
          `selector "${sel}" matched ${prefixed.length} files; be specific.`,
        );
      }
      return `${cls}/${file}`;
    },

    buildContext(id: string): DetectorContext {
      const [cls, file] = id.split("/") as [string, string];
      const { assumedPath, content } = loadFixture(join(dir, cls, file));
      const diff = buildSyntheticDiff(assumedPath, content);
      const sidecars = opts.loadSidecars?.(id, assumedPath);
      return sidecars ? { diff, sidecarsByPath: sidecars } : { diff };
    },
  };
}
