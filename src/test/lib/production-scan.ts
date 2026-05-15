/**
 * Production-shape scanner for Step 4 validation.
 *
 * Walks a directory of source files, treats each as a freshly-added
 * file in a synthetic PR diff (matching Fixor's webhook per-file
 * behavior), runs only the Day 7+8-shipped detectors (secrets-exposure
 * regex-only default + admin-check per-pattern tier default), and
 * emits findings to JSON for manual classification.
 *
 * Run via:
 *   npx tsx src/test/lib/production-scan.ts <repo-dir> <output.json>
 *
 * Cost model (assumes default detector behavior):
 *   - secrets-exposure regex-only: $0 per file (no LLM calls)
 *   - admin-check per-pattern tier: judgment-tier matches only
 *     (~$0.001-0.005 per file containing role_string_compare match)
 *
 * Output JSON shape: see ScanResult below. Snippets are redacted —
 * any portion of the source line that matches the detector's
 * triggering regex is replaced with `[REDACTED:patternId]` before
 * being written. The on-disk JSON never contains the literal secret
 * the finding is about (the bug class this validation exists to test
 * mitigation for).
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, basename, extname } from "node:path";

import { SecretsExposureDetector } from "../../analysis-engine/detectors/secrets-exposure.detector";
import { AdminCheckDetector } from "../../analysis-engine/detectors/admin-check.detector";
import type { NormalizedFinding } from "../../analysis-engine/detector.types";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rb",
  ".java",
  ".kt",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".git",
  "__pycache__",
  ".pytest_cache",
  "target",
  "vendor",
  ".venv",
  "venv",
  ".turbo",
  ".cache",
  "out",
]);

const MAX_FILE_BYTES = 200_000;
const SNIPPET_MAX_CHARS = 80;
const COST_PER_LLM_CALL_USD = 0.004;
const SLEEP_MS_BETWEEN_LLM_CALLS = 200;

interface ScanFinding {
  repo: string;
  file: string;
  detector: string;
  patternId: string;
  line: number;
  snippet: string;
  explanation: string;
  confidence: string;
  bypassed: boolean;
  pathCategory: PathCategory;
}

type PathCategory =
  | "source"
  | "docs"
  | "tests"
  | "examples"
  | "config-samples"
  | "comments-likely";

interface ScanResult {
  repo: string;
  scanStartIso: string;
  scanDurationMs: number;
  filesScanned: number;
  filesSkipped: number;
  bytesScanned: number;
  detectorCounts: Record<string, number>;
  llmCalls: number;
  llmErrors: number;
  estimatedCostUsd: number;
  findings: ScanFinding[];
}

function isHiddenOrSkipped(name: string): boolean {
  if (SKIP_DIRS.has(name)) return true;
  return false;
}

function* walkSourceFiles(
  root: string,
  current = root,
): Generator<{ path: string; size: number }> {
  let entries: string[];
  try {
    entries = readdirSync(current);
  } catch {
    return;
  }
  for (const name of entries) {
    if (isHiddenOrSkipped(name)) continue;
    const full = join(current, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkSourceFiles(root, full);
    } else if (st.isFile()) {
      const ext = name.includes(".") ? `.${name.split(".").slice(-1)[0]}` : "";
      if (!SOURCE_EXTENSIONS.has(ext.toLowerCase())) continue;
      if (st.size > MAX_FILE_BYTES) continue;
      yield { path: full, size: st.size };
    }
  }
}

function classifyPath(relPath: string): PathCategory {
  const norm = relPath.replace(/\\/g, "/").toLowerCase();
  if (
    /(^|\/)(docs?|documentation)\//.test(norm) ||
    /\b(readme|changelog)\b/i.test(basename(norm))
  ) {
    return "docs";
  }
  if (
    /(^|\/)(test|tests|__tests__|spec|specs)\//.test(norm) ||
    /\.(test|spec)\.[a-z]+$/i.test(norm) ||
    /(^|\/)e2e\//.test(norm)
  ) {
    return "tests";
  }
  if (
    /(^|\/)(examples?|samples?|demo|demos|fixtures?)\//.test(norm) ||
    /\b(example|sample)\.[a-z]+$/i.test(basename(norm))
  ) {
    return "examples";
  }
  if (
    /\.(env|env\.example|env\.sample)$/i.test(norm) ||
    /\b(\.env|env)\.(example|sample|template)/i.test(norm)
  ) {
    return "config-samples";
  }
  return "source";
}

function buildSyntheticDiff(relPath: string, content: string): string {
  const lines = content.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const N = lines.length;
  const header =
    `diff --git a/${relPath} b/${relPath}\n` +
    `new file mode 100644\n` +
    `--- /dev/null\n` +
    `+++ b/${relPath}\n` +
    `@@ -0,0 +1,${N} @@\n`;
  const body = lines.map((l) => "+" + l).join("\n");
  return header + body + "\n";
}

/**
 * Extract the line at `lineNumber` (1-indexed) from `content`, truncate
 * to SNIPPET_MAX_CHARS, and redact any portion that looks like a real
 * secret value. Defense-in-depth so the on-disk JSON never contains
 * literal secrets — the bug class this validation is testing for.
 */
