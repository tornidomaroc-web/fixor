/**
 * Locked child of the idor structure rig. Drives the REAL
 * `IdorDetector.analyzeFile` and reports what it observed.
 *
 * This is the process that would spend money if the lock failed, so the lock is
 * asserted HERE, before the detector is touched. A parent-side assert proves
 * nothing about this process's env.
 *
 * Not an entry point you run by hand: the parent
 * (`measure-idor-structure.ts`) constructs the locked env and the empty replay
 * root. Run directly with an ambient key and it refuses.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { IdorDetector } from "../analysis-engine/detectors/idor.detector";
import { llmCoverageSince, snapshotLlmCoverage } from "../lib/llm-coverage";
import {
  assertZeroSpendLock,
  type ProbeFileResult,
  type ProbeInput,
  type ProbeReport,
} from "./lib/idor-structure-rig";

async function main(): Promise<void> {
  // Lock FIRST. Nothing below runs on an unlocked process.
  assertZeroSpendLock();

  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) {
    throw new Error("usage: measure-idor-structure-child <inputs.json> <report.json>");
  }
  const inputs = JSON.parse(readFileSync(inPath, "utf8")) as ProbeInput[];

  const snap = snapshotLlmCoverage();
  const results: ProbeFileResult[] = [];

  for (const input of inputs) {
    // Fresh detector per file: `lastDiagnostics` is instance state and a
    // shared instance would let one file's diagnostics leak into the next.
    const detector = new IdorDetector();
    let findingCount = 0;
    let errorName: string | null = null;
    let errorMessage: string | null = null;

    // Per-file try/catch. Under the lock, a file that reaches the model throws
    // ReplayFixtureMissing — that throw is a RESULT, not a crash, and must not
    // take the rest of the corpus down with it. E' depends on this: one
    // unparseable file in a real repo must not void the whole run.
    try {
      const findings = await detector.analyzeFile(
        input.path,
        input.content,
        input.lang,
      );
      findingCount = findings.length;
    } catch (e) {
      errorName = e instanceof Error ? e.name : "UnknownError";
      errorMessage = e instanceof Error ? e.message : String(e);
    }

    const diag = detector.lastDiagnostics[0];
    results.push({
      id: input.id,
      path: input.path,
      findingCount,
      errorName,
      errorMessage,
      // Reaching callLlm under the lock is observable exactly as this throw.
      reachedModel: errorName === "ReplayFixtureMissing",
      preFilterReason: diag?.preFilterReason ?? null,
      triggerCount: diag?.triggerCount ?? 0,
      pairs: [], // filled by the parent from the debug log
    });
  }

  const delta = llmCoverageSince(snap);
  const report: ProbeReport = {
    results,
    tally: {
      attempted: delta.attempted,
      failed: delta.failed,
      successful: delta.attempted - delta.failed,
      byReason: delta.byReason,
    },
    lock: {
      replay: process.env.FIXOR_REPLAY ?? null,
      replayRoot: process.env.FIXOR_REPLAY_ROOT ?? null,
      hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    },
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
