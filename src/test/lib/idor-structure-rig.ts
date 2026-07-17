/**
 * Measurement rig for idor STRUCTURAL EXPOSURE (L-006 / L-009).
 *
 * WHAT THIS IS. A zero-spend harness that drives the REAL
 * `IdorDetector.analyzeFile` in a locked subprocess and harvests the REAL
 * candidate block the detector would have sent to the model. It witnesses
 * detector MECHANISM under execution. It does NOT measure detection quality,
 * and it emits no rate.
 *
 * WHY A SUBPROCESS. Two reasons, both load-bearing:
 *   1. Env isolation. The zero-spend lock is an env property. Setting it in the
 *      parent leaves it set for whatever else the parent does; a child gets an
 *      env constructed from scratch with ANTHROPIC_API_KEY deleted, so no
 *      ambient key from a shell or `--env-file` can leak into a model call.
 *   2. The lock must be asserted in the process that would actually spend.
 *      A parent-side assert proves nothing about the child's env.
 *
 * THE ZERO-SPEND TRIPLE LOCK. Each layer alone is sufficient; all three are
 * set so no single mistake spends money:
 *   1. FIXOR_REPLAY=1     -> `callClaude` returns from `loadReplayFixture`
 *                            BEFORE any client is constructed
 *                            (anthropic-client.ts:180-192). Zero network.
 *   2. FIXOR_REPLAY_ROOT  -> an EMPTY temp dir, so every key misses and
 *                            `loadReplayFixture` throws ReplayFixtureMissing
 *                            (llm-replay.ts:224). Fail loud, never a silent
 *                            fall-through to a live call.
 *   3. no ANTHROPIC_API_KEY -> even if 1 and 2 both failed open,
 *                            `getAnthropicClient()` returns null and the call
 *                            fails `no_api_key` instead of spending.
 *
 * THE HARD ASSERT, AND WHY IT IS STRONGER THAN A CALL COUNT. `callClaude`
 * tallies every terminal outcome into `llm-coverage`, where
 * `attempted - failed` is the count of SUCCESSFUL calls. The rig asserts:
 *
 *   - successful === 0. A successful call in replay mode means a fixture was
 *     FOUND; in live mode it means real spend. Either falsifies the run.
 *   - no_api_key === 0. This is the LOCK-ENGAGED assert and it is not
 *     redundant. If locks 1 and 2 failed open, lock 3 would catch the call and
 *     tally it `no_api_key` — spend-free, but it would mean replay never
 *     engaged and every ReplayFixtureMissing we think we witnessed was
 *     actually a keyless no-op. A run that leans on lock 3 is not the run we
 *     claim to have made, so we fail it rather than report it as clean.
 *
 * REUSE. E' drives the ICP corpus through `spawnLockedProbe` unchanged; only
 * the inputs differ. Nothing here is specific to the constructed inputs.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Languages `IdorDetector` supports (idor.detector.ts:45-55). */
export type ProbeLang =
  | "js" | "jsx" | "ts" | "tsx" | "py" | "go" | "rb" | "java" | "kt";

/** One file to drive through the real `analyzeFile`. */
export interface ProbeInput {
  /** Stable id for reporting. */
  id: string;
  /** Path handed to `analyzeFile` (affects only reporting, not prefilters). */
  path: string;
  lang: ProbeLang;
  content: string;
}

/** One candidate (source, sink) pair as the DETECTOR built it. */
export interface HarvestedPair {
  pairIndex: number;
  sourceLine: number;
  sourceText: string;
  sinkLine: number;
  sinkText: string;
}

/** Outcome of driving one input through the real `analyzeFile`. */
export interface ProbeFileResult {
  id: string;
  path: string;
  /** Findings returned. `[]` with reachedModel=false is a pre-model drop. */
  findingCount: number;
  /** Error class thrown out of `analyzeFile`, if any. */
  errorName: string | null;
  errorMessage: string | null;
  /**
   * True iff `analyzeFile` got as far as `callLlm`. Under the lock that is
   * observable exactly as a ReplayFixtureMissing throw.
   */
  reachedModel: boolean;
  /** `preFilterReason` from the detector's own diagnostics (null if none). */
  preFilterReason: string | null;
  triggerCount: number;
  /** Candidate pairs harvested from the FIXOR_DEBUG_IDOR_LLM=1 debug log. */
  pairs: HarvestedPair[];
}

/** The llm-coverage tally delta for the whole child run. */
export interface ProbeTally {
  attempted: number;
  failed: number;
  successful: number;
  byReason: Record<string, number>;
}

export interface ProbeReport {
  results: ProbeFileResult[];
  tally: ProbeTally;
  lock: { replay: string | null; replayRoot: string | null; hasApiKey: boolean };
}

/**
 * Parse the candidate block out of a `buildMultiPairUserMessage` user message
 * (idor.detector.ts:661-666). This is the REAL block the model would receive,
 * not a reconstruction: it is lifted verbatim from the debug log.
 */
export function parseCandidateBlock(userMessage: string): HarvestedPair[] {
  const re =
    /^- \[(\d+)\] SOURCE \(request-derived id\) line (\d+): (.*?)\s+->\s+SINK \(DB lookup\) line (\d+): (.*)$/gm;
  const pairs: HarvestedPair[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(userMessage)) !== null) {
    pairs.push({
      pairIndex: Number(m[1]),
      sourceLine: Number(m[2]),
      sourceText: m[3],
      sinkLine: Number(m[4]),
      sinkText: m[5],
    });
  }
  return pairs;
}

/**
 * Harvest `{ file -> pairs }` from the child's stdout. The child runs with
 * NODE_ENV=production so pino emits raw JSON lines (logger.ts:51-66); in dev
 * it would be pino-pretty and unparseable, which is why the parent pins
 * NODE_ENV rather than inheriting it.
 */
