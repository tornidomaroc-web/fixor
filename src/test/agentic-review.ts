/**
 * Agentic change review, the harness. Pre-registration and amendment A1:
 *   docs/measurements/agentic-review-2026-10-02/
 *
 * One headless Claude Code process per repository state and run, on the
 * owner's subscription, blind: the built-in /security-review text with its
 * four git commands expanded in the prepared repository, sent on stdin, with
 * the tool set restricted to the built-in's and no network tool present.
 * Reuses the proxy judge's gates (credentials, settings, binary pin by
 * sha256, the wire check, write-as-you-go, resume).
 *
 *   node dist/test/agentic-review.js --prepared <manifest.json> --out <dir>
 *        --claude <claude.exe or cli.js> --claude-sha256 <64 hex> --expect-tools <recorded-tools.json>
 *        [--model claude-opus-5-5] [--effort high] [--runs 5] [--max-runs N]
 *        [--prompt <builtin-security-review-2.1.284.md>]
 *        [--stub <stub.js>]        rehearsal only: no model, no network, no pin
 *        [--unreviewable-chars N]  rehearsal only (with --stub): the A4 size limit
 *        [--recorder-check <repo dir>]  capture the real request (no model reached),
 *                                   compare the harness prompt with the CLI's own
 *                                   /security-review expansion, record the tool list
 *        [--score-only]
 *
 * A4: a state whose expanded prompt exceeds UNREVIEWABLE_PROMPT_CHARS is
 * recorded unreviewable for all its runs and never sent; a run the API
 * refuses for its size is recorded unreviewable and the series continues.
 * An unreviewable run has no finding. Every other failure still stops.
 *
 * Exit codes: 0 complete and scored, or a passing check; 2 stopped (model
 * mismatch, a voided run, a changed tree, an infrastructure failure, a wire
 * check failing before a later state, --max-runs); 3 refused to start.
 *
 * Nothing printed before the series is complete names a hit, a count of
 * hits or a label. Records on disk hold findings and are read only by the
 * scorer, after the last run.
 */
import { spawnSync, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";

import {
  BASH_ALLOWED, RUNS, TOOL_SET, UNREVIEWABLE_PROMPT_CHARS, auditToolCalls, bangCommands, checkNeutralRepo, estimateTokens, expandPrompt, gateA, parseFindings, parseStream, promptBody, runHit, scoreCases, scoreClean, sha256,
  type Finding, type PreparedManifest, type RunRecord, type StateKind, type ToolCall,
} from "./lib/agentic-review";
import { JUDGE_MODEL_SHAPE, WORK_ROOT_FORBIDDEN, credentialGate, scrubbedEnv, settingsGate, EFFORT_LEVELS } from "./lib/proxy-judge";
import { WIRE_TIMEOUT_MS, binaryGate, canonical, captureWire, sha256File, wireFacts, wireFingerprint, type WireFacts } from "./lib/proxy-judge-wire";

const out = process.stdout;
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
/** sha256 of the committed prompt file's body (LF, after the frontmatter). Re-pin only with an amendment. */
export const PROMPT_BODY_SHA256 = "a726e89571c15718e766ee8969edada9c9a442d7c050e2fe5f44c36e4ec919a3";
export const FORBIDDEN = ["--bare", "--fallback-model", "--dangerously-skip-permissions", "--mcp-config", "--resume", "--continue", "--append-system-prompt", "--system-prompt"];
export const RUN_TIMEOUT_MS = 30 * 60 * 1000;
const ALLOWED_TOOLS_ARG = [...BASH_ALLOWED.map((b) => `Bash(${b}:*)`), ...TOOL_SET.filter((t) => t !== "Bash")].join(",");
const DISALLOWED_TOOLS_ARG = "WebFetch,WebSearch,Write,Edit,NotebookEdit";

export function harnessArgv(model: string, effort: string): string[] {
  return ["-p", "--model", model, "--effort", effort, "--output-format", "stream-json", "--verbose", "--tools", TOOL_SET.join(","), "--allowedTools", ALLOWED_TOOLS_ARG, "--disallowedTools", DISALLOWED_TOOLS_ARG, "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence"];
}

function gitIn(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_PAGER: "cat" } });
}
function repoFacts(dir: string): Parameters<typeof checkNeutralRepo>[0] {
  const fmt = "--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%aI%x00%cI%x00%s";
  return {
    workLog: gitIn(dir, ["log", fmt, "work"]).split("\n").filter(Boolean),
    originHeadLog: gitIn(dir, ["log", fmt, "origin/HEAD"]).split("\n").filter(Boolean),
    remotes: gitIn(dir, ["remote", "-v"]).split("\n").filter(Boolean).filter((l) => l.endsWith("(fetch)")).map((l) => l.replace(/\s+\(fetch\)$/, "")),
    status: gitIn(dir, ["status", "--porcelain", "--untracked-files=all"]),
  };
}

