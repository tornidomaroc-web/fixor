/**
 * Forced-routing rehearsal (free, keyless, in test:ci). Drives the runner in
 * --mode mock and checks the runner's own guarantees; it never spends and
 * never constructs an Anthropic client.
 *
 *   A. Request identity: on a fixture that pairs / triggers naturally, the
 *      forced path produces the SAME request body as the shipped path, for
 *      each of the three lanes. This is what licenses the idor mirror of
 *      langDisplay/extractImports and the prefilter swap.
 *   B. Missing key: --mode live without --key-file exits 3 and writes no
 *      run; an ambient ANTHROPIC_API_KEY is refused in both modes.
 *   C. Full dry run: all pre-registered targets x n runs against a synthetic
 *      corpus laid out like the real one (the real corpora are outside the
 *      repository), with a mock that flags parent-side files; every request
 *      and response file exists, the count is the plan, results.json is
 *      complete, and the scorer registers hits and non-hits.
 *   D. Ceiling: a mock reporting inflated usage stops the run before the
 *      cumulative measured cost passes the ceiling, with partial results.
 *
 * No timing bounds anywhere.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { Message } from "@anthropic-ai/sdk/resources/messages";

import { setCallClaudeTestDeps } from "../analysis-engine/anthropic-client";
import { idorPrefilterHits } from "../analysis-engine/detectors/idor.detector";
import {
  INPUTS_DIR,
  forcedCall,
  langFor,
  makeDetectors,
  readPrereg,
  readTargets,
  type Lane,
} from "./lib/forced-routing";

const out = process.stdout;
let failures = 0;
const pass = (m: string): void => void out.write(`  PASS ${m}\n`);
const fail = (m: string): void => {
  failures++;
  out.write(`  FAIL ${m}\n`);
};

delete process.env.ANTHROPIC_API_KEY;
const RUNNER = join("dist", "test", "forced-routing-runner.js");

function loadFixture(p: string): { assumedPath: string; content: string } {
  const lines = readFileSync(p, "utf8").split(/\r?\n/);
  const m = /\/\/\s*ASSUMED-PATH:\s*(.+?)\s*$/.exec(lines[0] ?? "");
  if (!m) throw new Error(`${p}: no ASSUMED-PATH`);
  return { assumedPath: m[1]!, content: lines.slice(1).join("\n") };
}

// --- A. request identity ----------------------------------------------------
async function requestIdentity(): Promise<void> {
  out.write("\nA. forced request == shipped request, per lane\n");
  const captured: unknown[] = [];
  const canned = (tool: string): Record<string, unknown> =>
    tool === "report_idor_findings"
      ? { verdicts: [{ pairIndex: 0, isVulnerable: false, confidence: "low", reasoning: "canned", callerAuth: "unclear", operationClass: "user_resource", suggestedFix: "" }] }
      : { isVulnerable: false, confidence: "low", reasoning: "canned", authPresent: "unclear", operationKind: "general", suggestedFix: "", vulnerableRoute: "" };
  setCallClaudeTestDeps({
    create: async (body) => {
      captured.push(body);
      const tool = (body as { tools?: { name: string }[] }).tools?.[0]?.name ?? "";
      return { id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "tool_use", id: "t", name: tool, input: canned(tool) }], stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as unknown as Message;
    },
    recordCost: async () => undefined,
  });
  const dets = makeDetectors();
  const cases: Array<{ lane: Lane; fixture: string }> = [
    { lane: "auth-bypass", fixture: "fixtures/reach/auth-bypass/positive/02-fastify-server-missing-auth.ts" },
    { lane: "admin-check", fixture: "fixtures/reach/admin-check/positive/02-fastify-server-missing-admin.ts" },
    { lane: "idor", fixture: "fixtures/reach/idor/positive/05-express-sequelize-destroy.ts" },
  ];
  for (const c of cases) {
    const { assumedPath, content } = loadFixture(c.fixture);
    const lang = langFor(assumedPath);
    captured.length = 0;
    // Shipped path: the public analyzeFile with the SAME content string
    // (detect() would first round-trip the file through a synthetic diff,
    // which normalises the trailing newline and is not what is under test).
    await (dets[c.lane] as unknown as { analyzeFile: (p: string, c: string, l: string) => Promise<unknown> }).analyzeFile(assumedPath, content, lang);
    const shipped = JSON.stringify(captured[0]);
    // Forced path at the SAME anchor the shipped prefilter chose.
    let anchor: number;
    if (c.lane === "idor") {
      const { pairs } = idorPrefilterHits(content, lang);
      anchor = pairs[0]!.sink.line;
    } else {
      const det = dets[c.lane] as unknown as { prefilterRegex: (c: string, p: string) => Array<{ patternId: string; line: number }> };
      anchor = det.prefilterRegex(content, assumedPath).find((h) => h.patternId === "express_route_def")!.line;
    }
    captured.length = 0;
    await forcedCall(dets, c.lane, assumedPath, content, anchor);
    const forced = JSON.stringify(captured[0]);
    if (shipped && shipped === forced) pass(`${c.lane}: identical request bytes (${shipped.length} chars) at anchor ${anchor}`);
    else fail(`${c.lane}: forced request differs from shipped (${shipped.length} vs ${forced.length} chars)`);
  }
  setCallClaudeTestDeps(null);
}

// --- synthetic corpus --------------------------------------------------------
function syntheticCorpus(): string {
  const root = mkdtempSync(join(tmpdir(), "fr-rehearsal-"));
  const targets = readTargets(process.cwd(), root); // paths only; files do not exist yet
  for (const t of targets) {
    mkdirSync(dirname(t.abs), { recursive: true });
    const lines: string[] = ['import { Router } from "express";', "const router = Router();"];
    while (lines.length < t.anchorLine - 1) lines.push(`// line ${lines.length + 1}`);
    lines.push('router.get("/x/:id", async (req, res) => { res.json(await db.findOne(req.params.id)); });');
    writeFileSync(t.abs, lines.join("\n") + "\n");
  }
  return root;
}

function runRunner(args: string[], env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [RUNNER, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

async function main(): Promise<void> {
  const prereg = readPrereg(process.cwd());
  const inputs = readdirSync(INPUTS_DIR);
  pass(`inputs present: ${inputs.join(", ")}`);

  await requestIdentity();

  // The real corpora live outside the repository and are absent on CI, so
  // every runner invocation here points at a synthetic corpus of the same
  // layout; the refusals under test must fire regardless of corpus state.
  const corpus = syntheticCorpus();
  const dirOut = (tag: string): string => join(tmpdir(), `fr-${tag}-${Date.now()}`);

  out.write("\nB. refusals\n");
  const noKey = runRunner(["--mode", "live", "--out", dirOut("nokey"), "--corpus-root", corpus]);
  if (noKey.status === 3 && /key-file/.test(noKey.stdout + noKey.stderr)) pass("live without --key-file exits 3 before any run, before inputs or corpus are read");
  else fail(`live without --key-file: status ${noKey.status} ${noKey.stdout}${noKey.stderr}`);
  const noKeyNoCorpus = runRunner(["--mode", "live", "--out", dirOut("nokey2"), "--corpus-root", join(tmpdir(), "fr-absent-" + Date.now())]);
  if (noKeyNoCorpus.status === 3 && /key-file/.test(noKeyNoCorpus.stdout + noKeyNoCorpus.stderr)) pass("live without --key-file is refused on the key, not on a missing corpus");
  else fail(`live without --key-file, absent corpus: status ${noKeyNoCorpus.status} ${noKeyNoCorpus.stdout}${noKeyNoCorpus.stderr}`);
  const ambient = runRunner(["--mode", "mock", "--out", dirOut("ambient"), "--corpus-root", corpus, "--allow-unverified-corpus"], { ANTHROPIC_API_KEY: "sk-ant-not-a-real-key" });
  if (ambient.status === 3 && /ANTHROPIC_API_KEY is set/.test(ambient.stdout + ambient.stderr)) pass("ambient ANTHROPIC_API_KEY refused in mock mode");
  else fail(`ambient key: status ${ambient.status} ${ambient.stdout}${ambient.stderr}`);
  const over = runRunner(["--mode", "mock", "--out", dirOut("over"), "--corpus-root", corpus, "--allow-unverified-corpus", "--ceiling-usd", String(prereg.ceilingUsd + 1)]);
  if (over.status === 3 && /pre-registered/.test(over.stdout)) pass(`a ceiling above the pre-registered $${prereg.ceilingUsd} is refused`);
  else fail(`raised ceiling: status ${over.status} ${over.stdout}`);
  const unverified = runRunner(["--mode", "mock", "--out", dirOut("unverified"), "--corpus-root", corpus]);
  if (unverified.status === 3 && /blob sha/.test(unverified.stdout)) pass("a corpus that fails its blob-sha check is refused unless the rehearsal flag is given");
  else fail(`unverified corpus: status ${unverified.status} ${unverified.stdout}`);

  out.write("\nC. full dry run over a synthetic corpus\n");
  const targets = readTargets(process.cwd(), corpus);
  const planned = targets.length * prereg.runs;
  const dir = join(tmpdir(), "fr-dry-" + Date.now());
  const dry = runRunner(["--mode", "mock", "--out", dir, "--corpus-root", corpus, "--allow-unverified-corpus", "--mock-flag-parent"]);
  if (dry.status === 0) pass(`runner exited 0: ${dry.stdout.trim()}`);
  else fail(`runner status ${dry.status}: ${dry.stdout}${dry.stderr}`);
  const calls = existsSync(join(dir, "calls")) ? readdirSync(join(dir, "calls")) : [];
  const req = calls.filter((f) => f.endsWith("-request.json")).length;
  const res = calls.filter((f) => f.endsWith("-response.json")).length;
  if (req === planned && res === planned) pass(`${req} request files and ${res} response files = ${planned} planned (${targets.length} targets x ${prereg.runs} runs)`);
  else fail(`request/response files ${req}/${res}, planned ${planned}`);
  const results = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as { calls: number; summary: Record<string, unknown>; results: Array<{ verdicts: unknown[] }>; crossCheckMismatches: number };
  if (results.calls === planned && results.results.every((r) => r.verdicts.length === prereg.runs)) pass("results.json complete: every target has n verdicts");
  else fail("results.json incomplete");
  const s = results.summary;
  if (s["heldOutCaseHits"] === 10 && s["recallVerdict"] === "PASS" && s["cleanFlagCount"] === 0 && s["noiseVerdict"] === "ok") pass(`scorer registers hits: held-out 10 of 10 PASS with parent flagged, clean 0 of 30 (mock never flags clean or fix)`);
  else fail(`scorer summary unexpected: ${JSON.stringify(s)}`);
  if (results.crossCheckMismatches === 0) pass("guard cost == callClaude lastCallCost on every call");
  else fail(`cross-check mismatches: ${results.crossCheckMismatches}`);
  // Every request file names its target and holds a system prompt and tool.
  const one = JSON.parse(readFileSync(join(dir, "calls", calls.find((f) => f.endsWith("-request.json"))!), "utf8")) as { context: { target: { path: string } }; body: { system: unknown; tools: unknown[] } };
  if (one.context?.target?.path && one.body?.system && one.body?.tools) pass(`request file carries target ${basename(one.context.target.path)}, system prompt and tool`);
  else fail("request file is missing target, system or tool");

  out.write("\nD. the ceiling stops the run before it is crossed\n");
  const dir2 = join(tmpdir(), "fr-ceiling-" + Date.now());
  const noFlag = runRunner(["--mode", "mock", "--out", dir2, "--corpus-root", corpus, "--allow-unverified-corpus", "--mock-usage-multiplier", "40"]);
  const r2 = JSON.parse(readFileSync(join(dir2, "results.json"), "utf8")) as { measuredUsd: number; ceilingUsd: number; calls: number; callsPlanned: number; stop: string | null; summary: Record<string, unknown> };
  if (noFlag.status === 2 && r2.stop && r2.stop.startsWith("ceiling:")) pass(`exit 2, stop recorded: ${r2.stop.slice(0, 90)}`);
  else fail(`ceiling run: status ${noFlag.status} stop ${r2.stop}`);
  if (r2.measuredUsd <= r2.ceilingUsd) pass(`measured $${r2.measuredUsd.toFixed(4)} <= ceiling $${r2.ceilingUsd.toFixed(2)} after ${r2.calls} of ${r2.callsPlanned} calls`);
  else fail(`measured $${r2.measuredUsd} exceeds ceiling $${r2.ceilingUsd}`);
  if (r2.calls > 0 && r2.calls < r2.callsPlanned && r2.summary["recallVerdict"] === "INCOMPLETE") pass("partial results written and marked INCOMPLETE");
  else fail(`partial results: calls ${r2.calls}, verdict ${r2.summary["recallVerdict"]}`);
  const files2 = readdirSync(join(dir2, "calls"));
  if (files2.filter((f) => f.endsWith("-request.json")).length === r2.calls && files2.filter((f) => f.endsWith("-response.json")).length === r2.calls) pass("request/response files match the call count at the stop");
  else fail("request/response files do not match the call count at the stop");

  out.write(`\n${failures === 0 ? "PASS" : "FAIL"}: forced-routing rehearsal (${failures} failure(s))\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