export function harvestDebugLog(stdout: string): Map<string, HarvestedPair[]> {
  const byFile = new Map<string, HarvestedPair[]>();
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let rec: { category?: string; file?: string; userMessage?: string };
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue; // not a pino line
    }
    if (rec.category !== "idor-debug-llm-input") continue;
    if (typeof rec.file !== "string" || typeof rec.userMessage !== "string") continue;
    byFile.set(rec.file, parseCandidateBlock(rec.userMessage));
  }
  return byFile;
}

/**
 * Build the locked child env from scratch. NOT `{...process.env}` with an
 * override: the key is DELETED, and starting from a copy makes it too easy for
 * a later edit to reintroduce it. Only what the child needs is passed through.
 */
export function buildLockedEnv(replayRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    // pino emits raw JSON (not pino-pretty) only when NODE_ENV=production.
    NODE_ENV: "production",
    // Lock 1: replay returns before any client is constructed.
    FIXOR_REPLAY: "1",
    // Lock 2: empty root -> every key misses -> ReplayFixtureMissing.
    FIXOR_REPLAY_ROOT: replayRoot,
    // Harvest the real candidate block (idor.detector.ts:1002-1016).
    FIXOR_DEBUG_IDOR_LLM: "1",
    LOG_LEVEL: "info",
  };
  if (process.platform === "win32") {
    // Node needs these on Windows to resolve the system dirs.
    env.SystemRoot = process.env.SystemRoot;
    env.TEMP = process.env.TEMP;
  }
  // Lock 3 is the ABSENCE of ANTHROPIC_API_KEY. Never add it here.
  return env;
}

/** Child-side lock verification. Throws in the process that would spend. */
export function assertZeroSpendLock(): void {
  const problems: string[] = [];
  if (process.env.FIXOR_REPLAY !== "1") {
    problems.push(`FIXOR_REPLAY is ${JSON.stringify(process.env.FIXOR_REPLAY)}, expected "1"`);
  }
  if (process.env.FIXOR_RECORD) {
    problems.push("FIXOR_RECORD is set; record mode SPENDS. Refusing.");
  }
  const root = process.env.FIXOR_REPLAY_ROOT;
  if (!root) {
    problems.push("FIXOR_REPLAY_ROOT is unset; would fall back to the REAL fixtures/replay tree");
  } else {
    let entries: string[] = [];
    try {
      entries = readdirSync(root);
    } catch {
      problems.push(`FIXOR_REPLAY_ROOT ${root} is not readable`);
    }
    if (entries.length > 0) {
      problems.push(`FIXOR_REPLAY_ROOT ${root} is NOT empty (${entries.length} entries); a fixture could match and mask a real call`);
    }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    problems.push("ANTHROPIC_API_KEY is present; lock 3 is broken");
  }
  if (problems.length > 0) {
    throw new Error(`ZERO-SPEND LOCK FAILED:\n  - ${problems.join("\n  - ")}`);
  }
}

/**
 * Drive `inputs` through the real `analyzeFile` in a locked child, harvest the
 * real candidate block, and HARD-assert zero spend. Throws if the lock did not
 * hold — never returns a report from an unlocked run.
 */
export async function spawnLockedProbe(
  inputs: ProbeInput[],
  childScript: string,
): Promise<ProbeReport> {
  const tmp = mkdtempSync(join(tmpdir(), "fixor-idor-rig-"));
  const replayRoot = mkdtempSync(join(tmp, "replay-empty-"));
  const inPath = join(tmp, "inputs.json");
  const outPath = join(tmp, "report.json");
  writeFileSync(inPath, JSON.stringify(inputs), "utf8");

  try {
    const { stdout, code } = await new Promise<{ stdout: string; code: number | null }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [childScript, inPath, outPath],
          { env: buildLockedEnv(replayRoot), stdio: ["ignore", "pipe", "pipe"] },
        );
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d.toString()));
        child.stderr.on("data", (d) => (err += d.toString()));
        child.on("error", reject);
        child.on("close", (c) => {
          if (c !== 0) {
            reject(new Error(`probe child exited ${c}\n--- stderr ---\n${err}`));
            return;
          }
          resolve({ stdout: out, code: c });
        });
      },
    );
    void code;

    const report = JSON.parse(readFileSync(outPath, "utf8")) as ProbeReport;

    // Attach the harvested candidate block to each result.
    const harvested = harvestDebugLog(stdout);
    for (const r of report.results) {
      r.pairs = harvested.get(r.path) ?? [];
    }

    assertProbeSpentNothing(report);
    return report;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * HARD assert: the run spent nothing AND the lock engaged the way we claim.
 * Throws rather than returning a flag — a rig that reports a spend as data is
 * a rig that spends.
 */
export function assertProbeSpentNothing(report: ProbeReport): void {
  const problems: string[] = [];
  if (report.tally.successful !== 0) {
    problems.push(`successful callClaude count is ${report.tally.successful}, expected 0`);
  }
  const noKey = report.tally.byReason.no_api_key ?? 0;
  if (noKey > 0) {
    problems.push(
      `${noKey} call(s) tallied no_api_key: locks 1-2 failed OPEN and only the absent key stopped a live call. ` +
        `Spend-free, but replay never engaged, so this run does not witness what it claims.`,
    );
  }
  if (report.lock.hasApiKey) {
    problems.push("child reported ANTHROPIC_API_KEY present");
  }
  if (report.lock.replay !== "1") {
    problems.push(`child reported FIXOR_REPLAY=${JSON.stringify(report.lock.replay)}`);
  }
  if (problems.length > 0) {
    throw new Error(`ZERO-SPEND ASSERT FAILED:\n  - ${problems.join("\n  - ")}`);
  }
}
