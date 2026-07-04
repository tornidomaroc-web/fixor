/**
 * F-004 stage 2a-2 - dedicated deterministic replay round-trip gate (free, in CI).
 *
 * SCOPE AND LIMITS (F-008 guardrail; read before trusting a green run):
 *   This gate verifies detector WIRING, tool-input PARSING, and LANE /
 *   confidence-ladder logic against FROZEN recorded model samples only. It does
 *   NOT verify detection quality or model behavior. A replayed response is ONE
 *   frozen sample, not repeated sampling. A green replay gate is NOT "detection
 *   verified". Model-judgment coverage remains stage 3 (opt-in live), never here.
 *
 * SELF-CONTAINED FOR CI:
 *   - Forces FIXOR_REPLAY=1 in-process, so no env prefix is needed to run it.
 *   - No network, no DB, and NO API key. Replay short-circuits inside callClaude
 *     BEFORE any Anthropic client is constructed, so running with
 *     ANTHROPIC_API_KEY unset is the real CI condition and MUST still pass.
 *   - Reads only the committed recordings under fixtures/replay/env-exposure-multi/
 *     and the source fixtures under fixtures/env-exposure/.
 *
 * WHAT IT ASSERTS, per recorded fixture:
 *   For each of the 17 LLM-reaching fixtures, it rebuilds the same synthetic diff
 *   the record harness used, runs the REAL detector end to end in replay mode,
 *   and asserts the detector's flagged outcome === the fixture's meta.expectedFlagged.
 *   The two MEDIUM-ceiling positives (positive/03, positive/11) legitimately
 *   record isVulnerable:true@medium yet expectedFlagged:false: the confidence
 *   ladder suppresses them. That is the point, not a contradiction.
 *
 * FAIL LOUD, NEVER SKIP GREEN:
 *   - A missing / key-drifted recording makes loadReplayFixture throw
 *     ReplayFixtureMissing, which propagates out of detect(); this test catches
 *     it, marks that fixture FAIL, and exits non-zero. It never passes silently.
 *   - A completeness manifest of all 17 source fixtures is enforced: a deleted or
 *     renamed recording is a loud FAIL, not reduced (silently green) coverage.
 */

// Force replay mode BEFORE importing the detector chain so the whole chain runs
// against recordings. resolveReplayMode reads process.env per call, but setting
// it up top is unambiguous and defensive. FIXOR_RECORD is cleared so an
// inherited record flag can never turn this read-only gate into a spender.
process.env.FIXOR_REPLAY = "1";
delete process.env.FIXOR_RECORD;

import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

import {
  EnvExposureDetector,
  SYSTEM_PROMPT_FINGERPRINT,
} from "../analysis-engine/detectors/env-exposure.detector";
import {
  resolveReplayMode,
  type ReplayFixture,
} from "../analysis-engine/llm-replay";

const SOURCE_DIR = "fixtures/env-exposure";
const REPLAY_DIR = "fixtures/replay/env-exposure-multi";
const DETECTOR_ID = "env-exposure-multi";

/**
 * Completeness manifest: the 17 LLM-reaching source fixtures that MUST each have
 * a recording. This is the external ground truth for coverage; a recording that
 * is deleted or renamed away from this set is a loud FAIL, never silent shrink.
 * The expectedFlagged VALUE is read from each recording's meta (single source of
 * truth), not from this list - this list only guarantees all 17 are present.
 */
const SOURCE_MANIFEST: readonly string[] = [
  "positive/01-debug-env-route.ts",
  "positive/02-error-handler-leaks-env.ts",
  "positive/03-fastify-logs-env.ts",
  "positive/04-admin-runtime-no-prod-check.ts",
  "positive/05-healthz-config.js",
  "positive/06-diagnostics-send.js",
  "positive/07-error-includes-env.js",
  "positive/08-flask-diagnostics.py",
  "positive/09-fastapi-runtime.py",
  "positive/10-go-env-dump.go",
  "positive/11-redacted-diagnostics.js",
  "negative/03-fastify-redacted-logs.ts",
  "negative/04-dev-env-keys-only.ts",
  "negative/05-healthz-specific-fields.js",
  "negative/06-logger-only-env.js",
  "negative/08-flask-env-keys-only.py",
  "negative/09-fastapi-runtime-specific.py",
];

const out = process.stdout;
let failures = 0;
function fail(label: string): void {
  failures++;
  out.write(`  FAIL  ${label}\n`);
}
function pass(label: string): void {
  out.write(`  PASS  ${label}\n`);
}

