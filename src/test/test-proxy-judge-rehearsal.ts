/**
 * Proxy-judge rehearsal (free, keyless, in test:ci). Drives
 * dist/test/proxy-judge.js with a STUB claude executable (no model, no
 * outbound network, no timing bounds: the wire check's recorder listens on
 * 127.0.0.1 and the stub is its only client) over the 70 request files a
 * mock run of the forced-routing runner writes for a synthetic corpus, and
 * proves:
 *
 *   A. Refusals: an ANTHROPIC_API_KEY, an ANTHROPIC_AUTH_TOKEN, a Bedrock
 *      switch, or a key-shaped value under any name refuses the run with
 *      exit 3 and nothing written; a work root inside the repository is
 *      refused; --bare is refused.
 *   B. Model identity: a stub reporting another model stops the run on the
 *      first call with exit 2, a model-mismatch file and no verdict file;
 *      the next invocation refuses to start while that file exists.
 *   C. Cut-off and resume: a stub that fails after 100 calls stops the run
 *      with exactly 100 verdict files; the same command resumes and
 *      finishes with no call judged twice (the stub's invocation count is
 *      planned + 1: the one failed call).
 *   D. Full five-pass dry run: 350 verdict files, results.json complete,
 *      the pre-registered scorer registers 10 of 10 held-out hits when the
 *      stub flags the parent-side marker and 0 of 30 clean flags, and the
 *      printed label is STUB/PROXY-PASS.
 *   E. Blindness, over every one of D's 350 captures: argv is byte-for-byte
 *      the fixed flag list plus the request's system prompt and schema;
 *      stdin is byte-for-byte the request's user message; the cwd is an
 *      empty directory under the work root and outside the repository, the
 *      requests and the corpus; the environment holds no credential-shaped
 *      name or value; and none of the context block's values (corpus path,
 *      set, case, side, lane, commit, blob sha, anchor line as a field),
 *      the requests directory or a forbidden flag appears anywhere in what
 *      the process received.
 *   F. A second model arm (--judge-model, --effort, --max-output-tokens):
 *      with no arm flags the argv is the 2026-09-29 run's; an alias, an
 *      unknown effort, or a second arm pointed at the shipped-model arm's
 *      directory is refused with no process started; the arm's argv
 *      carries the judge model and the effort, every process receives the
 *      pinned cap, every record and the label name the judge model beside
 *      the shipped one; the arm's directory cannot be resumed without its
 *      flags; an answer from another model stops the run on the first call.
 *      The result's maxOutputTokens field is recorded and NEVER compared:
 *      the stub reports the model's default (128000 for the Opus id) under
 *      a pinned 32000, as the real CLI does, and the run completes. Output
 *      above the pinned cap stops the run with no file written.
 *   G. The wire check (amendment A2). As a function, on a hand-built
 *      capture: a correct one passes; a wrong cap, model, thinking, effort,
 *      login, an x-api-key header, a temperature, a second tool, a changed
 *      schema, system prompt or user message, a missing or doubled request
 *      and a repository path in the body each fail with their own reason.
 *      Through the judge: one check before each pass and one on every
 *      resume; the checked process is the judge call plus ANTHROPIC_BASE_URL
 *      on 127.0.0.1 and nothing else; a wrong cap, a wrong model, an
 *      x-api-key header, a non-OAuth bearer or no request refuses the start
 *      with exit 3 and no judge process; a resume under a wrong cap or a
 *      changed request shape is refused with the verdicts on disk
 *      untouched; a wrong cap appearing before pass 2 stops the run with
 *      exactly pass 1 on disk.
 *   H. The binary pin (amendment A2). Without --stub, the judge refuses a
 *      missing --claude, a missing or wrong --claude-sha256, and a path
 *      under the updater's versions folder; with the right hash
 *      --wire-check-only passes and judges nothing; the directory then
 *      refuses another binary, and a directory of unpinned verdicts
 *      refuses a pinned run.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { readTargets } from "./lib/forced-routing";
import { FORBIDDEN_FLAGS, WORK_ROOT_FORBIDDEN, extractRequest, judgeArgv, type JudgeRequest } from "./lib/proxy-judge";
import { checkWire, sha256File, wireFacts, type WireCapture, type WireExpect } from "./lib/proxy-judge-wire";

const out = process.stdout;
let failures = 0;
const pass = (m: string): void => void out.write(`  PASS ${m}\n`);
const fail = (m: string): void => {
  failures++;
  out.write(`  FAIL ${m}\n`);
};

for (const k of Object.keys(process.env)) {
  if (/^(ANTHROPIC_|AWS_|CLAUDE_CODE_USE_|FIXOR_PARKED)/i.test(k)) delete process.env[k];
}
const REPO = process.cwd();
const RUNNER = join(REPO, "dist", "test", "forced-routing-runner.js");
const JUDGE = join(REPO, "dist", "test", "proxy-judge.js");
const STUB_SRC = join(REPO, "dist", "test", "lib", "proxy-judge-stub.js");
const MARKER = "/* UNGUARDED_ROUTE_MARKER */";

/** Same layout as the real corpora; parent-side files carry the marker the stub flags on. */
function syntheticCorpus(): string {
  const root = mkdtempSync(join(tmpdir(), "pj-corpus-"));
  const targets = readTargets(REPO, root);
  for (const t of targets) {
    mkdirSync(dirname(t.abs), { recursive: true });
    const lines: string[] = ['import { Router } from "express";', "const router = Router();"];
    while (lines.length < t.anchorLine - 1) lines.push(`// line ${lines.length + 1}`);
    lines.push(`router.get("/x/:id", async (req, res) => { ${t.side === "parent" ? MARKER + " " : ""}res.json(await db.findOne(req.params.id)); });`);
    writeFileSync(t.abs, lines.join("\n") + "\n");
  }
  return root;
}

function run(cmd: string, args: string[], env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [cmd, ...args], { encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, cwd: REPO });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

