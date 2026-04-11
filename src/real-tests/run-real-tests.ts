import * as fs from "fs";
import * as path from "path";
import { REAL_TEST_CASES, type RealTestCase } from "./cases";
import {
  averageFixQuality,
  countMetrics,
  isTruePositive,
  toRepoRelativePath,
} from "./evaluate";
import { isSemgrepAvailable, runSemgrepScan } from "./semgrep-runner";
import { generateSqlInjectionFix } from "../services/fix.service";
import { extractSqlInjectionFromSemgrep } from "../services/vulnerability.service";
import type {
  ProcessedSqlInjectionResult,
  SemgrepJsonRoot,
} from "../types/vulnerability.types";

type SemgrepPipelineInput = string | SemgrepJsonRoot | Record<string, unknown>;

async function processSemgrepJsonForSqlInjection(
  semgrepInput: SemgrepPipelineInput,
  fixOptions?: { dialect?: "mysql" | "postgres" }
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

export type RealTestReportJson = {
  repo: string;
  totalFindings: number;
  sqlInjectionFindings: number;
  fixesGenerated: number;
  truePositives: number;
  falsePositives: number;
  fixQualityScore: number;
  summary: string;
};

function projectRoot(): string {
  return path.resolve(__dirname, "../..");
}

function realTestsRoot(): string {
  return path.join(projectRoot(), "src", "real-tests");
}

function parseArgs(argv: string[]): {
  live: boolean;
  jsonOut?: string;
  repoPath?: string;
  dialect?: "mysql" | "postgres";
  semgrepJsonPath?: string;
} {
  const out: ReturnType<typeof parseArgs> = { live: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") out.live = true;
    else if (a === "--json-out" && argv[i + 1]) {
      out.jsonOut = argv[++i];
    } else if (a === "--repo" && argv[i + 1]) {
      out.repoPath = path.resolve(argv[++i]);
    } else if (a === "--dialect" && argv[i + 1]) {
      const d = argv[++i];
      if (d === "mysql" || d === "postgres") out.dialect = d;
    } else if (a === "--semgrep-json" && argv[i + 1]) {
      out.semgrepJsonPath = path.resolve(argv[++i]);
    }
  }
  return out;
}

function loadJson(fileAbs: string): string {
  return fs.readFileSync(fileAbs, "utf8");
}

function countSemgrepResults(jsonStr: string): number {
  try {
    const o = JSON.parse(jsonStr) as { results?: unknown[] };
    return Array.isArray(o.results) ? o.results.length : 0;
  } catch {
    return 0;
  }
}

function buildSummary(r: RealTestReportJson): string {
  return (
    `Semgrep: ${r.totalFindings} raw finding(s); Fixor SQL_INJECTION: ${r.sqlInjectionFindings}; ` +
    `fixes: ${r.fixesGenerated}; TP=${r.truePositives} FP=${r.falsePositives}; ` +
    `avg fix quality=${r.fixQualityScore}/100.`
  );
}

async function runOneCase(
  c: RealTestCase,
  options: { live: boolean }
): Promise<{
  report: RealTestReportJson;
  processed: ProcessedSqlInjectionResult[];
  source: "precomputed" | "semgrep";
}> {
  const repoAbs = path.join(realTestsRoot(), c.repoSubdir);
  const preAbs = path.join(realTestsRoot(), c.precomputedRelative);

  let jsonStr: string;
  let source: "precomputed" | "semgrep" = "precomputed";

  if (options.live) {
    const sg = runSemgrepScan(repoAbs);
    if (sg.ok && sg.json) {
      jsonStr = sg.json;
      source = "semgrep";
    } else {
      console.warn(
        `[${c.id}] Live Semgrep failed, using precomputed: ${sg.error || "unknown"}`
      );
      jsonStr = loadJson(preAbs);
    }
  } else {
    jsonStr = loadJson(preAbs);
  }

  const totalFindings = countSemgrepResults(jsonStr);
  const processed = await processSemgrepJsonForSqlInjection(jsonStr, {
    dialect: c.dialect,
  });

  const findings = processed.map((p) => p.vulnerability);
  const fixes = processed.map((p) => p.fix);
  const { truePositives, falsePositives } = countMetrics(
    findings,
    c.groundTruth,
    repoAbs
  );
  const fixQualityScore = averageFixQuality(fixes);

  const report: RealTestReportJson = {
    repo: repoAbs,
    totalFindings,
    sqlInjectionFindings: processed.length,
    fixesGenerated: processed.length,
    truePositives,
    falsePositives,
    fixQualityScore,
    summary: "",
  };
  report.summary = buildSummary(report);

  return { report, processed, source };
}

function printCaseDetail(
  c: RealTestCase,
  processed: ProcessedSqlInjectionResult[],
  repoAbs: string
): void {
  console.log(`\n  SQL injection findings (${processed.length}):`);
  for (const p of processed) {
    const v = p.vulnerability;
    const rel = toRepoRelativePath(v.file, repoAbs);
    const tp = isTruePositive(v, c.groundTruth, repoAbs) ? "TP" : "FP";
    console.log(
      `    - [${tp}] ${rel}:${v.startLine} score=${v.classificationScore} rule=${v.ruleId}`
    );
    console.log(`      message: ${v.message.slice(0, 100)}${v.message.length > 100 ? "…" : ""}`);
  }

      console.log(`\n  Fixes generated (${processed.length}), samples (up to 2):`);
      for (const p of processed.slice(0, 2)) {
        const f = p.fix;
        console.log(
          `    · dialect=${f.dialect} confidence=${f.confidence} patchQuality=${f.patchQuality} params=${JSON.stringify(f.parameterValues)}`
        );
        if (f.patchWarnings.length) {
          console.log(`      warnings: ${f.patchWarnings.join(" | ")}`);
        }
        console.log(`      original: ${f.originalCode.replace(/\s+/g, " ").slice(0, 120)}…`);
        console.log(`      fixed:    ${f.fixedCode.replace(/\s+/g, " ").slice(0, 120)}…`);
      }
}

async function runAdHocRepo(args: {
  repoPath: string;
  dialect: "mysql" | "postgres";
  live: boolean;
  semgrepJsonPath?: string;
}): Promise<RealTestReportJson> {
  const repoAbs = path.resolve(args.repoPath);
  let jsonStr: string;

  if (args.semgrepJsonPath) {
    jsonStr = loadJson(args.semgrepJsonPath);
  } else if (args.live) {
    const sg = runSemgrepScan(repoAbs);
    if (!sg.ok || !sg.json) {
      throw new Error(sg.error || "semgrep failed");
    }
    jsonStr = sg.json;
  } else {
    throw new Error("Provide --semgrep-json <file> or --live with --repo");
  }

  const totalFindings = countSemgrepResults(jsonStr);
  const processed = await processSemgrepJsonForSqlInjection(jsonStr, {
    dialect: args.dialect,
  });
  const fixes = processed.map((p) => p.fix);
  const report: RealTestReportJson = {
    repo: repoAbs,
    totalFindings,
    sqlInjectionFindings: processed.length,
    fixesGenerated: processed.length,
    truePositives: 0,
    falsePositives: processed.length,
    fixQualityScore: averageFixQuality(fixes),
    summary: "",
  };
  report.summary = `Ad-hoc scan: ${report.sqlInjectionFindings} SQL_INJECTION from ${report.totalFindings} Semgrep results (no ground truth).`;
  return report;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  console.log("Fixor real-tests (SQL injection pipeline)");
  console.log(`Semgrep CLI: ${isSemgrepAvailable() ? "available" : "not found"} (optional for --live)\n`);

  if (args.repoPath || args.semgrepJsonPath) {
    const dialect = args.dialect ?? "mysql";
    try {
      const r = await runAdHocRepo({
        repoPath: args.repoPath || process.cwd(),
        dialect,
        live: args.live,
        semgrepJsonPath: args.semgrepJsonPath,
      });
      console.log(JSON.stringify(r, null, 2));
      if (args.jsonOut) {
        fs.writeFileSync(args.jsonOut, JSON.stringify(r, null, 2), "utf8");
      }
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  const reports: RealTestReportJson[] = [];

  for (const c of REAL_TEST_CASES) {
    console.log("═".repeat(64));
    console.log(`Case: ${c.id}`);
    console.log(`  ${c.label}`);
    const { report, processed, source } = await runOneCase(c, { live: args.live });
    console.log(`  Input: ${source}`);
    console.log(`  Findings count (raw Semgrep): ${report.totalFindings}`);
    console.log(`  SQL injection (Fixor):       ${report.sqlInjectionFindings}`);
    console.log(`  Fixes generated:              ${report.fixesGenerated}`);
    console.log(`  True positives:               ${report.truePositives}`);
    console.log(`  False positives:              ${report.falsePositives}`);
    console.log(`  Fix quality (avg):            ${report.fixQualityScore}/100`);
    console.log(`  Summary: ${report.summary}`);

    printCaseDetail(c, processed, path.join(realTestsRoot(), c.repoSubdir));

    const expectedMatch =
      c.id === "safe-parameterized"
        ? report.sqlInjectionFindings === 0 &&
          report.falsePositives === 0 &&
          report.truePositives === 0
        : report.truePositives >= 1 &&
          report.falsePositives === 0 &&
          report.sqlInjectionFindings >= 1;

    console.log(
      `\n  Ground-truth check: ${expectedMatch ? "PASS" : "REVIEW"} (heuristic)`
    );

    reports.push(report);
  }

  console.log("\n" + "═".repeat(64));
  console.log("REPORTS (JSON)");
  console.log(JSON.stringify(reports, null, 2));

  if (args.jsonOut) {
    fs.writeFileSync(args.jsonOut, JSON.stringify(reports, null, 2), "utf8");
    console.log(`\nWrote ${args.jsonOut}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