// --- Diff builders, mirrored faithfully from the record harness --------------
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

/** Index the committed recordings by their meta.sourceFixture. */
function loadRecordings(): Map<string, ReplayFixture> {
  const files = readdirSync(REPLAY_DIR).filter((f) => f.endsWith(".json"));
  const bySource = new Map<string, ReplayFixture>();
  for (const f of files) {
    const fixture = JSON.parse(
      readFileSync(join(REPLAY_DIR, f), "utf8"),
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

async function main(): Promise<void> {
  out.write(
    "F-004 replay round-trip gate (env-exposure-multi).\n" +
      "SCOPE: wiring / tool-input parsing / lane + confidence-ladder logic against\n" +
      "FROZEN recorded samples ONLY. NOT detection quality or model behavior; a\n" +
      "green run here is NOT 'detection verified'. Model judgment = stage 3 (live).\n" +
      "Mode: replay, offline, no key, no network, no DB.\n\n",
  );

  // Precondition: replay mode must be active, else this would exercise a live
  // path and a keyless run would silently mark everything unflagged.
  if (resolveReplayMode() !== "replay") {
    fail("replay mode is not active (resolveReplayMode() !== 'replay')");
    finish();
    return;
  }
  pass("replay mode active (offline; no key required)");

  const recordings = loadRecordings();

  // Completeness: the recordings must cover exactly the 17-fixture manifest.
  const manifestSet = new Set(SOURCE_MANIFEST);
  const recordedSet = new Set(recordings.keys());
  const missing = SOURCE_MANIFEST.filter((s) => !recordedSet.has(s));
  const extra = [...recordedSet].filter((s) => !manifestSet.has(s));
  if (missing.length > 0) fail(`missing recordings for: ${missing.join(", ")}`);
  if (extra.length > 0) fail(`unexpected recordings for: ${extra.join(", ")}`);
  if (missing.length === 0 && extra.length === 0) {
    pass(`recordings cover exactly the ${SOURCE_MANIFEST.length}-fixture manifest`);
  }

  const detector = new EnvExposureDetector();

  for (const id of SOURCE_MANIFEST) {
    const rec = recordings.get(id);
    if (!rec) continue; // already reported as missing above

    // Human-legible prompt-drift guard (redundant with the request key, which
    // already covers the prompt, but it names the drift explicitly).
    if (rec.meta.systemPromptFingerprint !== SYSTEM_PROMPT_FINGERPRINT) {
      fail(
        `${id}: systemPromptFingerprint ${rec.meta.systemPromptFingerprint} != ` +
          `detector ${SYSTEM_PROMPT_FINGERPRINT} (prompt drift; re-record)`,
      );
      continue;
    }
    if (rec.meta.detectorId !== DETECTOR_ID) {
      fail(`${id}: detectorId ${rec.meta.detectorId} != ${DETECTOR_ID}`);
      continue;
    }
    if (typeof rec.meta.expectedFlagged !== "boolean") {
      fail(`${id}: meta.expectedFlagged missing`);
      continue;
    }
    const expected = rec.meta.expectedFlagged;

    const [cls, file] = id.split("/") as [string, string];
    const { assumedPath, content } = loadFixture(join(SOURCE_DIR, cls, file));
    const diff = buildSyntheticDiff(assumedPath, content);

    let flagged: boolean;
    try {
      // Any throw here (notably ReplayFixtureMissing from a missing / drifted
      // recording) is a LOUD failure for this fixture; it never skips green.
      const findings = await detector.detect({ diff });
      flagged = findings.length > 0;
    } catch (err) {
      fail(
        `${id}: detect() threw ${(err as Error).name}: ${(err as Error).message}`,
      );
      continue;
    }

    const verdict = detector.lastDiagnostics[0]?.verdict ?? null;
    const vstr = verdict
      ? `isVulnerable:${verdict.isVulnerable}@${verdict.confidence}`
      : "verdict:none";
    if (flagged === expected) {
      pass(`${id}  flagged:${flagged} == expected:${expected}  (${vstr})`);
    } else {
      fail(`${id}  flagged:${flagged} != expected:${expected}  (${vstr})`);
    }
  }

  finish();
}

function finish(): void {
  out.write(
    `\n${failures === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failures})`}\n`,
  );
  out.write(
    "NOTE: wiring/parsing gate only. Detection quality is not verified here.\n",
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
