/**
 * F-004 stage 2a-2 - record env-exposure replay fixtures (owner-local, spends).
 *
 * THE ONLY PATH THAT SPENDS API BUDGET in the replay work. Run locally by the
 * owner with their own key. Never in CI, never automatic.
 *
 * What it does, per named fixture:
 *   1. Builds the same synthetic diff test-env-exposure uses.
 *   2. Runs the REAL detector end to end with FIXOR_RECORD=1, so a successful
 *      LLM call is frozen to fixtures/replay/<callerId>/<sha>.json via
 *      saveReplayFixture. callerId is DETECTOR_ID = "env-exposure-multi".
 *   3. Reads the MEASURED per-call USD from lastCallCost (message.usage, no DB).
 *   4. Augments the just-written file's meta with provenance (sourceFixture,
 *      expectedFlagged, note) via lastRecordedFixture.
 *   5. Asserts the detector's END-TO-END flagged outcome (prefilter -> request
 *      -> parse -> confidence ladder -> emit) matches the fixture's expected
 *      class. The RAW LLM verdict is still frozen as recorded, so a fixture can
 *      legitimately show isVulnerable:true@medium yet flagged:false (the ladder
 *      suppressing it) - that is the point, not a contradiction.
 *
 * Safety:
 *   - Requires ANTHROPIC_API_KEY; refuses (loud) without it. Never silently
 *     records nothing.
 *   - Requires an explicit fixture selection; refuses with no args, so it can
 *     never spend on all 17 by accident.
 *   - Refuses if FIXOR_REPLAY is set (ambiguous with record mode).
 *   - Exits non-zero on ANY class mismatch or any selected fixture that
 *     produced no fixture file (pre-filter SKIP), so a wrong/absent recording
 *     is never frozen silently.
 *
 * Usage (from repo root, after build):
 *   ANTHROPIC_API_KEY=... node dist/test/record-env-exposure-fixtures.js \
 *     positive/01-debug-env-route.ts \
 *     positive/02-error-handler-leaks-env.ts \
 *     positive/04-admin-runtime-no-prod-check.ts
 * Shorthand selectors ("positive/04") and "all" (all 17 LLM-reaching) work too.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const out = process.stdout;

// --- Guards BEFORE importing the detector chain (which reads the mode) --------
if (process.env.FIXOR_REPLAY) {
  out.write(
    "REFUSING: FIXOR_REPLAY is set. This is the RECORD harness; unset FIXOR_REPLAY.\n",
  );
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY?.trim()) {
  out.write(
    "REFUSING: ANTHROPIC_API_KEY is not set. Recording spends real budget and\n" +
      "needs your key. Set it and re-run. (Nothing was recorded.)\n",
  );
  process.exit(1);
}
process.env.FIXOR_RECORD = "1";

// Imported after the guards so the record mode is active for the whole chain.
import { EnvExposureDetector } from "../analysis-engine/detectors/env-exposure.detector";
import { lastCallCost, resetLastCallCost } from "../analysis-engine/anthropic-client";
import {
  lastRecordedFixture,
  resetLastRecordedFixture,
  type ReplayFixture,
} from "../analysis-engine/llm-replay";

const FIXTURES_DIR = "fixtures/env-exposure";
const SLEEP_MS_BETWEEN = 800;

/**
 * Expected END-TO-END flagged outcome per fixture (folder is NOT the answer).
 * The two MEDIUM-ceiling positives are expected flagged:false: the LLM calls
 * them vulnerable at MEDIUM and the confidence ladder correctly suppresses
 * them. Documented so it never reads as a mislabel later.
 */
const MEDIUM_CEILING_NOTE =
  "Positive-folder MEDIUM-ceiling case: the LLM verdict is isVulnerable:true at " +
  "confidence:medium, and the detector's confidence ladder correctly suppresses " +
  "it (escalation off). Expected flagged=false; this is NOT a mismatch.";

const EXPECTED_FLAGGED: Record<string, boolean> = {
  "positive/01-debug-env-route.ts": true,
  "positive/02-error-handler-leaks-env.ts": true,
  "positive/03-fastify-logs-env.ts": false, // MEDIUM ceiling
  "positive/04-admin-runtime-no-prod-check.ts": true,
  "positive/05-healthz-config.js": true,
  "positive/06-diagnostics-send.js": true,
  "positive/07-error-includes-env.js": true,
  "positive/08-flask-diagnostics.py": true,
  "positive/09-fastapi-runtime.py": true,
  "positive/10-go-env-dump.go": true,
  "positive/11-redacted-diagnostics.js": false, // MEDIUM ceiling
  "negative/03-fastify-redacted-logs.ts": false,
  "negative/04-dev-env-keys-only.ts": false,
  "negative/05-healthz-specific-fields.js": false,
  "negative/06-logger-only-env.js": false,
  "negative/08-flask-env-keys-only.py": false,
  "negative/09-fastapi-runtime-specific.py": false,
};
const NOTE: Record<string, string> = {
  "positive/03-fastify-logs-env.ts": MEDIUM_CEILING_NOTE,
  "positive/11-redacted-diagnostics.js": MEDIUM_CEILING_NOTE,
};

