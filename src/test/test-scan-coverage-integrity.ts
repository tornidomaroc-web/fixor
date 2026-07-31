/**
 * Scan coverage-integrity regression test (deterministic, no LLM spend, no DB).
 *
 * Guards F-002 and F-003. Both turned a failure into silence in cli/scan.ts:
 * a detector that threw, and a file whose analysis aborted, each produced zero
 * findings that were indistinguishable from "analyzed and found clean". Neither
 * reached the llm-coverage gate, because that gate only counts callClaude
 * outcomes, so both exited 0 while the report printed the positive
 * "LLM detection coverage: full" line. Measured at 41b1f95e: a two-file repo
 * with both files unreadable produced "Total files scanned: 2",
 * "coverage: full - 0/0 calls succeeded", exit 0.
 *
 * Covers:
 *   1. Report: an unread file degrades the scan even when ZERO LLM calls were
 *      made (the 0/0 trap), names the casualty, and never prints "full".
 *   2. Report: a detector throw degrades the scan and names file + detector id,
 *      while real findings from the same run still render.
 *   3. Report: a genuinely clean run still renders the positive line and no
 *      banner (the no-false-warning control).
 *   4. countCoverageDegradations composes all three channels; coverageExitCode
 *      maps any non-zero to 2.
 *   5. E2E, detector-throw channel: the real CLI on a real repo, exit 2.
 *   6. E2E, file-aborted channel: the real CLI on a real repo, exit 2.
 *
 * SPEND: zero. This test spawns dist/cli/scan.js, which CLAUDE.md lists as a
 * real unbounded spending entry point, so the locks are stated in full:
 *
 *   1. FIXOR_REPLAY=1 with an EMPTY FIXOR_REPLAY_ROOT: loadReplayFixture
 *      throws before getAnthropicClient() is ever constructed (the replay
 *      branch precedes client construction in anthropic-client.ts).
 *   2. ANTHROPIC_API_KEY is a dummy, overriding any ambient or .env value.
 *   3. ANTHROPIC_BASE_URL points at a dead loopback port, so a request
 *      cannot leave the machine even if 1 and 2 both failed. PREVENTION.
 *   4. The file-aborted fixture is inert code that clears no prefilter, so
 *      that E2E reaches no model regardless of configuration.
 *   5. Both E2Es ASSERT the child reported 0 LLM calls attempted. DETECTION.
 *
 * Locks 1-3 are set here in source and cannot be restored at runtime:
 * verified against the real binary that nothing on scan.js's import path
 * calls process.loadEnvFile or loads dotenv, and that no lock variable
 * changes value during a full run. Same in-source model as
 * test-degraded-coverage.ts, which deletes the key at its first line.
 *
 * PORTABILITY. Both E2Es run identically on win32 and linux and use no OS
 * trick and no test seam in production code. The file-aborted case needs a
 * read to fail on both platforms, and the walker only ever enumerates regular
 * files (file-walker.ts gates on entry.isFile()), so chmod/symlink/directory
 * tricks are unavailable and platform-specific anyway. Instead it uses a
 * barrier that already exists in production: scan.ts enumerates files, then
 * BLOCKS on the interactive confirmation prompt, and only then reads each
 * file. The test spawns the CLI without --yes, waits for the prompt, deletes
 * the file, and only then answers. The read provably happens after the
 * delete, with no timing assumption. ENOENT is identical on both platforms.
 *
 * Run via: npm run test:scan-coverage
 */

import { spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildMarkdownReport,
  countCoverageDegradations,
  type FileScanResult,
} from "../cli/report-builder";
import { coverageExitCode } from "../lib/llm-coverage";
import type { Finding } from "../analysis-engine/types";

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    failures++;
  } else {
    console.log(`[PASS] ${msg}`);
  }
}

function sampleFinding(file: string): Finding {
  return {
    type: "auth_bypass_risk",
    file,
    line: 10,
    confidence: "high",
    severity: "critical",
    explanation: "test finding",
    why_it_matters: "test",
    suggested_fix: "test",
    example_fix: "test",
    original_snippet: "router.get('/admin', handler)",
  };
}