/** Expands the built-in's four `!` commands in the repository; stdout only, as the CLI shows it. */
function expandIn(body: string, dir: string): string {
  const outputs = bangCommands(body).map((cmd) => {
    const parts = cmd.split(/\s+/);
    if (parts[0] !== "git") throw new Error(`the built-in's command is not git: ${cmd}`);
    try { return gitIn(dir, parts.slice(1)).replace(/\n$/, ""); } catch (e) { return String((e as { stdout?: string }).stdout ?? ""); }
  });
  return expandPrompt(body, outputs);
}

export interface AgenticWireExpect { model: string; maxTokens: number; effort: string; tools: string[]; prompt: string; forbidden: string[] }
export function checkAgenticWire(f: WireFacts, e: AgenticWireExpect): string[] {
  const bad: string[] = [];
  if (f.messagesPosts !== 1) { bad.push(`expected exactly one POST /v1/messages, saw ${f.messagesPosts}`); if (f.messagesPosts === 0) return bad; }
  if (f.parseError) return [...bad, `the recorded body is not JSON: ${f.parseError}`];
  if (f.model !== e.model) bad.push(`model on the wire is ${JSON.stringify(f.model)}, pinned ${e.model}`);
  if (f.maxTokens !== e.maxTokens) bad.push(`max_tokens on the wire is ${JSON.stringify(f.maxTokens)}, pinned ${e.maxTokens}`);
  if ((f.thinking as { type?: unknown } | undefined)?.type !== "adaptive") bad.push(`thinking on the wire is ${JSON.stringify(f.thinking)}, expected adaptive`);
  if ((f.outputConfig as { effort?: unknown } | undefined)?.effort !== e.effort) bad.push(`output_config on the wire is ${JSON.stringify(f.outputConfig)}, pinned effort ${e.effort}`);
  if (f.temperaturePresent) bad.push("a temperature is sent");
  if (f.apiKeyHeader) bad.push("an x-api-key header is sent: this process would bill the API");
  if (f.authClass !== "bearer-oauth") bad.push(`authorization is ${f.authClass}, expected a Bearer OAuth access token`);
  const have = [...f.toolNames].sort().join(","), want = [...e.tools].sort().join(",");
  if (have !== want) bad.push(`tools on the wire are [${have}], recorded list is [${want}]`);
  if (!f.userTexts.some((t) => t.includes(e.prompt))) bad.push("no user text block on the wire contains the expanded prompt");
  for (const s of e.forbidden) if (s && f.strings.some((x) => x.includes(s) || x.includes(s.replace(/\\/g, "/")))) bad.push(`the body names ${s}`);
  return bad;
}