// --- Helpers mirrored faithfully from src/test/test-env-exposure.ts ----------
function loadFixture(filepath: string): { assumedPath: string; content: string } {
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

function buildSyntheticDiff(filePath: string, content: string): string {
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

/** Resolve a selector ("positive/04" or "positive/04-...ts") to "cls/file". */
function resolveSelector(sel: string): string {
  const slash = sel.indexOf("/");
  if (slash < 0) throw new Error(`selector must be "positive|negative/<name>": ${sel}`);
  const cls = sel.slice(0, slash);
  const token = sel.slice(slash + 1);
  if (cls !== "positive" && cls !== "negative") {
    throw new Error(`selector class must be positive|negative: ${sel}`);
  }
  const files = readdirSync(join(FIXTURES_DIR, cls))
    .filter((f) => !f.endsWith(".md") && !f.startsWith("."))
    .sort();
  const exact = files.find((f) => f === token);
  const prefixed = files.filter((f) => f.startsWith(token));
  const file = exact ?? (prefixed.length === 1 ? prefixed[0] : undefined);
  if (!file) {
    throw new Error(
      `selector "${sel}" matched ${prefixed.length} files; be specific.`,
    );
  }
  return `${cls}/${file}`;
}

function allRecordable(): string[] {
  return Object.keys(EXPECTED_FLAGGED);
}

interface Row {
  id: string;
  sha: string | null;
  isVulnerable: boolean | null;
  confidence: string | null;
  flagged: boolean;
  expected: boolean;
  match: boolean;
  costUsd: number | null;
  recorded: boolean;
  error?: string;
}

async function recordOne(id: string): Promise<Row> {
  const [cls, file] = id.split("/") as [string, string];
  const filepath = join(FIXTURES_DIR, cls, file);
  const { assumedPath, content } = loadFixture(filepath);
  const diff = buildSyntheticDiff(assumedPath, content);
  const expected = EXPECTED_FLAGGED[id]!;

  resetLastCallCost();
  resetLastRecordedFixture();

  const detector = new EnvExposureDetector();
  const findings = await detector.detect({ diff });
  const diag = detector.lastDiagnostics[0];
  const flagged = findings.length > 0;
  const verdict = diag?.verdict ?? null;
  const cost = lastCallCost;
  const rec = lastRecordedFixture;

  const row: Row = {
    id,
    sha: rec?.key ?? null,
    isVulnerable: verdict ? verdict.isVulnerable : null,
    confidence: verdict ? verdict.confidence : null,
    flagged,
    expected,
    match: flagged === expected,
    costUsd: cost ? cost.costUsd : null,
    recorded: rec !== null,
  };

  if (!rec) {
    // No file written => the fixture pre-filter SKIPped (no LLM call). Loud.
    row.error = `no fixture written (pre-filter SKIP: ${diag?.preFilterReason ?? "unknown"})`;
    return row;
  }

  // Augment the just-written file's meta with provenance (post-write).
  const fixture = JSON.parse(readFileSync(rec.path, "utf8")) as ReplayFixture;
  fixture.meta.sourceFixture = id;
  fixture.meta.expectedFlagged = expected;
  if (NOTE[id]) fixture.meta.note = NOTE[id];
  writeFileSync(rec.path, `${JSON.stringify(fixture, null, 2)}\n`);

  return row;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    out.write(
      "REFUSING: no fixture selection. Name fixtures to record, e.g.\n" +
        "  node dist/test/record-env-exposure-fixtures.js positive/01 positive/02 positive/04\n" +
        'or "all" for all 17 LLM-reaching fixtures. (Nothing was recorded.)\n',
    );
    process.exit(1);
  }

  let ids: string[];
  try {
    ids =
      args.length === 1 && args[0] === "all"
        ? allRecordable()
        : args.map(resolveSelector);
  } catch (err) {
    out.write(`REFUSING: ${(err as Error).message}\n`);
    process.exit(1);
    return;
  }

  const unknown = ids.filter((id) => !(id in EXPECTED_FLAGGED));
  if (unknown.length > 0) {
    out.write(
      `REFUSING: not recordable (pre-filter SKIP or unknown): ${unknown.join(", ")}\n`,
    );
    process.exit(1);
  }

  out.write(`Recording ${ids.length} env-exposure fixture(s) with your key.\n`);
  out.write(`Target: ${FIXTURES_DIR.replace("env-exposure", "..")}/replay/env-exposure-multi/\n\n`);

  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const row = await recordOne(id);
    rows.push(row);
    const v =
      row.isVulnerable === null
        ? "verdict:none"
        : `isVulnerable:${row.isVulnerable}@${row.confidence}`;
    const usd = row.costUsd === null ? "n/a" : `$${row.costUsd.toFixed(5)}`;
    out.write(
      `  [${i + 1}/${ids.length}] ${row.match ? "OK  " : "MISMATCH"} ${id}\n` +
        `        ${v}  flagged:${row.flagged} expected:${row.expected}  cost:${usd}\n` +
        `        sha:${row.sha ?? "(none)"}${row.error ? `  ERROR: ${row.error}` : ""}\n`,
    );
    if (i < ids.length - 1) await sleep(SLEEP_MS_BETWEEN);
  }

  const measured = rows.filter((r) => r.costUsd !== null).map((r) => r.costUsd!);
  const total = measured.reduce((a, b) => a + b, 0);
  const avg = measured.length > 0 ? total / measured.length : 0;
  const mismatches = rows.filter((r) => !r.match);
  const notRecorded = rows.filter((r) => !r.recorded);

  out.write("\n=== BATCH SUMMARY ===\n");
  out.write(`  recorded:          ${rows.filter((r) => r.recorded).length}/${rows.length}\n`);
  out.write(`  measured total:    $${total.toFixed(5)}\n`);
  out.write(`  measured per-call: $${avg.toFixed(5)} (avg over ${measured.length})\n`);
  out.write(
    `  projected full 17: ~$${(avg * 17).toFixed(4)} (extrapolated; cache-warm reads make later calls cheaper)\n`,
  );
  out.write(`  class mismatches:  ${mismatches.length}\n`);

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

  if (mismatches.length > 0 || notRecorded.length > 0) {
    out.write("\nRESULT: FAIL\n");
    process.exit(1);
  }
  out.write("\nRESULT: PASS (all recorded, all classes matched)\n");
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