interface Stub {
  dir: string;
  script: string;
  config: (c: { reportModel?: string; failAfter?: number; flagWhen?: string; reportMaxOutput?: number; reportOutputTokens?: number; wire?: Record<string, unknown> }) => void;
  count: () => number;
  captures: () => StubCapture[];
  /** Wire checks the stub served, counted and captured apart from judge calls. */
  wireCount: () => number;
  wireCaptures: () => StubCapture[];
  reset: () => void;
}
type StubCapture = { argv: string[]; stdin: string; cwd: string; cwdEntries: string[]; env: Record<string, string> };
function makeStub(): Stub {
  const dir = mkdtempSync(join(tmpdir(), "pj-stub-"));
  const script = join(dir, "claude-stub.js");
  copyFileSync(STUB_SRC, script);
  return {
    dir,
    script,
    config: (c) => writeFileSync(join(dir, "stub-config.json"), JSON.stringify(c)),
    count: () => (existsSync(join(dir, "count.txt")) ? Number(readFileSync(join(dir, "count.txt"), "utf8")) : 0),
    captures: () => (existsSync(join(dir, "capture.jsonl")) ? readFileSync(join(dir, "capture.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []),
    wireCount: () => (existsSync(join(dir, "wire-count.txt")) ? Number(readFileSync(join(dir, "wire-count.txt"), "utf8")) : 0),
    wireCaptures: () => (existsSync(join(dir, "wire-capture.jsonl")) ? readFileSync(join(dir, "wire-capture.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []),
    reset: () => {
      for (const f of ["count.txt", "capture.jsonl", "wire-count.txt", "wire-capture.jsonl"]) rmSync(join(dir, f), { force: true });
    },
  };
}

function wireLines(dir: string): Array<{ n: number; pass: number; ok: boolean; baseline: string; failures: string[] }> {
  const p = join(dir, "wire-checks.jsonl");
  return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
}

function proxyFiles(dir: string): { verdicts: string[]; mismatches: string[] } {
  const p = join(dir, "proxy");
  const all = existsSync(p) ? readdirSync(p) : [];
  return { verdicts: all.filter((f) => /^\d{4}-p\d\.json$/.test(f)), mismatches: all.filter((f) => /model-mismatch/.test(f)) };
}

function main(): void {
  const corpus = syntheticCorpus();
  const targets = readTargets(REPO, corpus);
  const workRoot = mkdtempSync(join(tmpdir(), "pj-work-"));
  const fresh = (tag: string): string => join(tmpdir(), `pj-${tag}-${process.pid}-${Date.now()}`);

  out.write("\n0. the runner's mock mode writes the request files\n");
  const mockDir = fresh("mock");
  const mock = run(RUNNER, ["--mode", "mock", "--runs", "1", "--out", mockDir, "--corpus-root", corpus, "--allow-unverified-corpus"]);
  const reqFiles = existsSync(join(mockDir, "calls")) ? readdirSync(join(mockDir, "calls")).filter((f) => f.endsWith("-request.json")) : [];
  if (mock.status === 0 && reqFiles.length === targets.length) pass(`mock run wrote ${reqFiles.length} request files (${targets.length} targets x 1 run)`);
  else fail(`mock run: status ${mock.status}, ${reqFiles.length} request files: ${mock.stdout}${mock.stderr}`);
  const requests: JudgeRequest[] = reqFiles.sort().map((f) => extractRequest(join(mockDir, "calls", f)));
  const byN = new Map(requests.map((r) => [r.n, r]));
  const stub = makeStub();
  const judgeArgs = (outDir: string, extra: string[] = []): string[] => ["--requests", mockDir, "--out", outDir, "--work-root", workRoot, "--stub", stub.script, ...extra];

  out.write("\nA. refusals\n");
  const refusals: Array<{ name: string; env?: Record<string, string>; extra?: string[]; expect: RegExp }> = [
    { name: "ANTHROPIC_API_KEY", env: { ANTHROPIC_API_KEY: "sk-ant-not-a-real-key" }, expect: /ANTHROPIC_API_KEY is set/ },
    { name: "ANTHROPIC_AUTH_TOKEN", env: { ANTHROPIC_AUTH_TOKEN: "not-a-real-token" }, expect: /ANTHROPIC_AUTH_TOKEN is set/ },
    { name: "CLAUDE_CODE_USE_BEDROCK", env: { CLAUDE_CODE_USE_BEDROCK: "1" }, expect: /CLAUDE_CODE_USE_BEDROCK is set/ },
    { name: "a key-shaped value under another name", env: { SOME_UNRELATED_NAME: "prefix sk-ant-not-a-real-key" }, expect: /shaped like an Anthropic API key/ },
    { name: "a work root inside the repository", extra: ["--work-root", join(REPO, "tmp-judge")], expect: /inside the repository/ },
    { name: "--bare", extra: ["--bare"], expect: /--bare is never passed/ },
    { name: "a work root whose path names the product", extra: ["--work-root", join(tmpdir(), "fixor-proxy-judge")], expect: /names the product, the judge or a case set/ },
  ];
  for (const r of refusals) {
    const dir = fresh("refuse");
    const args = ["--requests", mockDir, "--out", dir, "--work-root", workRoot, "--stub", stub.script, ...(r.extra ?? [])];
    if (r.name === "a work root inside the repository" || r.name === "a work root whose path names the product") args.splice(args.indexOf("--work-root"), 2);
    const res = run(JUDGE, args, r.env);
    const wrote = existsSync(dir);
    if (res.status === 3 && r.expect.test(res.stdout + res.stderr) && !wrote && stub.count() === 0 && stub.wireCount() === 0) pass(`${r.name}: exit 3, refused before anything was written or any process started`);
    else fail(`${r.name}: status ${res.status}, out dir ${wrote ? "created" : "absent"}, stub calls ${stub.count()}, wire checks ${stub.wireCount()}: ${res.stdout}${res.stderr}`);
  }
  if (existsSync(join(REPO, "tmp-judge"))) fail("the refused work root was created inside the repository");

  out.write("\nB. a different model stops the run, unsubstituted\n");
  stub.reset();
  stub.config({ reportModel: "claude-sonnet-4-5", flagWhen: MARKER });
  const dirB = fresh("model");
  const b = run(JUDGE, judgeArgs(dirB));
  const fb = proxyFiles(dirB);
  if (b.status === 2 && /model mismatch/.test(b.stdout) && fb.mismatches.length === 1 && fb.verdicts.length === 0 && stub.count() === 1) pass(`exit 2 on the first call: ${fb.mismatches[0]} written, no verdict file, one process started`);
  else fail(`model mismatch: status ${b.status}, mismatches ${fb.mismatches.length}, verdicts ${fb.verdicts.length}, calls ${stub.count()}: ${b.stdout}${b.stderr}`);
  const mm = JSON.parse(readFileSync(join(dirB, "proxy", fb.mismatches[0] ?? "x"), "utf8")) as { modelsReported: string[]; model: string };
  if (mm.modelsReported?.[0] === "claude-sonnet-4-5" && mm.model === requests[0]!.model) pass(`the mismatch file records the answering model ${mm.modelsReported[0]} beside the shipped ${mm.model}`);
  else fail(`mismatch file content: ${JSON.stringify(mm)}`);
  const b2 = run(JUDGE, judgeArgs(dirB));
  if (b2.status === 3 && /model-mismatch file/.test(b2.stdout) && stub.count() === 1) pass("a re-invocation refuses to start while the mismatch file exists (no process started)");
  else fail(`re-invocation after mismatch: status ${b2.status}, calls ${stub.count()}: ${b2.stdout}`);

  out.write("\nC. cut-off and resume, no call judged twice\n");
  stub.reset();
  stub.config({ failAfter: 100, flagWhen: MARKER });
  const dirC = fresh("resume");
  const c1 = run(JUDGE, judgeArgs(dirC, ["--passes", "2"]));
  const fc1 = proxyFiles(dirC);
  if (c1.status === 2 && /infrastructure/.test(c1.stdout) && fc1.verdicts.length === 100 && stub.count() === 101) pass(`cut off at call 101: exit 2, exactly 100 verdict files, the interrupted call left no file`);
  else fail(`cut-off: status ${c1.status}, verdicts ${fc1.verdicts.length}, calls ${stub.count()}: ${c1.stdout}${c1.stderr}`);
  const r1 = JSON.parse(readFileSync(join(dirC, "results.json"), "utf8")) as { label: string; stop: string | null; summary: Record<string, unknown> };
  if (r1.label === "STUB/PROXY-INCOMPLETE" && r1.summary["recallVerdict"] === "INCOMPLETE" && r1.stop) pass(`partial results labelled ${r1.label} with the stop recorded`);
  else fail(`partial results: ${JSON.stringify({ label: r1.label, stop: r1.stop })}`);
  stub.config({ flagWhen: MARKER });
  const c2 = run(JUDGE, judgeArgs(dirC, ["--passes", "2"]));
  const fc2 = proxyFiles(dirC);
  const planned2 = targets.length * 2;
  if (c2.status === 0 && fc2.verdicts.length === planned2 && stub.count() === planned2 + 1) pass(`resumed to ${fc2.verdicts.length} of ${planned2}; stub invoked ${stub.count()} times = planned + the one failed call`);
  else fail(`resume: status ${c2.status}, verdicts ${fc2.verdicts.length}, calls ${stub.count()}: ${c2.stdout}${c2.stderr}`);
  // 70 + 30 calls in the first invocation: one wire check before pass 1 and one before pass 2; the resume adds one.
  const wl = wireLines(dirC);
  if (stub.wireCount() === 3 && wl.length === 3 && wl.every((l) => l.ok) && wl.map((l) => `${l.pass}:${l.n}`).join(" ") === "1:1 2:1 2:31" && wl.map((l) => l.baseline).join(" ") === "written equal equal") pass("one wire check before each pass and one on the resume, for the request about to be judged (n=1, n=1, n=31); the first wrote the baseline, the others equal it");
  else fail(`wire checks around the cut-off: stub served ${stub.wireCount()}, log ${JSON.stringify(wl.map((l) => [l.pass, l.n, l.ok, l.baseline]))}`);
  const names2 = new Set(fc2.verdicts);
  if (names2.size === fc2.verdicts.length && [...names2].every((f) => /^\d{4}-p[12]\.json$/.test(f))) pass("every (request, pass) pair has exactly one verdict file");
  else fail("duplicate or out-of-range verdict files after resume");
  const r2 = JSON.parse(readFileSync(join(dirC, "results.json"), "utf8")) as { judgedTotal: number; judgedThisInvocation: number; label: string };
  if (r2.judgedTotal === planned2 && r2.judgedThisInvocation === planned2 - 100) pass(`results.json: judged ${r2.judgedTotal} in all, ${r2.judgedThisInvocation} by the resuming invocation`);
  else fail(`results.json after resume: ${JSON.stringify(r2)}`);
  // A COMPLETE run of fewer than five passes applies no pre-registered label.
  if (r2.label === "STUB/PROXY-PRELIMINARY" && /^STUB\/PROXY-PRELIMINARY \|/m.test(c2.stdout) && !/PROXY-(PASS|FAIL|INCONCLUSIVE)/.test(c2.stdout)) pass("a complete two-pass run is labelled PROXY-PRELIMINARY; no PASS, FAIL or INCONCLUSIVE is printed below five passes");
  else fail(`label below five passes: ${r2.label}; stdout ${c2.stdout.split("\n").find((l) => /PROXY/.test(l))}`);

  out.write("\nD. full five-pass dry run\n");
  stub.reset();
  stub.config({ flagWhen: MARKER });
  const dirD = fresh("dry");
  const d = run(JUDGE, judgeArgs(dirD));
  const fd = proxyFiles(dirD);
  const planned = targets.length * 5;
  if (d.status === 0 && fd.verdicts.length === planned && fd.mismatches.length === 0 && stub.count() === planned) pass(`exit 0: ${fd.verdicts.length} verdict files = ${targets.length} x 5, ${stub.count()} processes`);
  else fail(`dry run: status ${d.status}, verdicts ${fd.verdicts.length}, calls ${stub.count()}: ${d.stdout}${d.stderr}`);
  const rd = JSON.parse(readFileSync(join(dirD, "results.json"), "utf8")) as { label: string; stub: boolean; summary: Record<string, unknown>; results: Array<{ verdicts: unknown[] }>; modelsSeenThisInvocation: Record<string, number>; volumePerPass: { totalChars: number; estimatedTokens: number } };
  if (rd.results.every((r) => r.verdicts.length === 5) && rd.summary["complete"] === true) pass("results.json complete: every request has 5 verdicts");
  else fail("results.json incomplete");
  const s = rd.summary;
  if (s["heldOutCaseHits"] === 10 && s["recallVerdict"] === "PASS" && s["cleanFlagCount"] === 0 && s["noiseVerdict"] === "ok") pass("scorer registers hits: held-out 10 of 10 PASS on the parent marker, clean 0 of 30 ok");
  else fail(`scorer summary unexpected: ${JSON.stringify(s)}`);
  if (rd.label === "STUB/PROXY-PASS" && rd.stub === true && /^STUB\/PROXY-PASS \|/m.test(d.stdout)) pass(`label ${rd.label} in results.json and on stdout, marked STUB`);
  else fail(`label: ${rd.label}, stub ${rd.stub}, stdout ${d.stdout.split("\n").find((l) => /PROXY/.test(l))}`);
  const shipped = requests[0]!.model;
  if (Object.keys(rd.modelsSeenThisInvocation).length === 1 && rd.modelsSeenThisInvocation[shipped] === planned) pass(`every call records the answering model: ${shipped} on ${planned}`);
  else fail(`models seen: ${JSON.stringify(rd.modelsSeenThisInvocation)}`);
  const volLine = d.stdout.split("\n").find((l) => l.startsWith("volume per pass:"));
  if (volLine && rd.volumePerPass.totalChars > 0) pass(volLine);
  else fail("no volume line");
  const wireD = stub.wireCaptures();
  if (stub.wireCount() === 5 && wireLines(dirD).length === 5 && wireLines(dirD).every((l) => l.ok && l.n === 1)) pass("five passes, five wire checks, each before the pass's first call");
  else fail(`wire checks in the dry run: ${stub.wireCount()} served, ${wireLines(dirD).length} logged`);
  const one = JSON.parse(readFileSync(join(dirD, "proxy", fd.verdicts[0]!), "utf8")) as { modelsReported: string[]; verdict: unknown; usage: { input: number }; target: { side: string } };
  if (one.modelsReported.length === 1 && one.verdict !== undefined && one.usage.input > 0) pass(`a verdict file carries the answering model, the usage and the parsed verdict`);
  else fail(`verdict file shape: ${JSON.stringify(one).slice(0, 200)}`);

  out.write("\nE. blindness: what the process received is a function of (system, user, schema) and nothing else\n");
  const caps = stub.captures();
  if (caps.length !== planned) fail(`captured ${caps.length} invocations, expected ${planned}`);
  const rawByN = new Map<number, string>();
  for (const f of reqFiles) {
    const raw = JSON.parse(readFileSync(join(mockDir, "calls", f), "utf8")) as { n: number; context: { target: Record<string, unknown> } };
    rawByN.set(raw.n, JSON.stringify(raw.context));
  }
  // PATH is passed through (the executable must be found) and under `npm run`
  // it carries node_modules/.bin under the repository, so path strings are
  // checked against every env value EXCEPT PATH; PATH is still checked for
  // credential shapes below.
  const forbiddenStrings = [resolve(corpus), resolve(mockDir), REPO, "known-answer", "arm-a-05-supplement", "held-out", "arm-a-diagnostic", ...FORBIDDEN_FLAGS];
  const seenLanes = new Set<string>();
  const e = { argv: 0, stdin: 0, cwd: 0, env: 0, leak: 0 };
  const cwdSeen = new Set<string>();
  caps.forEach((cap, i) => {
    const n = (i % targets.length) + 1;
    const req = byN.get(n)!;
    const raw = rawByN.get(n)!;
    if (JSON.stringify(cap.argv) !== JSON.stringify(judgeArgv(req))) e.argv++;
    if (cap.stdin !== req.user) e.stdin++;
    const cwd = resolve(cap.cwd);
    if (!cwd.startsWith(workRoot) || cwd.startsWith(REPO) || cwd.startsWith(resolve(mockDir)) || cwd.startsWith(resolve(corpus)) || cap.cwdEntries.length !== 0 || cwdSeen.has(cwd) || WORK_ROOT_FORBIDDEN.test(cwd)) e.cwd++;
    cwdSeen.add(cwd);
    for (const [k, v] of Object.entries(cap.env)) {
      if (/^(ANTHROPIC_|AWS_|CLAUDE_CODE_USE_|FIXOR_)/i.test(k) || /sk-ant-/.test(v)) e.env++;
    }
    const envValues = Object.entries(cap.env).filter(([k]) => k.toUpperCase() !== "PATH").map(([, v]) => v);
    const everything = cap.argv.join("\u0000") + "\u0000" + cap.stdin + "\u0000" + cap.cwd + "\u0000" + envValues.join("\u0000");
    for (const s of forbiddenStrings) if (everything.includes(s)) e.leak++;
    // The context block itself, and each of its scoring values as a labelled field.
    if (everything.includes(raw)) e.leak++;
    const tgt = JSON.parse(raw).target as Record<string, unknown>;
    // Bare values that cannot occur by accident: the commit and the blob sha (40 hex).
    for (const k of ["commit", "blobSha"]) {
      const v = String(tgt[k] ?? "");
      if (!/^[0-9a-f]{40}$/.test(v)) e.leak++;
      else if (everything.includes(v)) e.leak++;
    }
    for (const [k, v] of Object.entries(tgt)) {
      if (k === "path") continue; // the file path is part of the shipped user message by design
      if (everything.includes(`"${k}":${JSON.stringify(v)}`) || everything.includes(`"${k}": ${JSON.stringify(v)}`) || everything.includes(`${k}: ${String(v)}`)) e.leak++;
    }
    seenLanes.add(req.system.slice(0, 80));
  });
  if (e.argv === 0) pass(`argv is byte-for-byte judgeArgv(model, system, schema) on all ${caps.length} calls; ${seenLanes.size} distinct shipped system prompts`);
  else fail(`argv differed on ${e.argv} calls`);
  if (e.stdin === 0) pass("stdin is byte-for-byte the request's user message on every call");
  else fail(`stdin differed on ${e.stdin} calls`);
  if (e.cwd === 0) pass("every cwd is a fresh, empty directory under the work root, outside the repository, the requests and the corpus, and names neither the product, the judge nor a case set");
  else fail(`cwd violated on ${e.cwd} calls`);
  if (e.env === 0) pass("the environment carries no credential-shaped name or value");
  else fail(`environment carried credential-shaped entries on ${e.env} calls`);
  if (e.leak === 0) pass("no context-block field as a labelled field, no bare commit or blob sha, no set label, corpus path, requests path, repository path or forbidden flag reached argv, stdin, cwd or env");
  else fail(`${e.leak} leak(s) of context, label or path`);
  // Sanity: the marker the stub flags on IS in the parent-side stdin and NOT in the others.
  const markerOk = caps.every((cap, i) => cap.stdin.includes(MARKER) === (byN.get((i % targets.length) + 1)!.target.side === "parent"));
  if (markerOk) pass("the stub's only signal is the parent-side marker inside the shipped file content");
  else fail("marker/side correspondence broken");
  // Nothing was written into the repository or the requests directory.
  const reqAfter = readdirSync(join(mockDir, "calls")).length;
  if (reqAfter === reqFiles.length * 2 && !existsSync(join(REPO, "proxy"))) pass("the judge wrote nothing into the requests directory or the repository");
  else fail(`requests dir now has ${reqAfter} files (was ${reqFiles.length * 2})`);
  if (readdirSync(workRoot).length === 0) pass("every per-call working directory was removed");
  else fail(`work root still holds ${readdirSync(workRoot).length} entries`);

  out.write("\nF. a second model arm: its own model, effort and output cap, its own directory, its own label\n");
  const JM = "claude-opus-5-5";
  const armFlags = ["--judge-model", JM, "--effort", "high", "--max-output-tokens", "32000"];
  const armArgv = (r: JudgeRequest): string[] => judgeArgv(r, { judgeModel: JM, effort: "high", maxOutputTokens: 32000 });
  // The shipped-model arm's argv is unchanged by the second-arm code: no --effort, the request's model.
  const plain = judgeArgv(requests[0]!);
  if (!plain.includes("--effort") && plain[plain.indexOf("--model") + 1] === requests[0]!.model) pass("with no arm flags the argv carries the request's model and no --effort, as in the 2026-09-29 run");
  else fail(`shipped-arm argv changed: ${JSON.stringify(plain.slice(0, 12))}`);
  const armRefusals: Array<{ name: string; outDir: string; extra: string[]; expect: RegExp }> = [
    { name: "a second arm into the shipped-model arm's directory", outDir: dirD, extra: armFlags, expect: /from the shipped-model arm \(no arm\.json\)/ },
    { name: "an alias as --judge-model", outDir: fresh("arm-alias"), extra: ["--judge-model", "opus"], expect: /not a full model id/ },
    { name: "an unknown --effort", outDir: fresh("arm-effort"), extra: ["--judge-model", JM, "--effort", "extreme"], expect: /--effort extreme is not one of/ },
  ];
  stub.reset();
  stub.config({ flagWhen: MARKER });
  const dVerdictsBefore = proxyFiles(dirD).verdicts.length;
  for (const r of armRefusals) {
    const res = run(JUDGE, judgeArgs(r.outDir, r.extra));
    if (res.status === 3 && r.expect.test(res.stdout) && stub.count() === 0) pass(`${r.name}: exit 3, no process started`);
    else fail(`${r.name}: status ${res.status}, calls ${stub.count()}: ${res.stdout}${res.stderr}`);
  }
  if (!existsSync(join(dirD, "arm.json")) && proxyFiles(dirD).verdicts.length === dVerdictsBefore) pass("the shipped-model arm's directory was left untouched");
  else fail("the refused second arm wrote into the shipped-model arm's directory");
  const dirF = fresh("arm");
  const f1 = run(JUDGE, judgeArgs(dirF, [...armFlags, "--passes", "1"]));
  const ff = proxyFiles(dirF);
  const capsF = stub.captures();
  const argvOk = capsF.length === targets.length && capsF.every((cap, i) => JSON.stringify(cap.argv) === JSON.stringify(armArgv(byN.get(i + 1)!)));
  if (f1.status === 0 && ff.verdicts.length === targets.length && argvOk) pass(`${targets.length} calls, each argv byte-for-byte judgeArgv with --model ${JM} and --effort high`);
  else fail(`second arm: status ${f1.status}, verdicts ${ff.verdicts.length}, captures ${capsF.length}, argv ok ${argvOk}: ${f1.stdout}${f1.stderr}`);
  if (capsF.every((cap) => cap.env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] === "32000")) pass("every process received CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000");
  else fail("the pinned output cap did not reach every process");
  const rf = JSON.parse(readFileSync(join(dirF, "results.json"), "utf8")) as { label: string; arm?: Record<string, unknown>; modelsSeenThisInvocation: Record<string, number> };
  const recF = JSON.parse(readFileSync(join(dirF, "proxy", ff.verdicts[0] ?? "x"), "utf8")) as { model: string; shippedModel?: string; maxOutputTokensReported?: number; maxOutputTokensPinned?: number; effort?: string; numTurns?: number };
  if (rf.label.startsWith(`STUB/PROXY-PRELIMINARY [judge ${JM}, not the shipped ${requests[0]!.model}]`) && rf.arm?.["judgeModel"] === JM && rf.modelsSeenThisInvocation[JM] === targets.length) pass(`labelled ${rf.label}`);
  else fail(`second-arm label or arm record: ${JSON.stringify({ label: rf.label, arm: rf.arm, seen: rf.modelsSeenThisInvocation })}`);
  if (recF.model === JM && recF.shippedModel === requests[0]!.model && recF.maxOutputTokensPinned === 32000 && recF.effort === "high" && recF.numTurns === 1) pass("each verdict file records the judge model, the shipped model, the effort, the pinned cap and the turn count");
  else fail(`second-arm record: ${JSON.stringify(recF)}`);
  // The condition that stopped the real run on 2026-10-02: the result reports the model's default cap, not the pinned one.
  if (f1.status === 0 && recF.maxOutputTokensReported === 128000 && !/instrument mismatch/.test(f1.stdout)) pass("a result reporting maxOutputTokens 128000 under a pinned 32000 is recorded and not compared: the pass completes");
  else fail(`reported-cap field: status ${f1.status}, reported ${String(recF.maxOutputTokensReported)}: ${f1.stdout.split("\n").find((l) => /PROXY/.test(l))}`);
  stub.reset();
  const f2 = run(JUDGE, judgeArgs(dirF, ["--passes", "1"]));
  if (f2.status === 3 && /records arm/.test(f2.stdout) && stub.count() === 0) pass("resuming the second arm's directory without its flags is refused");
  else fail(`resume without arm flags: status ${f2.status}, calls ${stub.count()}: ${f2.stdout}`);
  stub.reset();
  stub.config({ reportModel: requests[0]!.model, flagWhen: MARKER });
  const dirF3 = fresh("arm-model");
  const f3 = run(JUDGE, judgeArgs(dirF3, armFlags));
  if (f3.status === 2 && /model mismatch/.test(f3.stdout) && proxyFiles(dirF3).verdicts.length === 0 && stub.count() === 1) pass(`an answer from the shipped ${requests[0]!.model} stops the ${JM} arm on the first call`);
  else fail(`second-arm model mismatch: status ${f3.status}, calls ${stub.count()}: ${f3.stdout}`);
  stub.reset();
  stub.config({ reportOutputTokens: 32001, flagWhen: MARKER });
  const dirF4 = fresh("arm-cap");
  const f4 = run(JUDGE, judgeArgs(dirF4, armFlags));
  const ff4 = proxyFiles(dirF4);
  if (f4.status === 2 && /instrument mismatch: call n=1 pass 1 reported 32001 output tokens/.test(f4.stdout) && ff4.verdicts.length === 0 && ff4.mismatches.length === 0 && stub.count() === 1) pass("a result reporting more output than the pinned cap stops the run on the first call and writes no file");
  else fail(`output above the cap: status ${f4.status}, verdicts ${ff4.verdicts.length}, calls ${stub.count()}: ${f4.stdout}`);
  stub.reset();
  stub.config({ reportOutputTokens: 32000, flagWhen: MARKER });
  const f5 = run(JUDGE, judgeArgs(fresh("arm-cap-at"), [...armFlags, "--passes", "1", "--max-calls", "1"]));
  if (f5.status === 2 && /--max-calls 1 reached/.test(f5.stdout) && !/instrument mismatch/.test(f5.stdout) && stub.count() === 1) pass("output exactly at the pinned cap is accepted");
  else fail(`output at the cap: status ${f5.status}: ${f5.stdout}`);

  out.write("\nG. the wire check: the request is read, not the result's cap field\n");
  // G1. As a function, on a capture built by hand in the shape the real CLI was seen to send.
  const r0 = requests[0]!;
  const expect: WireExpect = { model: JM, maxTokens: 32000, effort: "high", system: r0.system, user: r0.user, schema: r0.schema, forbidden: [REPO, resolve(mockDir)] };
  const goodBody = (): Record<string, unknown> => ({
    model: JM,
    max_tokens: 32000,
    stream: true,
    thinking: { type: "adaptive", display: "omitted" },
    output_config: { effort: "high" },
    system: [{ type: "text", text: "identity" }, { type: "text", text: r0.system }],
    messages: [{ role: "user", content: [{ type: "text", text: "reminder" }, { type: "text", text: r0.user }] }, { role: "system", content: [{ type: "text", text: "environment" }] }],
    tools: [{ name: "StructuredOutput", input_schema: JSON.parse(JSON.stringify(r0.schema)) as unknown }],
  });
  const post = (body: Record<string, unknown>, over: Partial<WireCapture["requests"][number]> = {}): WireCapture["requests"][number] => ({ method: "POST", path: "/v1/messages?beta=true", headerNames: ["authorization"], authClass: "bearer-oauth", apiKeyHeader: false, betaHeader: "a,b", versionHeader: "2023-06-01", body: JSON.stringify(body), ...over });
  const hello: WireCapture["requests"][number] = { method: "HEAD", path: "/api/hello", headerNames: [], authClass: "absent", apiKeyHeader: false, betaHeader: null, versionHeader: null, body: "" };
  const verdictOf = (reqs: WireCapture["requests"]): string[] => checkWire(wireFacts({ requests: reqs, exit: 1, timedOut: false, spawnError: null }), expect);
  const okv = verdictOf([hello, post(goodBody())]);
  if (okv.length === 0) pass("a correct capture passes: pinned model, max_tokens 32000, adaptive thinking, effort high, OAuth bearer, no x-api-key, the request's own content");
  else fail(`a correct capture was refused: ${okv.join("; ")}`);
  const wrong: Array<{ name: string; reqs: WireCapture["requests"]; expect: RegExp }> = [
    { name: "a wrong cap (128000)", reqs: [post({ ...goodBody(), max_tokens: 128000 })], expect: /^max_tokens on the wire is 128000, pinned 32000$/ },
    { name: "a wrong model", reqs: [post({ ...goodBody(), model: r0.model })], expect: /^model on the wire is / },
    { name: "an x-api-key header", reqs: [post(goodBody(), { apiKeyHeader: true })], expect: /^an x-api-key header is sent/ },
    { name: "an x-api-key header on another request of the process", reqs: [{ ...hello, apiKeyHeader: true }, post(goodBody())], expect: /^an x-api-key header is sent/ },
    { name: "a bearer that is not an OAuth access token", reqs: [post(goodBody(), { authClass: "bearer-other" })], expect: /^authorization is bearer-other/ },
    { name: "no authorization", reqs: [post(goodBody(), { authClass: "absent" })], expect: /^authorization is absent/ },
    { name: "thinking that is not adaptive", reqs: [post({ ...goodBody(), thinking: { type: "enabled", budget_tokens: 31999 } })], expect: /^thinking on the wire is / },
    { name: "no thinking", reqs: [post({ ...goodBody(), thinking: undefined })], expect: /^thinking on the wire is undefined/ },
    { name: "another effort", reqs: [post({ ...goodBody(), output_config: { effort: "medium" } })], expect: /^output_config on the wire is / },
    { name: "a temperature", reqs: [post({ ...goodBody(), temperature: 0 })], expect: /^a temperature is sent/ },
    { name: "a second tool", reqs: [post({ ...goodBody(), tools: [...(goodBody()["tools"] as unknown[]), { name: "Bash", input_schema: {} }] })], expect: /^tools on the wire are \[StructuredOutput, Bash\]/ },
    { name: "a changed schema", reqs: [post({ ...goodBody(), tools: [{ name: "StructuredOutput", input_schema: { type: "object" } }] })], expect: /^the tool's input schema on the wire is not the request's schema$/ },
    { name: "a changed system prompt", reqs: [post({ ...goodBody(), system: [{ type: "text", text: r0.system + " " }] })], expect: /^no system block on the wire equals/ },
    { name: "a changed user message", reqs: [post({ ...goodBody(), messages: [{ role: "user", content: [{ type: "text", text: r0.user.slice(1) }] }] })], expect: /^no user text block on the wire equals/ },
    { name: "two messages requests", reqs: [post(goodBody()), post(goodBody())], expect: /^expected exactly one POST \/v1\/messages, saw 2/ },
    { name: "no messages request", reqs: [hello], expect: /^expected exactly one POST \/v1\/messages, saw 0 \(other requests: HEAD \/api\/hello\)$/ },
    { name: "the repository path in the body", reqs: [post({ ...goodBody(), metadata: { cwd: REPO.replace(/\\/g, "/") } })], expect: /^the body names / },
  ];
  for (const w of wrong) {
    const v = verdictOf(w.reqs);
    if (v.length === 1 && w.expect.test(v[0]!)) pass(`${w.name} fails, for that reason alone`);
    else fail(`${w.name}: ${JSON.stringify(v)}`);
  }

  // G2. The checked process is the judge call plus ANTHROPIC_BASE_URL on loopback, nothing else (D's five checks).
  const judgeEnvKeys = JSON.stringify(Object.keys(caps[0]?.env ?? {}).sort());
  const sameProcess = wireD.length === 5 && wireD.every((cap) => {
    const extra = Object.keys(cap.env).filter((k) => !(k in (caps[0]?.env ?? {})));
    const rest = Object.keys(cap.env).filter((k) => k !== "ANTHROPIC_BASE_URL").sort();
    return JSON.stringify(cap.argv) === JSON.stringify(judgeArgv(r0)) && cap.stdin === r0.user && extra.length === 1 && extra[0] === "ANTHROPIC_BASE_URL" && /^http:\/\/127\.0\.0\.1:\d+$/.test(cap.env["ANTHROPIC_BASE_URL"] ?? "") && JSON.stringify(rest) === judgeEnvKeys && resolve(cap.cwd).startsWith(workRoot) && cap.cwdEntries.length === 0;
  });
  if (sameProcess) pass("the checked process has the judge call's argv, stdin, environment and a fresh empty cwd, plus ANTHROPIC_BASE_URL on 127.0.0.1 and nothing else");
  else fail("the wire-check process differs from the judge call by more than ANTHROPIC_BASE_URL");
  if (caps.every((cap) => !("ANTHROPIC_BASE_URL" in cap.env))) pass("no judge call carries ANTHROPIC_BASE_URL");
  else fail("a judge call was started with ANTHROPIC_BASE_URL");

  // G3. Through the judge: a wrong request refuses the start, before any judge process.
  const wireRefusals: Array<{ name: string; wire: Record<string, unknown>; extra: string[]; expect: RegExp }> = [
    { name: "a wrong cap on the wire", wire: { maxTokens: 128000 }, extra: armFlags, expect: /wire check before pass 1 \(request n=1\): max_tokens on the wire is 128000, pinned 32000/ },
    { name: "a wrong model on the wire", wire: { model: r0.model }, extra: armFlags, expect: /wire check before pass 1 \(request n=1\): model on the wire is / },
    { name: "an x-api-key header on the wire", wire: { apiKeyHeader: true }, extra: armFlags, expect: /an x-api-key header is sent/ },
    { name: "a bearer that is not an OAuth access token", wire: { auth: "Bearer not-the-subscription-login" }, extra: armFlags, expect: /authorization is bearer-other/ },
    { name: "thinking that is not adaptive", wire: { thinkingType: "enabled" }, extra: armFlags, expect: /thinking on the wire is / },
    { name: "another effort on the wire", wire: { effort: "medium" }, extra: armFlags, expect: /output_config on the wire is / },
    { name: "a process that sends no request", wire: { noPost: true }, extra: armFlags, expect: /expected exactly one POST \/v1\/messages, saw 0/ },
    { name: "the shipped-model arm under another cap than its recorded 32000", wire: { maxTokens: 128000 }, extra: [], expect: /max_tokens on the wire is 128000, pinned 32000/ },
  ];
  for (const w of wireRefusals) {
    stub.reset();
    stub.config({ flagWhen: MARKER, wire: w.wire });
    const dir = fresh("wire-refuse");
    const res = run(JUDGE, judgeArgs(dir, w.extra));
    const lines = wireLines(dir);
    if (res.status === 3 && w.expect.test(res.stdout) && /No judge call was made/.test(res.stdout) && stub.count() === 0 && stub.wireCount() === 1 && proxyFiles(dir).verdicts.length === 0 && !existsSync(join(dir, "results.json")) && !existsSync(join(dir, "wire-baseline.json")) && lines.length === 1 && lines[0]!.ok === false) pass(`${w.name}: exit 3, one wire check, no judge process, no verdict, no baseline`);
    else fail(`${w.name}: status ${res.status}, judge calls ${stub.count()}, wire checks ${stub.wireCount()}: ${res.stdout}${res.stderr}`);
  }

  // G4. Every resume is checked: a wrong cap, then a changed shape, each refused with the verdicts untouched.
  stub.reset();
  stub.config({ flagWhen: MARKER });
  const dirG = fresh("wire-resume");
  const g1 = run(JUDGE, judgeArgs(dirG, [...armFlags, "--passes", "1", "--max-calls", "10"]));
  if (g1.status === 2 && proxyFiles(dirG).verdicts.length === 10 && stub.wireCount() === 1) pass("ten calls judged after one passing wire check");
  else fail(`wire resume setup: status ${g1.status}, verdicts ${proxyFiles(dirG).verdicts.length}: ${g1.stdout}`);
  stub.config({ flagWhen: MARKER, wire: { maxTokens: 64000 } });
  const g2 = run(JUDGE, judgeArgs(dirG, [...armFlags, "--passes", "1"]));
  if (g2.status === 3 && /wire check before pass 1 \(request n=11\): max_tokens on the wire is 64000, pinned 32000/.test(g2.stdout) && proxyFiles(dirG).verdicts.length === 10 && stub.count() === 10) pass("a resume under another cap is refused at request n=11: exit 3, the ten verdicts untouched, no judge process");
  else fail(`resume under a wrong cap: status ${g2.status}, verdicts ${proxyFiles(dirG).verdicts.length}, calls ${stub.count()}: ${g2.stdout}`);
  stub.config({ flagWhen: MARKER, wire: { extraBeta: "another-beta" } });
  const g3 = run(JUDGE, judgeArgs(dirG, [...armFlags, "--passes", "1"]));
  if (g3.status === 3 && /the request shape differs from this directory's baseline in betas/.test(g3.stdout) && proxyFiles(dirG).verdicts.length === 10 && stub.count() === 10) pass("a resume whose request carries another beta flag is refused against the baseline, though every pinned value is right");
  else fail(`resume under a changed shape: status ${g3.status}, calls ${stub.count()}: ${g3.stdout}`);
  stub.config({ flagWhen: MARKER });
  const g4 = run(JUDGE, judgeArgs(dirG, [...armFlags, "--passes", "1"]));
  if (g4.status === 0 && proxyFiles(dirG).verdicts.length === targets.length && stub.count() === targets.length) pass(`with the request restored the same command resumes to ${targets.length} of ${targets.length}, no call judged twice`);
  else fail(`resume after the refusals: status ${g4.status}, verdicts ${proxyFiles(dirG).verdicts.length}, calls ${stub.count()}: ${g4.stdout}`);

  // G5. Every pass is checked: the cap goes wrong before pass 2, and pass 2 never starts.
  stub.reset();
  stub.config({ flagWhen: MARKER, wire: { fromCount: 2, maxTokens: 64000 } });
  const dirG5 = fresh("wire-pass");
  const g5 = run(JUDGE, judgeArgs(dirG5, [...armFlags, "--passes", "2"]));
  const fg5 = proxyFiles(dirG5);
  if (g5.status === 2 && /STOPPED \(wire check before pass 2 \(request n=1\): max_tokens on the wire is 64000, pinned 32000; no call of that pass was made/.test(g5.stdout) && fg5.verdicts.length === targets.length && fg5.verdicts.every((f) => /-p1\.json$/.test(f)) && stub.count() === targets.length) pass(`a wrong cap before pass 2 stops the run: exit 2, exactly the ${targets.length} pass-1 verdicts, no pass-2 process`);
  else fail(`wire check before pass 2: status ${g5.status}, verdicts ${fg5.verdicts.length}, calls ${stub.count()}: ${g5.stdout}`);

  out.write("\nH. the binary pin: by sha256, at a path the updater does not manage\n");
  const realArgs = (outDir: string, extra: string[]): string[] => ["--requests", mockDir, "--out", outDir, "--work-root", workRoot, ...armFlags, ...extra];
  const stubSha = sha256File(stub.script);
  const versionsDir = join(mkdtempSync(join(tmpdir(), "pj-upd-")), "claude", "versions", "9.9.9");
  mkdirSync(versionsDir, { recursive: true });
  const underVersions = join(versionsDir, "cli.js");
  copyFileSync(stub.script, underVersions);
  const pinRefusals: Array<{ name: string; extra: string[]; expect: RegExp }> = [
    { name: "no --claude and no --stub (no PATH lookup)", extra: [], expect: /--claude <path> with --claude-sha256 <64 hex> is required/ },
    { name: "--claude without --claude-sha256", extra: ["--claude", stub.script], expect: /--claude-sha256 <64 hex> is required/ },
    { name: "a hash that is not the file's", extra: ["--claude", stub.script, "--claude-sha256", "0".repeat(64)], expect: new RegExp(`has sha256 ${stubSha}, not the pinned 0{64}`) },
    { name: "a truncated hash", extra: ["--claude", stub.script, "--claude-sha256", stubSha.slice(0, 16)], expect: /is not 64 lower-case hex characters/ },
    { name: "a path under the updater's versions folder, right hash", extra: ["--claude", underVersions, "--claude-sha256", stubSha], expect: /is under the CLI updater's control/ },
  ];
  stub.reset();
  stub.config({ flagWhen: MARKER });
  for (const r of pinRefusals) {
    const dir = fresh("pin-refuse");
    const res = run(JUDGE, realArgs(dir, r.extra));
    if (res.status === 3 && r.expect.test(res.stdout) && !existsSync(dir) && stub.count() === 0 && stub.wireCount() === 0) pass(`${r.name}: exit 3, nothing written, no process started`);
    else fail(`${r.name}: status ${res.status}, out dir ${existsSync(dir) ? "created" : "absent"}: ${res.stdout}${res.stderr}`);
  }
  const dirH = fresh("pin");
  const h1 = run(JUDGE, realArgs(dirH, ["--claude", stub.script, "--claude-sha256", stubSha, "--wire-check-only"]));
  const binH = existsSync(join(dirH, "binary.json")) ? (JSON.parse(readFileSync(join(dirH, "binary.json"), "utf8")) as { sha256: string }) : null;
  if (h1.status === 0 && /wire check only: passed; no judge call was made/.test(h1.stdout) && binH?.sha256 === stubSha && stub.wireCount() === 1 && stub.count() === 0 && proxyFiles(dirH).verdicts.length === 0 && !existsSync(join(dirH, "results.json"))) pass("the right hash at a stable path: --wire-check-only passes, records the binary, judges nothing");
  else fail(`pinned wire check only: status ${h1.status}, wire ${stub.wireCount()}, calls ${stub.count()}: ${h1.stdout}${h1.stderr}`);
  const otherDir = mkdtempSync(join(tmpdir(), "pj-stub2-"));
  const otherStub = join(otherDir, "claude-stub.js");
  writeFileSync(otherStub, readFileSync(stub.script, "utf8") + "\n// another build\n");
  const h2 = run(JUDGE, realArgs(dirH, ["--claude", otherStub, "--claude-sha256", sha256File(otherStub), "--wire-check-only"]));
  if (h2.status === 3 && /one output directory holds one binary/.test(h2.stdout) && stub.wireCount() === 1 && !existsSync(join(otherDir, "wire-count.txt"))) pass("another binary, correctly hashed, is refused in a directory that recorded the first");
  else fail(`second binary in the same directory: status ${h2.status}: ${h2.stdout}${h2.stderr}`);
  const h3 = run(JUDGE, ["--requests", mockDir, "--out", dirD, "--work-root", workRoot, "--claude", stub.script, "--claude-sha256", stubSha, "--wire-check-only"]);
  if (h3.status === 3 && /no binary\.json: they were judged by a CLI that was not pinned by hash/.test(h3.stdout) && !existsSync(join(dirD, "binary.json")) && stub.wireCount() === 1) pass("a directory of verdicts from an unpinned CLI refuses a pinned run");
  else fail(`pinned run into unpinned verdicts: status ${h3.status}: ${h3.stdout}${h3.stderr}`);

  out.write(`\n${failures === 0 ? "PASS" : "FAIL"}: proxy-judge rehearsal (${failures} failure(s))\n`);
  process.exit(failures === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
}
