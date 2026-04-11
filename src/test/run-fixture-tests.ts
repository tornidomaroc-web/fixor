import * as fs from "fs";
import * as path from "path";
import { generateSqlInjectionFix, type SqlFixOptions } from "../services/fix.service";
import { extractSqlInjectionFromSemgrep } from "../services/vulnerability.service";
import type {
  PatchQuality,
  ProcessedSqlInjectionResult,
  SemgrepJsonRoot,
  SqlInjectionConfidence,
} from "../types/vulnerability.types";

type SemgrepPipelineInput = string | SemgrepJsonRoot | Record<string, unknown>;

async function processSemgrepJsonForSqlInjection(
  semgrepInput: SemgrepPipelineInput,
  fixOptions?: SqlFixOptions
): Promise<ProcessedSqlInjectionResult[]> {
  const vulnerabilities = extractSqlInjectionFromSemgrep(semgrepInput);
  const results: ProcessedSqlInjectionResult[] = [];
  for (const v of vulnerabilities) {
    try {
      const fix = await generateSqlInjectionFix(v, fixOptions);
      results.push({ vulnerability: v, fix });
    } catch {
      continue;
    }
  }
  return results;
}

type Expected = {
  findingCount: number;
  minClassificationConfidence?: SqlInjectionConfidence;
  fixConfidence?: SqlInjectionConfidence;
  parameterValuesEqual?: string[];
  fixedCodeContains?: string;
  expectedPatchQuality?: PatchQuality;
};

type FixtureFile = {
  id: string;
  dialect?: "mysql" | "postgres";
  semgrep: unknown;
  expected: Expected;
};