async function main(): Promise<number> {
  const cred = credentialGate(process.env);
  if (cred) { out.write(`refused: ${cred}\n`); return 3; }
  const settings = settingsGate();
  if (settings.refuse) { out.write(`refused: ${settings.refuse}\n`); return 3; }
  for (const n of settings.notes) out.write(`note: ${n}\n`);
  for (const f of FORBIDDEN) if (process.argv.includes(f)) { out.write(`refused: ${f} is never passed to the judge process\n`); return 3; }

  const preparedFile = arg("--prepared"), outDir = arg("--out");
  if (!preparedFile || !outDir) { out.write("usage: agentic-review --prepared <manifest.json> --out <dir> --claude <path> --claude-sha256 <hex> --expect-tools <json> [--model M] [--effort E] [--runs 5] [--max-runs N] [--stub <js>] [--recorder-check <dir>] [--score-only]\n"); return 3; }
  const model = arg("--model") ?? "claude-opus-5-5";
  if (!JUDGE_MODEL_SHAPE.test(model)) { out.write(`refused: --model ${model} is not a full model id\n`); return 3; }
  if (/fable/.test(model)) { out.write("refused: a Fable model bills usage credits in -p mode past a threshold; excluded by the pre-registration\n"); return 3; }
  const effort = arg("--effort") ?? "high";
  if (!EFFORT_LEVELS.includes(effort)) { out.write(`refused: --effort ${effort} is not one of ${EFFORT_LEVELS.join(", ")}\n`); return 3; }
  const runs = Number(arg("--runs") ?? RUNS);
  if (!Number.isInteger(runs) || runs < 1 || runs > RUNS) { out.write(`refused: --runs must be an integer in [1, ${RUNS}]\n`); return 3; }
  const maxRuns = arg("--max-runs") !== undefined ? Number(arg("--max-runs")) : Infinity;
  if (!(maxRuns > 0)) { out.write("refused: --max-runs must be a positive integer\n"); return 3; }
  const stub = arg("--stub");
  if (arg("--unreviewable-chars") !== undefined && !stub) { out.write("refused: --unreviewable-chars is a rehearsal knob and needs --stub; the real run uses the A4 limit\n"); return 3; }
  const sizeLimit = arg("--unreviewable-chars") !== undefined ? Number(arg("--unreviewable-chars")) : UNREVIEWABLE_PROMPT_CHARS;
  if (!(sizeLimit > 0)) { out.write("refused: --unreviewable-chars must be a positive number\n"); return 3; }
  const recorderRepo = arg("--recorder-check");
  const scoreOnly = process.argv.includes("--score-only");
  const repoRoot = process.cwd();
  const inside = (c: string, p: string) => { const a = resolve(c).toLowerCase(), b = resolve(p).toLowerCase(); return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep); };

  // The prompt: the committed built-in text, pinned by the hash of its body.
  const promptFile = arg("--prompt") ?? join(repoRoot, "docs/measurements/agentic-review-2026-10-02/builtin-security-review-2.1.284.md");
  if (!existsSync(promptFile)) { out.write(`refused: prompt file ${promptFile} not found\n`); return 3; }
  const body = promptBody(readFileSync(promptFile, "utf8"));
  const bodySha = sha256(body);
  if (bodySha !== PROMPT_BODY_SHA256) { out.write(`refused: the prompt body's sha256 is ${bodySha}, pinned ${PROMPT_BODY_SHA256}; the built-in's text is not what the pre-registration committed\n`); return 3; }
  if (bangCommands(body).length !== 4) { out.write(`refused: the prompt carries ${bangCommands(body).length} git expansions, expected 4\n`); return 3; }

  // The executable.
  let cmd: string, prefix: string[] = [], binary: { path: string; sha256: string } | null = null;
  if (stub) {
    if (!isAbsolute(stub) || !existsSync(stub) || !stub.endsWith(".js")) { out.write("refused: --stub must be an absolute path to an existing .js file\n"); return 3; }
    cmd = process.execPath; prefix = [stub];
  } else {
    const given = arg("--claude");
    if (!given) { out.write("refused: --claude <path> with --claude-sha256 <64 hex> is required; there is no PATH lookup\n"); return 3; }
    if (!existsSync(given)) { out.write(`refused: --claude ${given} is not a file\n`); return 3; }
    if (/\.(cmd|bat)$/i.test(given)) { out.write(`refused: --claude ${given} is a shell shim\n`); return 3; }
    const gate = binaryGate(resolve(given), arg("--claude-sha256"));
    if (gate.refuse || !gate.sha256) { out.write(`refused: ${gate.refuse}\n`); return 3; }
    binary = { path: resolve(given), sha256: gate.sha256 };
    if (given.endsWith(".js")) { cmd = process.execPath; prefix = [binary.path]; } else cmd = binary.path;
  }
  const env = { ...scrubbedEnv(process.env, 32000), CLAUDE_CODE_SUBAGENT_MODEL: model };
  const argv = harnessArgv(model, effort);

  // The prepared manifest.
  const manifest = JSON.parse(readFileSync(preparedFile, "utf8")) as PreparedManifest;
  if (manifest.version !== 1) { out.write("refused: unknown prepared manifest version\n"); return 3; }
  if (manifest.complete !== true) { out.write("refused: the prepared manifest is partial; finish it with agentic-prepare --resume\n"); return 3; }
  if (inside(manifest.root, repoRoot) || WORK_ROOT_FORBIDDEN.test(manifest.root)) { out.write(`refused: prepared root ${manifest.root} is inside the repository or names the product, the judge or a case set\n`); return 3; }
  const forbidden = [repoRoot, resolve(preparedFile, "..")];

  mkdirSync(outDir, { recursive: true });
  const log = (line: string): void => appendFileSync(join(outDir, "harness.log"), `${new Date().toISOString()} ${line}\n`);

  // Recorder check (no model reached): the harness prompt and the CLI's own /security-review expansion, and the tool list.
  if (recorderRepo) {
    const prompt = expandIn(body, recorderRepo);
    const cap1 = await captureWire({ cmd, args: [...prefix, ...argv], env, stdin: prompt, cwd: recorderRepo });
    const f1 = wireFacts(cap1);
    const cap2 = await captureWire({ cmd, args: [...prefix, ...argv], env, stdin: "/security-review", cwd: recorderRepo });
    const f2 = wireFacts(cap2);
    const ownExpansion = f2.userTexts.find((t) => t.includes("GIT STATUS")) ?? null;
    const harnessText = f1.userTexts.find((t) => t.includes(prompt)) ?? null;
    const same = ownExpansion !== null && harnessText !== null && ownExpansion.trim() === prompt.trim();
    const rec = { at: new Date().toISOString(), binarySha256: binary?.sha256 ?? null, stub: !!stub, model, effort, tools: [...f1.toolNames].sort(), fingerprint: wireFingerprint(f1), harnessPromptReachedWire: harnessText !== null, cliExpandedSecurityReview: ownExpansion !== null, promptsEqual: same, firstDifference: same || !ownExpansion ? null : (() => { const a = prompt, b = ownExpansion; let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return { at: i, harness: a.slice(Math.max(0, i - 40), i + 80), cli: b.slice(Math.max(0, i - 40), i + 80) }; })(), maxTokens: f1.maxTokens, thinking: f1.thinking, outputConfig: f1.outputConfig, authClass: f1.authClass, apiKeyHeader: f1.apiKeyHeader, otherRequests: f1.otherRequests, promptChars: prompt.length };
    writeFileSync(join(outDir, "recorded-tools.json"), JSON.stringify(rec, null, 2));
    out.write(`recorder check: tools [${rec.tools.join(", ")}]; harness prompt on the wire ${rec.harnessPromptReachedWire}; CLI expanded /security-review ${rec.cliExpandedSecurityReview}; equal ${rec.promptsEqual}; max_tokens ${String(f1.maxTokens)}; effort ${JSON.stringify(f1.outputConfig)}; auth ${f1.authClass}; x-api-key ${f1.apiKeyHeader}\n`);
    return rec.harnessPromptReachedWire && !f1.apiKeyHeader && f1.authClass === "bearer-oauth" ? 0 : 3;
  }

  // The recorded tool list every wire check must reproduce.
  const expectFile = arg("--expect-tools");
  if (!expectFile || !existsSync(expectFile)) { out.write("refused: --expect-tools <recorded-tools.json> is required: the built-in's tool list is recorded by --recorder-check before any run\n"); return 3; }
  const expectTools = (JSON.parse(readFileSync(expectFile, "utf8")) as { tools: string[] }).tools;
  // A6: the recorded list is the one the audit enforces, or a legitimate call would void the series (or a foreign one pass).
  if ([...expectTools].sort().join(",") !== [...TOOL_SET].sort().join(",")) { out.write(`refused: the recorded tool list [${[...expectTools].sort().join(", ")}] is not the audited set [${[...TOOL_SET].sort().join(", ")}]
`); return 3; }

  // Resume state.
  const recDir = join(outDir, "runs");
  mkdirSync(recDir, { recursive: true });
  const recName = (token: string, run: number) => `${token}-r${run}.json`;
  const done = new Set(readdirSync(recDir));
  if (done.has("VOID")) { out.write("refused: this series was voided by a tool call outside the allowed set; it does not resume\n"); return 3; }
  if ([...done].some((f) => f.endsWith(".model-mismatch.json"))) { out.write("refused: a model-mismatch file exists in this series; the owner decides\n"); return 3; }
  const binaryFile = join(outDir, "binary.json");
  if (binary) {
    if (existsSync(binaryFile)) { const have = (JSON.parse(readFileSync(binaryFile, "utf8")) as { sha256?: string }).sha256; if (have !== binary.sha256) { out.write(`refused: ${binaryFile} records CLI sha256 ${String(have)}, this invocation runs ${binary.sha256}\n`); return 3; } }
    else if (done.size > 0) { out.write(`refused: ${recDir} holds runs from an unpinned CLI\n`); return 3; }
    if (!existsSync(binaryFile)) writeFileSync(binaryFile, JSON.stringify(binary));
  }

  // The state list, in the pre-registered order: states outer, runs inner.
  type State = { set: RunRecord["set"]; case: string; kind: StateKind; token: string; dir: string; originDir: string; tree: string };
  const states: State[] = [];
  for (const c of manifest.cases.filter((x) => x.accepted)) {
    if (c.states.vulnerable) states.push({ set: c.set, case: c.case, kind: "vulnerable", token: c.states.vulnerable, dir: join(manifest.root, c.states.vulnerable), originDir: join(manifest.root, c.states.vulnerable + ".origin.git"), tree: c.treeAtWork.vulnerable! });
    if (c.states.fix) states.push({ set: c.set, case: c.case, kind: "fix", token: c.states.fix, dir: join(manifest.root, c.states.fix), originDir: join(manifest.root, c.states.fix + ".origin.git"), tree: c.treeAtWork.fix! });
  }
  for (const k of manifest.clean.filter((x) => x.state)) states.push({ set: "clean", case: k.case, kind: "clean", token: k.state!, dir: join(manifest.root, k.state!), originDir: join(manifest.root, k.state! + ".origin.git"), tree: k.treeAtWork! });

  const wireLog = join(outDir, "wire-checks.jsonl"), baselineFile = join(outDir, "wire-baseline.json");
  const wireGate = async (s: State, prompt: string): Promise<string | null> => {
    const bad: string[] = [];
    if (binary) { const now = sha256File(binary.path); if (now !== binary.sha256) return `the CLI at ${binary.path} now has sha256 ${now}, pinned ${binary.sha256}`; }
    const capture = await captureWire({ cmd, args: [...prefix, ...argv], env, stdin: prompt, cwd: s.dir });
    if (capture.spawnError) bad.push(`the process did not start: ${capture.spawnError}`);
    if (capture.timedOut) bad.push(`the process was killed after ${WIRE_TIMEOUT_MS} ms`);
    const facts = wireFacts(capture);
    bad.push(...checkAgenticWire(facts, { model, maxTokens: 32000, effort, tools: expectTools, prompt, forbidden }));
    const fp = wireFingerprint(facts);
    let baseline = "not compared";
    if (bad.length === 0) {
      if (existsSync(baselineFile)) {
        const have = (JSON.parse(readFileSync(baselineFile, "utf8")) as { fingerprint: Record<string, unknown> }).fingerprint;
        const differing = [...new Set([...Object.keys(have), ...Object.keys(fp)])].filter((k) => canonical(have[k]) !== canonical(fp[k]));
        if (differing.length) { baseline = "differs"; bad.push(`the request shape differs from this directory's baseline in ${differing.join(", ")}`); } else baseline = "equal";
      } else { writeFileSync(baselineFile, JSON.stringify({ at: new Date().toISOString(), token: s.token, fingerprint: fp }, null, 2)); baseline = "written"; }
    }
    appendFileSync(wireLog, JSON.stringify({ at: new Date().toISOString(), token: s.token, ok: bad.length === 0, failures: bad, baseline, exit: capture.exit, fingerprint: fp }) + "\n");
    if (bad.length) return bad.join("; ");
    out.write(`wire check for ${s.token} (no model reached): model ${String(fp["model"])}, max_tokens ${String(fp["max_tokens"])}, effort ${effort}, tools as recorded, OAuth bearer, no x-api-key; baseline ${baseline}\n`);
    return null;
  };

  // Scoring over the records on disk; printed only when complete (or in --score-only, labelled as it stands).
  const records = (): RunRecord[] => readdirSync(recDir).filter((f) => /-r\d\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(recDir, f), "utf8")) as RunRecord & { token: string });
  const finish = (stop: string | null): number => {
    const recs = records();
    const cases = scoreCases(manifest, recs), clean = scoreClean(manifest, recs);
    const voided = recs.some((r) => r.voided) || done.has("VOID") || existsSync(join(recDir, "VOID"));
    const gate = gateA(manifest, cases, clean, voided);
    const planned = states.length * runs;
    writeFileSync(join(outDir, "results.json"), JSON.stringify({ instrument: "AGENTIC", stub: !!stub, model, effort, runs, planned, judged: recs.length, updatedAt: new Date().toISOString(), stop, gate, cases, clean, perRun: recs.map((r) => ({ set: r.set, case: r.case, state: r.state, run: r.run, voided: r.voided, unreviewable: !!r.unreviewable, findings: r.findings.length, hit: r.hit })) }, null, 2));
    // A stopped series prints its reason and no figure: nothing names a hit before the series is complete.
    const complete = gate.label !== "AGENTIC-INCOMPLETE" && !stop;
    if (complete || scoreOnly) out.write(`${stub ? "STUB/" : ""}${gate.label} | held-out hits ${gate.heldOutHits} of ${gate.heldOutAccepted} accepted; clean flags ${gate.cleanFlags}; post-cutoff hits ${gate.postCutoffHits} of ${gate.postCutoffCases}; ${gate.reason}; unreviewable runs ${gate.unreviewableRuns} (A4: no finding); clean flags with those counted as flagged ${gate.cleanFlagsIfUnreviewableFlagged}\n`);
    else out.write(`AGENTIC-INCOMPLETE | judged ${recs.length} of ${planned}${stop ? `; STOPPED (${stop})` : ""}; no figure is printed below completeness\n`);
    return stop ? 2 : 0;
  };
  if (scoreOnly) return finish(null);

  let judgedNow = 0, wireToken: string | null = null;
  const usageTotals = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, costUsd: 0, promptChars: 0 };
  for (const s of states) {
    for (let run = 1; run <= runs; run++) {
      if (done.has(recName(s.token, run))) continue;
      if (judgedNow >= maxRuns) return finish(`--max-runs ${maxRuns} reached; resumable`);
      // A1 3.6: the repository is neutral and clean before every run.
      const neutral = checkNeutralRepo(repoFacts(s.dir), s.originDir);
      if (neutral.length) { log(`STOP ${s.token}: ${neutral.join("; ")}`); return finish(`repository ${s.token} is not neutral or not clean: ${neutral.join("; ")}`); }
      const treeBefore = gitIn(s.dir, ["rev-parse", "HEAD^{tree}"]).trim();
      if (treeBefore !== s.tree) { log(`STOP ${s.token}: tree ${treeBefore} != prepared ${s.tree}`); return finish(`repository ${s.token} is not at its prepared tree`); }
      const prompt = expandIn(body, s.dir);
      // A4: a prompt over the limit is never sent; the run is recorded unreviewable, with no finding.
      if (prompt.length > sizeLimit) {
        const rec = { token: s.token, set: s.set, case: s.case, state: s.kind, run, voided: false, voidReason: null, unreviewable: `size rule: prompt ${prompt.length} chars, limit ${sizeLimit}; not sent`, sentToModel: false, findings: [], hit: false, anyFinding: false, promptChars: prompt.length, stub: !!stub, at: new Date().toISOString() };
        writeFileSync(join(recDir, recName(s.token, run)), JSON.stringify(rec, null, 2));
        done.add(recName(s.token, run));
        log(`unreviewable ${s.token} r${run}: prompt ${prompt.length} chars over ${sizeLimit}; not sent`);
        out.write(`${s.token} run ${run}: UNREVIEWABLE (A4 size rule), prompt ${prompt.length} chars ~${estimateTokens(prompt.length)} tokens; not sent\n`);
        continue;
      }
      if (wireToken !== s.token) {
        const refused = await wireGate(s, prompt);
        if (refused) { log(`${judgedNow === 0 ? "REFUSED" : "STOP"} wire check for ${s.token}: ${refused}`); if (judgedNow === 0 && done.size === 0) { out.write(`refused: wire check for ${s.token}: ${refused}. No judge run was made\n`); return 3; } return finish(`wire check for ${s.token}: ${refused}`); }
        wireToken = s.token;
      }
      const t0 = Date.now();
      const p = spawnSync(cmd, [...prefix, ...argv], { cwd: s.dir, env, input: prompt, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true, timeout: RUN_TIMEOUT_MS });
      const wallMs = Date.now() - t0;
      if (p.error) { log(`STOP ${s.token} r${run}: ${p.error.message}`); return finish(`infrastructure: ${s.token} run ${run} exited ${p.status ?? "signal"} (${p.error.message})`); }
      const parsed = parseStream(p.stdout ?? "");
      // A4: the API's refusal of a request for its size makes the run unreviewable; any other failure stops the series.
      const unreviewable = !parsed.ok && parsed.sizeRefusal ? `API size refusal: ${parsed.sizeRefusal}` : null;
      if (!unreviewable && p.status !== 0) { log(`STOP ${s.token} r${run}: exited ${p.status ?? "signal"} ${(p.stderr ?? "").trim().slice(0, 200)}`); return finish(`infrastructure: ${s.token} run ${run} exited ${p.status ?? "signal"}`); }
      if (!parsed.ok && !unreviewable) { log(`STOP ${s.token} r${run}: ${parsed.reason}`); return finish(`infrastructure: ${s.token} run ${run}: ${parsed.reason}`); }
      // After the run: the tree is unchanged and nothing was added.
      const after = repoFacts(s.dir);
      const treeAfter = gitIn(s.dir, ["rev-parse", "HEAD^{tree}"]).trim();
      if (after.status.trim() !== "" || treeAfter !== s.tree) { log(`STOP ${s.token} r${run}: tree changed`); return finish(`repository ${s.token} changed during run ${run}; no record written`); }
      const ok = parsed.ok ? parsed : null;
      const calls: ToolCall[] = ok ? ok.toolCalls : (parsed as { toolCalls?: ToolCall[] }).toolCalls ?? [];
      const mismatch = ok ? ok.models.some((m) => m !== model) : false;
      // An unreviewable run is audited too: a call made before the refusal still voids the series.
      const bad = auditToolCalls(calls, s.dir);
      const findings: Finding[] = ok ? parseFindings(ok.markdown) : [];
      const caseRec = manifest.cases.find((c) => c.set === s.set && c.case === s.case);
      const hit = s.kind === "clean" || !ok ? false : runHit(findings, caseRec?.files ?? []).hit;
      const rec = { token: s.token, set: s.set, case: s.case, state: s.kind, run, voided: bad.length > 0, voidReason: bad.length ? bad.map((b) => `${b.name}${b.command ? ` ${b.command}` : ""}${!b.command && b.paths.length ? ` ${b.paths.join(" ")}` : ""}`).join("; ") : null, unreviewable, sentToModel: true, models: ok?.models ?? [], usage: ok?.usage ?? null, numTurns: ok?.numTurns ?? null, durationMs: ok?.durationMs ?? null, wallMs, reportedCostUsd: ok?.reportedCostUsd ?? null, compactions: ok?.compactions ?? null, toolCalls: calls.length, toolCallsByName: calls.reduce<Record<string, number>>((a, c) => ((a[c.name] = (a[c.name] ?? 0) + 1), a), {}), subTaskCallsVisible: calls.some((c) => !c.parent), initTools: ok?.initTools ?? null, promptChars: prompt.length, findings, hit, anyFinding: findings.length > 0, markdownSha256: ok ? sha256(ok.markdown) : null, stub: !!stub, startedAt: new Date(t0).toISOString(), endedAt: new Date().toISOString() };
      if (ok && mismatch) { writeFileSync(join(recDir, `${s.token}-r${run}.model-mismatch.json`), JSON.stringify(rec, null, 2)); log(`STOP ${s.token} r${run}: answered by ${ok.models.join("+")}`); return finish(`model mismatch: ${s.token} run ${run} was answered by ${ok.models.join("+")}, not ${model}; run stopped`); }
      if (ok) { mkdirSync(join(outDir, "reports"), { recursive: true }); writeFileSync(join(outDir, "reports", `${s.token}-r${run}.md`), ok.markdown); }
      writeFileSync(join(recDir, recName(s.token, run)), JSON.stringify(rec, null, 2));
      done.add(recName(s.token, run));
      judgedNow++;
      usageTotals.promptChars += prompt.length;
      if (ok) {
        usageTotals.input += ok.usage.input; usageTotals.output += ok.usage.output; usageTotals.cacheWrite += ok.usage.cacheWrite; usageTotals.cacheRead += ok.usage.cacheRead; usageTotals.costUsd += ok.reportedCostUsd ?? 0;
        log(`ok ${s.token} r${run} model=${ok.models[0]} in=${ok.usage.input} out=${ok.usage.output} turns=${String(ok.numTurns)} tools=${ok.toolCalls.length} compactions=${ok.compactions} voided=${rec.voided}`);
        out.write(`${s.token} run ${run}: ${ok.models[0]}, input ${ok.usage.input} (cache write ${ok.usage.cacheWrite}, read ${ok.usage.cacheRead}), output ${ok.usage.output}, turns ${String(ok.numTurns)}, tool calls ${ok.toolCalls.length}, compactions ${ok.compactions}, prompt ~${estimateTokens(prompt.length)} tokens${rec.voided ? "; VOIDED" : ""}\n`);
      } else {
        log(`unreviewable ${s.token} r${run}: ${unreviewable} tools=${calls.length} voided=${rec.voided}`);
        out.write(`${s.token} run ${run}: UNREVIEWABLE (${unreviewable}), prompt ~${estimateTokens(prompt.length)} tokens${rec.voided ? "; VOIDED" : ""}\n`);
      }
      if (rec.voided) { writeFileSync(join(recDir, "VOID"), rec.voidReason ?? ""); log(`VOID ${rec.voidReason}`); return finish(`run voided by a tool call outside the allowed set or reaching outside the repository (${rec.voidReason}); the series is void`); }
    }
  }
  out.write(`usage this invocation: ${judgedNow} runs, input ${usageTotals.input}, cache write ${usageTotals.cacheWrite}, cache read ${usageTotals.cacheRead}, output ${usageTotals.output}, CLI list-price estimate $${usageTotals.costUsd.toFixed(2)}, prompts ~${estimateTokens(usageTotals.promptChars)} tokens\n`);
  return finish(null);
}

// process.exitCode, not process.exit: stdout to a pipe is asynchronous on Windows and the last lines would be lost.
main().then((c) => { process.exitCode = c; }, (err) => { process.stderr.write(`agentic-review refused: ${(err as Error).stack ?? String(err)}\n`); process.exitCode = 3; });
