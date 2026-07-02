/**
 * Secrets-exposure detector accuracy harness.
 *
 * Mirrors the Phase 3 auth-bypass test structure.
 * Run via: npm run test:secrets-exposure (~ $0.02 per run — only positives
 * reach the LLM; all 10 negatives are dropped pre-LLM by design).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { SecretsExposureDetector } from "../analysis-engine/detectors/secrets-exposure.detector";

const FIXTURES_DIR = "fixtures/secrets-exposure";
const POSITIVES_MIN = 7;
const NEGATIVES_MIN = 9;
const COMBINED_MIN = 16;
const SLEEP_MS_BETWEEN = 800;

interface MetaEntry {
  description: string;
  category: string;
}

interface FixtureResult {
  file: string;
  isPositive: boolean;
  flagged: boolean;
  preFilterReason?: string;
  verdict?: {
    isVulnerable: boolean;
    confidence: string;
    reasoning: string;
  } | null;
  triggerCount: number;
  meta: MetaEntry;
}

function loadFixture(filepath: string): {
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

function parseMeta(
  metaContent: string,
  isPositive: boolean,
): Map<string, MetaEntry> {
  const out = new Map<string, MetaEntry>();
  const sectionMarker = isPositive ? "## Positive" : "## Negative";
  let inSection = false;
  for (const line of metaContent.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      inSection = line.startsWith(sectionMarker);
      continue;
    }
    if (!inSection) continue;
    const m = line.match(
      /^- (\S+):\s*(.+?)(?:\s*\((Category [AB])[^)]*\))?\s*$/,
    );
    if (m) {
      out.set(m[1]!, {
        description: m[2]!.trim(),
        category: m[3] ?? "-",
      });
    }
  }
  return out;
}

async function scanDir(
  dir: string,
  isPositive: boolean,
  metaMap: Map<string, MetaEntry>,
  detector: SecretsExposureDetector,
): Promise<FixtureResult[]> {
  const files = readdirSync(dir)
    .filter((f) => !f.endsWith(".md") && !f.startsWith("."))
    .sort();
  const out: FixtureResult[] = [];
  let i = 0;
  for (const file of files) {
    i++;
    const filepath = join(dir, file);
    const { assumedPath, content } = loadFixture(filepath);
    const diff = buildSyntheticDiff(assumedPath, content);

    let flagged = false;
    let preFilterReason: string | undefined;
    let verdict: FixtureResult["verdict"];
    let triggerCount = 0;
    try {
      const findings = await detector.detect({ diff });
      flagged = findings.length > 0;
      const diag = detector.lastDiagnostics[0];
      if (diag) {
        preFilterReason = diag.preFilterReason;
        verdict = diag.verdict ?? undefined;
        triggerCount = diag.triggerCount;
      }
    } catch (err) {
      preFilterReason = `error: ${(err as Error).message}`;
    }

    const meta = metaMap.get(file) ?? {
      description: "(no meta)",
      category: "-",
    };
    out.push({
      file,
      isPositive,
      flagged,
      preFilterReason,
      verdict,
      triggerCount,
      meta,
    });
    process.stdout.write(
      `  [${i}/${files.length}] ${flagged ? "FLAG" : "skip"}  ${file}` +
        (preFilterReason ? `  (${preFilterReason})` : "") +
        "\n",
    );
    if (i < files.length) await sleep(SLEEP_MS_BETWEEN);
  }
  return out;
}

function printDiagnostic(
  caught: number,
  flaggedNegativeCount: number,
  missedPositives: FixtureResult[],
  flaggedNegatives: FixtureResult[],
): void {
  const out = process.stdout;
  out.write(
    "================================================================\n",
  );
  out.write("TEST FAILED — diagnostic\n");
  out.write(
    "================================================================\n\n",
  );

  if (missedPositives.length > 0) {
    out.write(`POSITIVES MISSED (${10 - caught}/10 should be 0):\n`);
    for (const m of missedPositives) {
      out.write(`  ${m.file} (Category: ${m.meta.category})\n`);
      out.write(`    META: ${m.meta.description}\n`);
      if (m.preFilterReason) {
        out.write(`    Verdict: filtered out by ${m.preFilterReason}\n`);
      } else if (m.verdict) {
        out.write(`    Verdict: ${JSON.stringify(m.verdict)}\n`);
      } else {
        out.write(
          `    Verdict: detector returned no finding (triggers=${m.triggerCount}, no LLM verdict captured)\n`,
        );
      }
      out.write("\n");
    }
  }

  if (flaggedNegatives.length > 0) {
    out.write(
      `NEGATIVES INCORRECTLY FLAGGED (${flaggedNegativeCount}/10 should be ≤1):\n`,
    );
    for (const n of flaggedNegatives) {
      out.write(`  ${n.file} (${n.meta.category})\n`);
      out.write(`    META: ${n.meta.description}\n`);
      out.write(
        `    Verdict: ${n.verdict ? JSON.stringify(n.verdict) : "(verdict missing)"}\n\n`,
      );
    }
  }

  out.write(
    "================================================================\n",
  );
  out.write(
    "ACTION: Review failures. If a fixture is genuinely ambiguous (humans\n",
  );
  out.write(
    "would also disagree), consider revising or removing it. Otherwise,\n",
  );
  out.write("prompt engineering needs improvement.\n");
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stdout.write(
      "SKIPPED: ANTHROPIC_API_KEY not set (opt-in live-LLM test). Set the key to run it live.\n",
    );
    return;
  }

  const detector = new SecretsExposureDetector();
  const metaContent = readFileSync(join(FIXTURES_DIR, "META.md"), "utf8");
  const positiveMeta = parseMeta(metaContent, true);
  const negativeMeta = parseMeta(metaContent, false);

  process.stdout.write("Positives (should be flagged):\n");
  const positives = await scanDir(
    join(FIXTURES_DIR, "positive"),
    true,
    positiveMeta,
    detector,
  );

  process.stdout.write("\nNegatives (should NOT be flagged):\n");
  const negatives = await scanDir(
    join(FIXTURES_DIR, "negative"),
    false,
    negativeMeta,
    detector,
  );

  const caught = positives.filter((r) => r.flagged).length;
  const correctlySkipped = negatives.filter((r) => !r.flagged).length;
  const flaggedNegatives = negatives.filter((r) => r.flagged);
  const missedPositives = positives.filter((r) => !r.flagged);
  const combined = caught + correctlySkipped;
  const accuracyPct = Math.round((combined / 20) * 100);

  process.stdout.write("\n");
  process.stdout.write(`Positives caught:           ${caught}/10 (need >= ${POSITIVES_MIN})\n`);
  process.stdout.write(`Negatives correctly skipped: ${correctlySkipped}/10 (need >= ${NEGATIVES_MIN})\n`);
  process.stdout.write(`Combined accuracy:          ${combined}/20 (${accuracyPct}%, need >= ${COMBINED_MIN})\n\n`);

  const passedNegativesGate = correctlySkipped >= NEGATIVES_MIN;
  const passedPositivesGate = caught >= POSITIVES_MIN;
  const passedCombined = combined >= COMBINED_MIN;
  const passed = passedNegativesGate && passedPositivesGate && passedCombined;

  if (!passedNegativesGate) {
    process.stdout.write(
      `HARD GATE FAILED: negatives ${correctlySkipped}/10 < ${NEGATIVES_MIN}; false positives matter most.\n\n`,
    );
  }

  if (!passed) {
    printDiagnostic(
      caught,
      flaggedNegatives.length,
      missedPositives,
      flaggedNegatives,
    );
    process.exit(1);
  }

  process.stdout.write("PASS.\n");
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