function confidenceRank(c: SqlInjectionConfidence): number {
  if (c === "high") return 3;
  if (c === "medium") return 2;
  return 1;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function loadFixtures(dir: string): FixtureFile[] {
  const names = fs.readdirSync(dir).filter((f: string) => f.endsWith(".json"));
  const out: FixtureFile[] = [];
  for (const name of names.sort()) {
    const raw = fs.readFileSync(path.join(dir, name), "utf8");
    try {
      out.push(JSON.parse(raw) as FixtureFile);
    } catch {
      console.error(`Skip invalid JSON: ${name}`);
    }
  }
  return out;
}

function evaluate(
  expected: Expected,
  actual: ProcessedSqlInjectionResult[]
): { ok: boolean; details: string[] } {
  const details: string[] = [];
  let ok = true;

  if (actual.length !== expected.findingCount) {
    ok = false;
    details.push(
      `findingCount: expected ${expected.findingCount}, got ${actual.length}`
    );
    return { ok, details };
  }

  if (expected.findingCount === 0) {
    return { ok: true, details: ["No SQL_INJECTION classification (as expected)."] };
  }

  const first = actual[0];
  const v = first.vulnerability;
  const f = first.fix;

  if (expected.minClassificationConfidence) {
    if (
      confidenceRank(v.classificationConfidence) <
      confidenceRank(expected.minClassificationConfidence)
    ) {
      ok = false;
      details.push(
        `classification: expected >= ${expected.minClassificationConfidence}, got ${v.classificationConfidence} (score ${v.classificationScore})`
      );
    }
  }

  if (expected.fixConfidence && f.confidence !== expected.fixConfidence) {
    ok = false;
    details.push(
      `fix.confidence: expected ${expected.fixConfidence}, got ${f.confidence}`
    );
  }

  if (expected.parameterValuesEqual) {
    if (!arraysEqual(f.parameterValues, expected.parameterValuesEqual)) {
      ok = false;
      details.push(
        `parameterValues: expected ${JSON.stringify(expected.parameterValuesEqual)}, got ${JSON.stringify(f.parameterValues)}`
      );
    }
  }

  if (expected.fixedCodeContains) {
    if (!f.fixedCode.includes(expected.fixedCodeContains)) {
      ok = false;
      details.push(
        `fixedCode: expected to contain "${expected.fixedCodeContains}"`
      );
    }
  }

  if (expected.expectedPatchQuality) {
    if (f.patchQuality !== expected.expectedPatchQuality) {
      ok = false;
      details.push(
        `patchQuality: expected ${expected.expectedPatchQuality}, got ${f.patchQuality}`
      );
    }
  }

  if (ok && details.length === 0) {
    details.push("All assertions matched.");
  }

  return { ok, details };
}

async function main() {
  const root = process.cwd();
  const fixturesDir = path.join(root, "fixtures");
  if (!fs.existsSync(fixturesDir)) {
    console.error(`Fixtures directory not found: ${fixturesDir}`);
    process.exit(1);
  }

  const fixtures = loadFixtures(fixturesDir);
  console.log(`Loaded ${fixtures.length} fixture(s) from ${fixturesDir}\n`);

  const summary: { id: string; ok: boolean }[] = [];

  for (const fx of fixtures) {
    console.log("═".repeat(60));
    console.log(`Fixture: ${fx.id} (${fx.dialect ?? "mysql"} default dialect)`);
    console.log("═".repeat(60));

    const parsedObject = fx.semgrep as Record<string, unknown>;
    const fromObject = await processSemgrepJsonForSqlInjection(parsedObject, {
      dialect: fx.dialect ?? "mysql",
    });
    const fromString = await processSemgrepJsonForSqlInjection(JSON.stringify(fx.semgrep), {
      dialect: fx.dialect ?? "mysql",
    });

    const objectOk = arraysEqual(
      fromObject.map((r) => r.vulnerability.ruleId),
      fromString.map((r) => r.vulnerability.ruleId)
    );
    if (!objectOk || fromObject.length !== fromString.length) {
      console.log("PIPELINE: WARN — string vs object input mismatch");
    }

    const actual = fromObject;
    const { ok, details } = evaluate(fx.expected, actual);

    console.log(
      ok ? "RESULT: PASS" : "RESULT: FAIL",
      details.length ? `— ${details.join(" | ")}` : ""
    );

    console.log("\n--- Classification (actual) ---");
    if (actual.length > 0) {
      const v = actual[0].vulnerability;
      console.log(`  type: ${v.type}`);
      console.log(`  classificationConfidence: ${v.classificationConfidence}`);
      console.log(`  classificationScore: ${v.classificationScore}`);
      console.log(`  ruleId: ${v.ruleId}`);
      console.log(`  file: ${v.file}:${v.startLine}-${v.endLine}`);
      console.log(`  message: ${v.message.slice(0, 120)}${v.message.length > 120 ? "…" : ""}`);
    } else {
      console.log("  (no SQL_INJECTION above threshold)");
    }

    console.log("\n--- Generated patch (actual) ---");
    if (actual.length > 0) {
      const fix = actual[0].fix;
      console.log(`  fixedCode: ${fix.fixedCode}`);
      console.log(`  parameterValues: ${JSON.stringify(fix.parameterValues)}`);
      console.log(`  dialect: ${fix.dialect}`);
      console.log(`  fix.confidence: ${fix.confidence}`);
      console.log(`  patchQuality: ${fix.patchQuality}`);
      console.log(
        `  patchWarnings: ${fix.patchWarnings.length ? fix.patchWarnings.map((w) => `\n    - ${w}`).join("") : "(none)"}`
      );
    } else {
      console.log("  (none)");
    }

    console.log("\n--- Regression: expected vs actual ---");
    if (fx.expected.findingCount === 0) {
      console.log(`  findingCount: expected 0, got ${actual.length}`);
    } else {
      const f = actual[0]?.fix;
      console.log(
        `  classificationConfidence: expected >= ${fx.expected.minClassificationConfidence ?? "(any)"}, got ${actual[0]?.vulnerability.classificationConfidence ?? "n/a"}`
      );
      console.log(
        `  fix.confidence: expected ${fx.expected.fixConfidence ?? "(any)"}, got ${f?.confidence ?? "n/a"}`
      );
      console.log(
        `  parameterValues: expected ${JSON.stringify(fx.expected.parameterValuesEqual ?? "(any)")}, got ${JSON.stringify(f?.parameterValues ?? [])}`
      );
      console.log(
        `  patchQuality: expected ${fx.expected.expectedPatchQuality ?? "(any)"}, got ${f?.patchQuality ?? "n/a"}`
      );
      if (fx.expected.fixedCodeContains) {
        const contains = f?.fixedCode.includes(fx.expected.fixedCodeContains) ?? false;
        console.log(
          `  fixedCode contains "${fx.expected.fixedCodeContains}": expected true, got ${contains}`
        );
      }
    }

    console.log("\n--- Expectations summary ---");
    for (const d of details) console.log(`  • ${d}`);

    summary.push({ id: fx.id, ok });
  }

  console.log("\n" + "═".repeat(60));
  console.log("SUMMARY");
  console.log("═".repeat(60));
  const passed = summary.filter((s) => s.ok).length;
  const failed = summary.length - passed;
  for (const s of summary) {
    console.log(`  [${s.ok ? "PASS" : "FAIL"}] ${s.id}`);
  }
  console.log(`\nTotal: ${passed} passed, ${failed} failed (of ${summary.length})`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
