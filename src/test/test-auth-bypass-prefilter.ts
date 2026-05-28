/**
 * Auth-bypass prefilter unit test (no LLM, no network).
 *
 * Phase 1 remediation for the missing-middleware false-negative class.
 * Confirmed evidence: fixor-demo/src/routes/admin.ts /users/delete at
 * commit 4270a02 was silently dropped because the file contained no
 * sentinel strings. The dead positive fixture
 * fixtures/auth-bypass/positive/05-missing-middleware.js demonstrates
 * the same blind spot.
 *
 * This test exercises ONLY the regex prefilter via analyzeFile() (and
 * the public lastDiagnostics field). It asserts:
 *
 *   1. Every positive fixture triggers the prefilter (>= 1 hit).
 *      Before the fix, 05-missing-middleware.js and the new
 *      11-admin-router-mixed-guards.ts are expected to FAIL with
 *      triggerCount === 0.
 *
 *   2. The new negative fixture 11-router-properly-guarded.ts MAY
 *      trigger the prefilter once we broaden to route-definition
 *      patterns; that is acceptable (the LLM is the second gate).
 *      The full-stack negative-control behavior is exercised by
 *      `npm run test:auth-bypass`.
 *
 * Run via: npm run test:auth-bypass-prefilter
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

import { AuthBypassDetector } from "../analysis-engine/detectors/auth-bypass.detector";

const FIXTURES_DIR = "fixtures/auth-bypass";

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

function languageForPath(
  path: string,
):
  | "ts"
  | "tsx"
  | "js"
  | "jsx"
  | "py"
  | "go"
  | "rb"
  | "java"
  | "kt"
  | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  const map: Record<string, "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "rb" | "java" | "kt"> = {
    ts: "ts",
    tsx: "tsx",
    js: "js",
    jsx: "jsx",
    mjs: "js",
    cjs: "js",
    py: "py",
    go: "go",
    rb: "rb",
    java: "java",
    kt: "kt",
  };
  return map[ext] ?? null;
}

interface PrefilterCheck {
  file: string;
  isPositive: boolean;
  triggerCount: number;
  ok: boolean;
  note?: string;
}

async function checkPrefilter(
  dir: string,
  isPositive: boolean,
): Promise<PrefilterCheck[]> {
  const detector = new AuthBypassDetector();
  const results: PrefilterCheck[] = [];
  const files = readdirSync(dir)
    .filter((f) => !f.endsWith(".md") && !f.startsWith("."))
    .sort();

  for (const file of files) {
    const filepath = join(dir, file);
    const { assumedPath, content } = loadFixture(filepath);
    const lang = languageForPath(assumedPath);
    if (!lang) {
      results.push({
        file,
        isPositive,
        triggerCount: 0,
        ok: false,
        note: "no language",
      });
      continue;
    }

    // Stub the LLM out — we only care about the prefilter stage here.
    // analyzeFile records triggerCount in lastDiagnostics regardless.
    let triggerCount = 0;
    try {
      // Use private prefilterRegex via reflection by calling analyzeFile
      // with a no-op patch: monkey-patch callClaude is heavier than
      // necessary. Instead we read the lastDiagnostics.triggerCount field
      // populated when analyzeFile() runs — but it ALSO calls the LLM if
      // triggers > 0, costing $. So instead we directly inspect
      // diagnostics by exposing a prefilter-only path:
      //
      // We test prefilterRegex via a tiny shim: call analyzeFile and let
      // it call the LLM ONLY if no fix is needed. But that defeats
      // the purpose. So we instead access the regex set through a
      // public surface — the detector exposes lastDiagnostics, which is
      // set by analyzeFile() before LLM call. We can probe just the
      // prefilter stage by reading the trigger count BEFORE LLM by
      // wrapping the LLM call with a fast-fail. Simplest reliable
      // approach: use the documented test helper analyzeFilePrefilterOnly()
      // that we expose. If not present, fall back to reading via the
      // (unsafe-but-stable) private member.
      const anyDetector = detector as unknown as {
        prefilterRegex?: (
          content: string,
          filePath: string
        ) => { line: number }[];
      };
      if (typeof anyDetector.prefilterRegex === "function") {
        // prefilterRegex gained a required filePath param when lang-gating
        // landed (isPythonPath / isRemixRoutePath call filePath.replace()).
        // Pass the fixture's ASSUMED-PATH so the gating resolves correctly;
        // omitting it throws "reading 'replace'" on undefined.
        const hits = anyDetector.prefilterRegex(content, assumedPath);
        triggerCount = hits.length;
      } else {
        throw new Error("prefilterRegex not accessible");
      }
    } catch (err) {
      results.push({
        file,
        isPositive,
        triggerCount: 0,
        ok: false,
        note: `error: ${(err as Error).message}`,
      });
      continue;
    }

    const passed = isPositive ? triggerCount > 0 : true;
    results.push({
      file,
      isPositive,
      triggerCount,
      ok: passed,
    });
  }
  return results;
}

async function main(): Promise<void> {
  process.stdout.write("auth-bypass prefilter unit test\n");
  process.stdout.write("================================\n\n");

  process.stdout.write("POSITIVES (prefilter must trigger >= 1):\n");
  const positives = await checkPrefilter(
    join(FIXTURES_DIR, "positive"),
    true,
  );
  for (const r of positives) {
    const tag = r.ok ? "PASS" : "FAIL";
    process.stdout.write(
      `  [${tag}] ${r.file}  triggers=${r.triggerCount}` +
        (r.note ? ` (${r.note})` : "") +
        "\n",
    );
  }

  process.stdout.write("\nNEGATIVES (informational — prefilter MAY trigger):\n");
  const negatives = await checkPrefilter(
    join(FIXTURES_DIR, "negative"),
    false,
  );
  for (const r of negatives) {
    process.stdout.write(
      `  [info] ${r.file}  triggers=${r.triggerCount}` +
        (r.note ? ` (${r.note})` : "") +
        "\n",
    );
  }

  const positivesFailing = positives.filter((r) => !r.ok);
  if (positivesFailing.length > 0) {
    process.stdout.write(
      `\nFAIL: ${positivesFailing.length}/${positives.length} positive fixture(s) did NOT trigger the prefilter:\n`,
    );
    for (const r of positivesFailing) {
      process.stdout.write(`  - ${r.file}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `\nPASS: all ${positives.length} positive fixtures triggered the prefilter.\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