/** A file the estimator and the detectors both ignore: no route shape, no
 *  content-prefilter trigger, so it makes zero LLM calls even when analyzed. */
const INERT_SOURCE = "export function addTwo(a: number): number {\n  return a + 2;\n}\n";

/** FastAPI IDOR shape: clears prefilters and reaches the model boundary,
 *  where an empty replay root turns every call into a throw. */
const ROUTE_SHAPED_SOURCE = [
  "from fastapi import APIRouter, Depends",
  "from app.db import get_session",
  "router = APIRouter()",
  '@router.get("/items/{item_id}")',
  "def read_item(item_id: int, session = Depends(get_session)):",
  "    item = session.get(Item, item_id)",
  "    return item",
  "",
].join("\n");

// ---------------------------------------------------------------- 1 + 2 + 3

function testReportUnreadFile(): void {
  console.log("\n--- 1. report: unread file with ZERO llm calls (the 0/0 trap) ---");

  const results: FileScanResult[] = [
    { filePath: "src/clean.ts", findings: [], llmFailures: 0, llmFailuresByReason: {} },
    {
      filePath: "src/vanished.ts",
      findings: [],
      llmFailures: 0,
      llmFailuresByReason: {},
      notAnalyzed: { stage: "read", reason: "ENOENT: no such file or directory" },
    },
  ];
  // The exact shape that exited 0 and claimed full coverage at 41b1f95e.
  const md = buildMarkdownReport("repo", results, {
    coverage: { attempted: 0, failed: 0, byReason: {} },
  });

  assert(
    !md.includes("LLM detection coverage: full"),
    "an unread file suppresses the positive full-coverage claim",
  );
  assert(
    md.includes("DEGRADED COVERAGE — NOT A CLEAN SCAN"),
    "an unread file renders the degraded banner even at 0/0 calls",
  );
  assert(
    md.includes("## Coverage gaps (NOT fully analyzed)"),
    "an unread file opens the Coverage gaps section",
  );
  assert(
    md.includes("`src/vanished.ts` — NOT ANALYZED (aborted at read): ENOENT"),
    "the unread file is named as a casualty, with its stage and reason",
  );
  assert(
    md.includes("- Files fully analyzed: 1 of 2"),
    "a file that was never read is not counted as analyzed",
  );
  assert(
    !md.includes("Total files scanned"),
    "the count that included never-opened files is gone",
  );

  const allUnread = buildMarkdownReport(
    "repo",
    [results[1]!],
    { coverage: { attempted: 0, failed: 0, byReason: {} } },
  );
  assert(
    allUnread.includes("SCAN BLIND — NO FILE WAS ANALYZED"),
    "a run where nothing was analyzed renders the blind banner",
  );
}

function testReportDetectorThrow(): void {
  console.log("\n--- 2. report: detector throw ---");

  const results: FileScanResult[] = [
    {
      filePath: "src/route.py",
      findings: [sampleFinding("src/route.py")],
      llmFailures: 0,
      llmFailuresByReason: {},
      detectorFailures: [
        { detectorId: "idor-multi", reason: "TypeError: cannot read property" },
      ],
    },
  ];
  const md = buildMarkdownReport("repo", results, {
    coverage: { attempted: 4, failed: 0, byReason: {} },
  });

  assert(
    !md.includes("LLM detection coverage: full"),
    "a detector throw suppresses the positive full-coverage claim",
  );
  assert(
    md.includes("scan coverage is **DEGRADED**"),
    "the summary states degradation even though every LLM call succeeded",
  );
  assert(
    md.includes("`src/route.py` — detector `idor-multi` failed: TypeError"),
    "the throwing detector is named by file and detector id",
  );
  assert(
    md.includes("### auth_bypass_risk — critical"),
    "findings from the detectors that DID run still render",
  );
}