function extractRedactedSnippet(
  content: string,
  lineNumber: number,
  patternId: string,
): string {
  const lines = content.split(/\r?\n/);
  const line = lines[lineNumber - 1] ?? "";
  const trimmed = line.trim();
  const truncated =
    trimmed.length > SNIPPET_MAX_CHARS
      ? trimmed.slice(0, SNIPPET_MAX_CHARS) + "..."
      : trimmed;
  return truncated.replace(
    /(sk_live_[A-Za-z0-9]{6,}|pk_live_[A-Za-z0-9]{6,}|sk-ant-api03-[A-Za-z0-9_-]{6,}|AIza[A-Za-z0-9_-]{6,}|AKIA[A-Z0-9]{6,}|hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/\S*|postgres(?:ql)?:\/\/[^:\/\s]+:[^@\s'"]+@\S*)/g,
    (m) => `[REDACTED:${patternId}:${m.length}chars]`,
  );
}

async function scanRepo(repoDir: string): Promise<ScanResult> {
  const repo = basename(repoDir);
  const scanStart = Date.now();
  const findings: ScanFinding[] = [];
  const detectorCounts: Record<string, number> = {
    "secrets-exposure": 0,
    "admin-check": 0,
  };
  // Map raw detector.id (which carries `-multi` suffix) to a clean key
  // used in counts + the per-finding `detector` field on the JSON output.
  const canonicalName = (id: string): string => id.replace(/-multi$/, "");
  let filesScanned = 0;
  let filesSkipped = 0;
  let bytesScanned = 0;
  let totalLlmCalls = 0;
  let totalLlmErrors = 0;

  const secretsDetector = new SecretsExposureDetector();
  const adminDetector = new AdminCheckDetector();

  for (const { path, size } of walkSourceFiles(repoDir)) {
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      filesSkipped++;
      continue;
    }
    filesScanned++;
    bytesScanned += size;
    const relPath = relative(repoDir, path).replace(/\\/g, "/");
    const pathCategory = classifyPath(relPath);
    const diff = buildSyntheticDiff(relPath, content);

    for (const detector of [secretsDetector, adminDetector] as const) {
      let detectorFindings: NormalizedFinding[];
      try {
        detectorFindings = await detector.detect({ diff });
      } catch (err) {
        totalLlmErrors++;
        continue;
      }
      const diag = detector.lastDiagnostics[0];
      if (diag && !diag.preFilterReason) {
        totalLlmCalls++;
      } else if (diag && diag.preFilterReason === "llm-bypass") {
        // No LLM call; bypass path
      }
      for (const f of detectorFindings) {
        const patternId = f.ruleId.split("-").slice(2).join("-");
        const bypassed = diag?.preFilterReason === "llm-bypass";
        const detectorKey = canonicalName(detector.id);
        findings.push({
          repo,
          file: relPath,
          detector: detectorKey,
          patternId,
          line: f.startLine,
          snippet: extractRedactedSnippet(content, f.startLine, patternId),
          explanation: f.explanation,
          confidence: f.confidence,
          bypassed,
          pathCategory,
        });
        detectorCounts[detectorKey] = (detectorCounts[detectorKey] ?? 0) + 1;
      }
    }

    if (totalLlmCalls > 0 && totalLlmCalls % 10 === 0) {
      await new Promise((r) => setTimeout(r, SLEEP_MS_BETWEEN_LLM_CALLS));
    }
  }

  return {
    repo,
    scanStartIso: new Date(scanStart).toISOString(),
    scanDurationMs: Date.now() - scanStart,
    filesScanned,
    filesSkipped,
    bytesScanned,
    detectorCounts,
    llmCalls: totalLlmCalls,
    llmErrors: totalLlmErrors,
    estimatedCostUsd: totalLlmCalls * COST_PER_LLM_CALL_USD,
    findings,
  };
}

async function main(): Promise<void> {
  const [repoDir, outputPath] = process.argv.slice(2);
  if (!repoDir || !outputPath) {
    process.stderr.write(
      "Usage: npx tsx src/test/lib/production-scan.ts <repo-dir> <output.json>\n",
    );
    process.exit(1);
  }
  if (!existsSync(repoDir)) {
    process.stderr.write(`Directory not found: ${repoDir}\n`);
    process.exit(1);
  }

  process.stdout.write(`Scanning: ${repoDir}\n`);
  const result = await scanRepo(repoDir);
  writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");

  process.stdout.write(
    `Done. Files scanned: ${result.filesScanned}, ` +
      `findings: ${result.findings.length} (` +
      `secrets-exposure: ${result.detectorCounts["secrets-exposure"] ?? 0}, ` +
      `admin-check: ${result.detectorCounts["admin-check"] ?? 0}), ` +
      `LLM calls: ${result.llmCalls}, ` +
      `cost: ~$${result.estimatedCostUsd.toFixed(3)}, ` +
      `duration: ${(result.scanDurationMs / 1000).toFixed(1)}s\n`,
  );
  process.stdout.write(`Output: ${outputPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
