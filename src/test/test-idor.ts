/**
 * IDOR detector accuracy harness.
 *
 * Mirrors the Phase 5 test structure (test-admin-check.ts).
 * Run via: npm run test:idor
 *
 * Cost expectation: roughly $0.06 to $0.10 per fixture that reaches
 * the LLM. With 7 positives + 7 negatives and most fixtures expected
 * to reach the LLM (the pre-filter rarely short-circuits for IDOR
 * because source/sink co-occurrence is common in handler files),
 * expect ~$0.84 to $1.40 per full run.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { IdorDetector } from "../analysis-engine/detectors/idor.detector";

const FIXTURES_DIR = "fixtures/idor";
const POSITIVES_MIN = 6;
const NEGATIVES_MIN = 6;
const COMBINED_MIN = 12;
const SLEEP_MS_BETWEEN = 800;
const COST_PER_LLM_CALL_USD = 0.004;

interface MetaEntry {
  description: string;
  context: string;
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
    const m = line.match(/^- (\S+)\s*(?:\(([^)]+)\))?\s*:\s*(.+?)\s*$/);
    if (m) {
      out.set(m[1]!, {
        description: m[3]!.trim(),
        context: m[2] ?? "-",
      });
    }
  }
  return out;
}

async function scanDir(
  dir: string,
  isPositive: boolean,
  metaMap: Map<string, MetaEntry>,
  detector: IdorDetector,
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
      context: "-",
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
    let reason = "";
    if (preFilterReason) {
      reason = `(${preFilterReason})`;
    } else if (verdict) {
      const v = verdict.isVulnerable ? "vuln" : "safe";
      reason = `(LLM: ${v}/${verdict.confidence})`;
    } else if (!flagged) {
      reason = "(no verdict)";
    }
    process.stdout.write(
      `  [${i}/${files.length}] ${flagged ? "FLAG" : "skip"}  ${file}  ${reason}\n`,
    );
    if (i < files.length) await sleep(SLEEP_MS_BETWEEN);
  }
  return out;
}

function printDiagnostic(
  positives: FixtureResult[],
  negatives: FixtureResult[],
): void {
  const out = process.stdout;
  const caught = positives.filter((r) => r.flagged).length;
  const missedPositives = positives.filter((r) => !r.flagged);
  const flaggedNegatives = negatives.filter((r) => r.flagged);
  const totalPos = positives.length;
  const totalNeg = negatives.length;

  out.write(
    "================================================================\n",
  );
  out.write("TEST FAILED - diagnostic\n");
  out.write(
    "================================================================\n\n",
  );

  if (missedPositives.length > 0) {
    out.write(
      `POSITIVES MISSED (${totalPos - caught}/${totalPos} should be <= ${totalPos - POSITIVES_MIN}):\n`,
    );
    for (const m of missedPositives) {
      out.write(`  ${m.file} (${m.meta.context})\n`);
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
      `NEGATIVES INCORRECTLY FLAGGED (${flaggedNegatives.length}/${totalNeg} should be <= ${totalNeg - NEGATIVES_MIN}):\n`,
    );
    for (const n of flaggedNegatives) {
      out.write(`  ${n.file} (${n.meta.context})\n`);
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
    process.stderr.write(
      "ANTHROPIC_API_KEY is not set. Export it before running this test.\n",
    );
    process.exit(1);
  }

  const detector = new IdorDetector();
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

  const totalPos = positives.length;
  const totalNeg = negatives.length;
  const total = totalPos + totalNeg;
  const caught = positives.filter((r) => r.flagged).length;
  const correctlySkipped = negatives.filter((r) => !r.flagged).length;
  const combined = caught + correctlySkipped;
  const accuracyPct = total > 0 ? Math.round((combined / total) * 100) : 0;
  const llmCalls = [...positives, ...negatives].filter(
    (r) => !r.preFilterReason,
  ).length;
  const estimatedCost = llmCalls * COST_PER_LLM_CALL_USD;

  process.stdout.write("\n");
  process.stdout.write(
    `Positives caught:            ${caught}/${totalPos} (need >= ${POSITIVES_MIN})\n`,
  );
  process.stdout.write(
    `Negatives correctly skipped: ${correctlySkipped}/${totalNeg} (need >= ${NEGATIVES_MIN})\n`,
  );
  process.stdout.write(
    `Combined accuracy:           ${combined}/${total} (${accuracyPct}%, need >= ${COMBINED_MIN})\n`,
  );
  process.stdout.write(
    `LLM calls made:              ${llmCalls}/${total}\n`,
  );
  process.stdout.write(
    `Estimated run cost:          ~$${estimatedCost.toFixed(2)}\n\n`,
  );

  const passedNegativesGate = correctlySkipped >= NEGATIVES_MIN;
  const passedPositivesGate = caught >= POSITIVES_MIN;
  const passedCombined = combined >= COMBINED_MIN;
  const passed = passedNegativesGate && passedPositivesGate && passedCombined;

  if (!passedNegativesGate) {
    process.stdout.write(
      `HARD GATE FAILED: negatives ${correctlySkipped}/${totalNeg} < ${NEGATIVES_MIN}; false positives matter most.\n\n`,
    );
  }

  if (!passed) {
    printDiagnostic(positives, negatives);
    process.exit(1);
  }

  process.stdout.write("PASS.\n");
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