function testReportCleanControl(): void {
  console.log("\n--- 3. report: clean control (no false warning) ---");

  const md = buildMarkdownReport(
    "repo",
    [{ filePath: "src/clean.ts", findings: [], llmFailures: 0, llmFailuresByReason: {} }],
    { coverage: { attempted: 12, failed: 0, byReason: {} } },
  );
  assert(
    md.includes("LLM detection coverage: full — 12/12 calls succeeded"),
    "a genuinely clean run still makes full coverage an explicit positive claim",
  );
  assert(
    !md.includes("DEGRADED") && !md.includes("SCAN BLIND"),
    "no false degradation banner on a clean run",
  );
  assert(!md.includes("## Coverage gaps"), "no Coverage gaps section on a clean run");
}

function testDegradationCount(): void {
  console.log("\n--- 4. degradation count and exit mapping ---");

  const clean: FileScanResult[] = [{ filePath: "a.ts", findings: [], llmFailures: 0 }];
  assert(
    countCoverageDegradations(clean, { attempted: 5, failed: 0, byReason: {} }) === 0,
    "clean run counts zero degradations",
  );
  assert(
    coverageExitCode(countCoverageDegradations(clean, { attempted: 5, failed: 0, byReason: {} })) === 0,
    "clean run exits 0",
  );

  const mixed: FileScanResult[] = [
    { filePath: "a.ts", findings: [], notAnalyzed: { stage: "read", reason: "EACCES" } },
    {
      filePath: "b.ts",
      findings: [],
      detectorFailures: [
        { detectorId: "idor-multi", reason: "boom" },
        { detectorId: "admin-check-multi", reason: "boom" },
      ],
    },
  ];
  assert(
    countCoverageDegradations(mixed, { attempted: 9, failed: 3, byReason: {} }) === 6,
    "all three channels compose (3 llm + 1 unread + 2 detector = 6)",
  );
  assert(
    coverageExitCode(countCoverageDegradations(mixed, undefined)) === 2,
    "unread file + detector throws exit 2 with no llm failures at all",
  );
}

// ------------------------------------------------------------------ 5 and 6

/** Sibling of this compiled test under dist/. */
const SCAN_CLI = join(__dirname, "..", "cli", "scan.js");

interface RunResult {
  code: number | null;
  out: string;
  report: string;
}

/** pino-pretty colorizes in dev and emits JSON in prod; assertions on the
 *  child's log must survive both, so drop SGR sequences before matching. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, "");
}

/** True when the child's completion log reports zero LLM calls attempted,
 *  in either pino output format. This is the in-test proof of the spend lock. */
function spentNothing(out: string): boolean {
  return /llmCallsAttempted"?:\s*0(?![0-9])/.test(stripAnsi(out));
}

/**
 * Drive the real CLI. When `deleteBeforeConfirm` is set, the child is spawned
 * WITHOUT --yes and that file is removed while the child sits blocked on the
 * confirmation prompt, so its later read fails deterministically.
 */
function runScan(
  repo: string,
  reportPath: string,
  replayRoot: string,
  deleteBeforeConfirm?: string,
): Promise<RunResult> {
  const args = [SCAN_CLI, repo, `--output=${reportPath}`];
  if (!deleteBeforeConfirm) args.push("--yes");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        FIXOR_REPLAY: "1",
        FIXOR_REPLAY_ROOT: replayRoot,
        FIXOR_RECORD: "",
        // Deliberately short and obviously not key-shaped. The pre-commit
        // secret scanner flags a key-named field assigned a 24+ character
        // opaque literal, which is exactly the shape a real key pasted here
        // would have. Keeping the placeholder well under that keeps the
        // scanner able to catch that mistake at this very line.
        ANTHROPIC_API_KEY: "not-a-real-key",
        // Connection-level backstop. The SDK reads baseURL from this var and
        // getAnthropicClient passes none, so if EVERY other lock failed at
        // once the request would go to a dead loopback port and die with
        // ECONNREFUSED without leaving the machine. This one PREVENTS spend
        // rather than detecting it after the fact, which is what the other
        // locks do. `test:ci` runs on machines with a real key in .env.
        ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
      },
    });
    let out = "";
    let fired = false;
    // The barrier depends on the confirmation prompt still being there. If it
    // is ever removed or reworded, this must FAIL, not hang until the job
    // timeout: a test that stalls reads as infrastructure flake rather than
    // as the regression it is.
    const watchdog = setTimeout(() => {
      out += "\n[watchdog] child did not exit within 60s; killed.\n";
      child.kill();
    }, 60_000);
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      if (deleteBeforeConfirm && !fired && out.includes("Proceed?")) {
        fired = true;
        // The child is blocked on stdin here: enumeration is done, no file
        // has been read yet. Removing the file now is a barrier, not a race.
        rmSync(deleteBeforeConfirm, { force: true });
        child.stdin.write("yes\n");
        child.stdin.end();
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(watchdog);
      resolve({
        code,
        out,
        report: existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "",
      });
    });
  });
}

async function testE2eDetectorThrow(tmp: string, replayRoot: string): Promise<void> {
  console.log("\n--- 5. E2E: detector throw through the real CLI ---");

  const repo = join(tmp, "repo-detector-throw");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "items.py"), ROUTE_SHAPED_SOURCE);
  const reportPath = join(tmp, "report-detector-throw.md");

  const r = await runScan(repo, reportPath, replayRoot);

  assert(r.code === 2, `detector throws exit 2 (got ${r.code})`);
  assert(
    /detector FAILED; file not fully analyzed/.test(r.out),
    "the throwing detector is logged at error level",
  );
  assert(
    !r.report.includes("LLM detection coverage: full"),
    "the report does not claim full coverage after a detector throw",
  );
  assert(
    /- `items\.py` — detector `[a-z-]+` failed:/.test(r.report),
    "the report names the file and the failing detector id",
  );
  assert(
    spentNothing(r.out),
    "spend lock held: the child attempted zero LLM calls",
  );
}

async function testE2eFileAborted(tmp: string, replayRoot: string): Promise<void> {
  console.log("\n--- 6. E2E: file analysis aborted through the real CLI ---");

  const repo = join(tmp, "repo-file-aborted");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "a-survives.ts"), INERT_SOURCE);
  const doomed = join(repo, "b-vanishes.ts");
  writeFileSync(doomed, INERT_SOURCE);
  const reportPath = join(tmp, "report-file-aborted.md");

  const r = await runScan(repo, reportPath, replayRoot, doomed);

  assert(r.code === 2, `an unreadable file exits 2 (got ${r.code})`);
  assert(
    /file NOT ANALYZED: scan aborted for this file/.test(r.out),
    "the aborted file is logged at error level",
  );
  assert(
    !r.report.includes("LLM detection coverage: full"),
    "the report does not claim full coverage when a file was never read",
  );
  assert(
    /- `b-vanishes\.ts` — NOT ANALYZED \(aborted at read\)/.test(r.report),
    "the report names the unread file and the stage it died at",
  );
  assert(
    r.report.includes("- Files fully analyzed: 1 of 2"),
    "the never-opened file is excluded from the analyzed count",
  );
  assert(
    spentNothing(r.out),
    "spend lock held: the child attempted zero LLM calls",
  );
}

async function main(): Promise<void> {
  testReportUnreadFile();
  testReportDetectorThrow();
  testReportCleanControl();
  testDegradationCount();

  const tmp = mkdtempSync(join(tmpdir(), "fixor-scan-coverage-"));
  // Empty replay root: every request key misses, so any call that reaches the
  // model boundary throws before a client exists. Zero network, zero spend.
  const replayRoot = join(tmp, "replay-root-empty");
  mkdirSync(replayRoot, { recursive: true });
  try {
    await testE2eDetectorThrow(tmp, replayRoot);
    await testE2eFileAborted(tmp, replayRoot);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(
    failures === 0
      ? "\nScan coverage-integrity test: PASS."
      : `\nScan coverage-integrity test: ${failures} FAILURE(S).`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
