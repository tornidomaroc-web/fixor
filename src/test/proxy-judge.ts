/**
 * Proxy judge, entry point. One headless `claude -p` per request and pass,
 * on the owner's subscription, blind, on the shipped model. What it is and
 * is not: docs/measurements/forced-routing-2026-09-28/proxy-judge-design-2026-09-28.md
 * and the header of lib/proxy-judge.ts. Its result is PROXY-PASS,
 * PROXY-FAIL or PROXY-INCONCLUSIVE and counts for no gate and no public
 * claim. NOT in test:ci; `test:proxy-judge-rehearsal` drives it with a
 * stub executable (no model, no network).
 *
 *   node dist/test/proxy-judge.js --requests <mock-run-dir> --out <dir>
 *        --claude <path to claude.exe or cli.js> --claude-sha256 <64 hex>
 *        [--passes 5] [--work-root <dir outside the repository>] [--max-calls N]
 *        [--stub <stub script.js>]          (rehearsal only; no model; replaces --claude)
 *        [--judge-model <claude-id>] [--effort <level>] [--max-output-tokens N]
 *                                           (a second model arm; its own --out)
 *        [--wire-check-only]                (run the gates and the wire check, judge nothing)
 *
 * THE CLI IS ACCEPTED BY HASH, at a path its updater does not manage, and
 * the hash is re-read before every wire check. BEFORE THE FIRST CALL OF
 * EVERY PASS AND OF EVERY RESUME one process is pointed at a local recorder
 * (no model reached) and the request it sends must carry the pinned model,
 * cap, thinking, effort and login; a difference refuses the start (exit 3)
 * or stops the run before that pass (exit 2). What that check cannot see is
 * in the header of lib/proxy-judge-wire.ts. Amendment A2, 2026-10-02.
 *
 * BEFORE A REAL RUN THE OWNER: (1) confirms at claude.ai that extra usage /
 * usage credits are OFF, because this script cannot see that setting and a
 * subscription window that has run out would otherwise bill credits;
 * (2) produces the request files with the runner in --mode mock over the
 * blob-verified corpora; (3) runs this with no API credential anywhere in
 * the environment. A rate limit stops the run with no file written for the
 * interrupted call; the same command resumes from the last completed call.
 *
 * Exit codes: 0 all passes complete and scored (or --wire-check-only
 * passed); 2 stopped (infrastructure failure, model mismatch, a wire check
 * failing before a later pass, or --max-calls reached), resumable unless a
 * model-mismatch file was written; 3 refused to start: no judge call made,
 * no verdict written (a failed wire check leaves its line in
 * wire-checks.jsonl).
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

import {
  DEFAULT_WIRE,
  EFFORT_LEVELS,
  FORBIDDEN_FLAGS,
  JUDGE_MODEL_SHAPE,
  WORK_ROOT_FORBIDDEN,
  WIN_ARGV_LIMIT,
  argvChars,
  assembleResults,
  credentialGate,
  judgeArgv,
  mismatchName,
  parseResult,
  proxyLabel,
  readRequests,
  recordName,
  scanProxyDir,
  scrubbedEnv,
  settingsGate,
  verdictFrom,
  volume,
  type JudgeArm,
  type JudgeRecord,
  type JudgeRequest,
} from "./lib/proxy-judge";
import { WIRE_TIMEOUT_MS, binaryGate, canonical, captureWire, checkWire, sha256File, wireFacts, wireFingerprint } from "./lib/proxy-judge-wire";

const out = process.stdout;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function isInside(child: string, parent: string): boolean {
  const c = resolve(child).toLowerCase();
  const p = resolve(parent).toLowerCase();
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

async function main(): Promise<number> {
  // 1. Credential gate, before any file is read.
  const cred = credentialGate(process.env);
  if (cred) {
    out.write(`refused: ${cred}\n`);
    return 3;
  }
  const settings = settingsGate();
  if (settings.refuse) {
    out.write(`refused: ${settings.refuse}\n`);
    return 3;
  }
  for (const n of settings.notes) out.write(`note: ${n}\n`);

  // 2. Arguments.
  const requestsDir = arg("--requests");
  const outDir = arg("--out");
  if (!requestsDir || !outDir) {
    out.write("usage: proxy-judge --requests <mock-run-dir> --out <dir> --claude <path> --claude-sha256 <64 hex> [--passes 5] [--work-root <dir>] [--max-calls N] [--wire-check-only] [--stub <script.js>]\n");
    return 3;
  }
  const passes = Number(arg("--passes") ?? 5);
  if (!Number.isInteger(passes) || passes < 1 || passes > 5) {
    out.write(`refused: --passes ${arg("--passes")} is not an integer in [1, 5]; the pre-registered n is 5\n`);
    return 3;
  }
  const maxCalls = arg("--max-calls") !== undefined ? Number(arg("--max-calls")) : Infinity;
  if (!(maxCalls > 0)) {
    out.write("refused: --max-calls must be a positive integer\n");
    return 3;
  }
  const stub = arg("--stub");
  const wireOnly = process.argv.includes("--wire-check-only");
  const repoRoot = process.cwd();
  // The CLI shows the model its working directory, so the default is a
  // neutral name and any work root naming the product, the judge or a case
  // set is refused. The first real call ran under a default that contained
  // "fixor-proxy-judge"; it was overridden by hand (tracker, 2026-09-29).
  const workRoot = resolve(arg("--work-root") ?? join(tmpdir(), "w"));
  if (isInside(workRoot, repoRoot) || isInside(workRoot, requestsDir)) {
    out.write(`refused: --work-root ${workRoot} is inside the repository or the requests directory; the process must start from an empty folder outside both\n`);
    return 3;
  }
  if (WORK_ROOT_FORBIDDEN.test(workRoot)) {
    out.write(`refused: --work-root ${workRoot} names the product, the judge or a case set, and the CLI shows the model its working directory; choose a neutral path\n`);
    return 3;
  }
  for (const f of FORBIDDEN_FLAGS) {
    if (process.argv.includes(f)) {
      out.write(`refused: ${f} is never passed to the judge process\n`);
      return 3;
    }
  }
  // A second model arm. None of the three flags: the shipped-model arm,
  // argv and environment unchanged.
  const arm: JudgeArm = {};
  const jm = arg("--judge-model");
  if (jm !== undefined) {
    if (!JUDGE_MODEL_SHAPE.test(jm)) {
      out.write(`refused: --judge-model ${jm} is not a full model id (claude-...); an alias could resolve to another model between passes\n`);
      return 3;
    }
    arm.judgeModel = jm;
  }
  const ef = arg("--effort");
  if (ef !== undefined) {
    if (!EFFORT_LEVELS.includes(ef)) {
      out.write(`refused: --effort ${ef} is not one of ${EFFORT_LEVELS.join(", ")}\n`);
      return 3;
    }
    arm.effort = ef;
  }
  const mo = arg("--max-output-tokens");
  if (mo !== undefined) {
    const v = Number(mo);
    if (!Number.isInteger(v) || v < 1) {
      out.write(`refused: --max-output-tokens ${mo} is not a positive integer\n`);
      return 3;
    }
    arm.maxOutputTokens = v;
  }
  const secondArm = arm.judgeModel !== undefined || arm.effort !== undefined || arm.maxOutputTokens !== undefined;

  // 3. The executable: the stub, or a CLI accepted by sha256 at a path the
  // updater does not manage. There is no PATH lookup: the claude on PATH is
  // the updater's copy, and the build pinned on 2026-09-29 was pruned from
  // versions/ before the run (amendment A2).
  let cmd: string;
  let cmdArgsPrefix: string[] = [];
  let binary: { path: string; sha256: string } | null = null;
  if (stub) {
    if (!isAbsolute(stub) || !existsSync(stub) || !stub.endsWith(".js")) {
      out.write(`refused: --stub must be an absolute path to an existing .js file\n`);
      return 3;
    }
    cmd = process.execPath;
    cmdArgsPrefix = [stub];
  } else {
    const given = arg("--claude");
    if (!given) {
      out.write("refused: --claude <path> with --claude-sha256 <64 hex> is required; the claude on PATH is the updater's copy, not a pinned build\n");
      return 3;
    }
    if (!existsSync(given) || !statSync(given).isFile()) {
      out.write(`refused: --claude ${given} is not a file\n`);
      return 3;
    }
    if (/\.(cmd|bat)$/i.test(given)) {
      out.write(`refused: --claude ${given} is a shell shim; pass claude.exe or the CLI's cli.js\n`);
      return 3;
    }
    const gate = binaryGate(resolve(given), arg("--claude-sha256"));
    if (gate.refuse || !gate.sha256) {
      out.write(`refused: ${gate.refuse}\n`);
      return 3;
    }
    binary = { path: resolve(given), sha256: gate.sha256 };
    if (given.endsWith(".js")) {
      cmd = process.execPath;
      cmdArgsPrefix = [binary.path];
    } else {
      cmd = binary.path;
    }
  }

  // 4. Requests and prior state.
  const reqs = readRequests(requestsDir);
  const vol = volume(reqs);
  if (process.platform === "win32" && vol.maxArgvChars > WIN_ARGV_LIMIT) {
    out.write(`refused: the longest argv is ${vol.maxArgvChars} characters, over the Windows command-line limit ${WIN_ARGV_LIMIT}\n`);
    return 3;
  }
  const proxyDir = join(outDir, "proxy");
  const prior = scanProxyDir(proxyDir);
  if (prior.mismatches.length > 0) {
    out.write(`refused: ${proxyDir} holds ${prior.mismatches.length} model-mismatch file(s) (${prior.mismatches.slice(0, 3).join(", ")}); the subscription answered on another model. The owner decides whether a different-model proxy is wanted; remove the files to resume\n`);
    return 3;
  }
  // One output directory holds one arm. A second arm's settings are written
  // to arm.json on its first start and must match on every resume; a
  // directory with verdicts but no arm.json belongs to the shipped-model arm
  // and a second arm never writes into it, and the reverse. This is what
  // keeps a second arm's figures from being merged with the first's.
  const armFile = join(outDir, "arm.json");
  const armWant = JSON.stringify(arm);
  if (existsSync(armFile)) {
    const have = JSON.stringify(JSON.parse(readFileSync(armFile, "utf8")));
    if (have !== armWant) {
      out.write(`refused: ${armFile} records arm ${have}, this invocation asks for ${armWant}; one output directory holds one arm\n`);
      return 3;
    }
  } else if (prior.done.size > 0 && secondArm) {
    out.write(`refused: ${proxyDir} holds ${prior.done.size} verdict(s) from the shipped-model arm (no arm.json); a second arm needs its own --out\n`);
    return 3;
  }
  // One output directory holds one binary, as it holds one arm.
  const binaryFile = join(outDir, "binary.json");
  if (binary) {
    if (existsSync(binaryFile)) {
      const have = (JSON.parse(readFileSync(binaryFile, "utf8")) as { sha256?: string }).sha256;
      if (have !== binary.sha256) {
        out.write(`refused: ${binaryFile} records CLI sha256 ${String(have)}, this invocation runs ${binary.sha256}; one output directory holds one binary\n`);
        return 3;
      }
    } else if (prior.done.size > 0) {
      out.write(`refused: ${proxyDir} holds ${prior.done.size} verdict(s) and no binary.json: they were judged by a CLI that was not pinned by hash; a pinned run needs its own --out\n`);
      return 3;
    }
  }
  mkdirSync(proxyDir, { recursive: true });
  mkdirSync(workRoot, { recursive: true });
  if (secondArm && !existsSync(armFile)) writeFileSync(armFile, armWant);
  if (binary && !existsSync(binaryFile)) writeFileSync(binaryFile, JSON.stringify(binary));
  const shippedModels = new Set(reqs.map((r) => r.model));
  const startedAt = new Date().toISOString();
  const env = scrubbedEnv(process.env, arm.maxOutputTokens);
  const log = (line: string): void => appendFileSync(join(outDir, "judge.log"), `${new Date().toISOString()} ${line}\n`);

  // 4b. The wire check (lib/proxy-judge-wire.ts): the process a judge call
  // would start, for the request about to be judged, against a recorder that
  // answers 400. Returns the reason to refuse, or null.
  const wireLog = join(outDir, "wire-checks.jsonl");
  const baselineFile = join(outDir, "wire-baseline.json");
  const wireGate = async (r: JudgeRequest, pass: number): Promise<string | null> => {
    const bad: string[] = [];
    if (binary) {
      const now = sha256File(binary.path);
      if (now !== binary.sha256) return `the CLI at ${binary.path} now has sha256 ${now}, pinned ${binary.sha256}`;
    }
    const dir = mkdtempSync(join(workRoot, "call-"));
    let capture;
    try {
      capture = await captureWire({ cmd, args: [...cmdArgsPrefix, ...judgeArgv(r, arm)], env, stdin: r.user, cwd: dir });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (capture.spawnError) bad.push(`the process did not start: ${capture.spawnError}`);
    if (capture.timedOut) bad.push(`the process was killed after ${WIRE_TIMEOUT_MS} ms`);
    const facts = wireFacts(capture);
    const effort = arm.effort ?? DEFAULT_WIRE.effort;
    bad.push(...checkWire(facts, { model: arm.judgeModel ?? r.model, maxTokens: arm.maxOutputTokens ?? DEFAULT_WIRE.maxTokens, effort, system: r.system, user: r.user, schema: r.schema, forbidden: [repoRoot, resolve(requestsDir)] }));
    const fp = wireFingerprint(facts);
    let baseline = "not compared";
    if (bad.length === 0) {
      if (existsSync(baselineFile)) {
        const have = (JSON.parse(readFileSync(baselineFile, "utf8")) as { fingerprint: Record<string, unknown> }).fingerprint;
        const differing = [...new Set([...Object.keys(have), ...Object.keys(fp)])].filter((k) => canonical(have[k]) !== canonical(fp[k]));
        if (differing.length > 0) {
          baseline = "differs";
          bad.push(`the request shape differs from this directory's baseline in ${differing.join(", ")} (${baselineFile})`);
        } else baseline = "equal";
      } else {
        writeFileSync(baselineFile, JSON.stringify({ at: new Date().toISOString(), n: r.n, pass, binarySha256: binary?.sha256 ?? null, stub: !!stub, fingerprint: fp }, null, 2));
        baseline = "written";
      }
    }
    appendFileSync(wireLog, JSON.stringify({ at: new Date().toISOString(), n: r.n, pass, ok: bad.length === 0, failures: bad, baseline, exit: capture.exit, otherRequests: facts.otherRequests, binarySha256: binary?.sha256 ?? null, stub: !!stub, fingerprint: fp }) + "\n");
    if (bad.length > 0) return bad.join("; ");
    out.write(`wire check before pass ${pass} (request n=${r.n}, no model reached): model ${String(fp["model"])}, max_tokens ${String(fp["max_tokens"])}, thinking adaptive, effort ${effort}, OAuth bearer, no x-api-key; baseline ${baseline}\n`);
    return null;
  };
  let pending: { r: JudgeRequest; pass: number } | null = null;
  find: for (let pass = 1; pass <= passes; pass++) {
    for (const r of reqs) {
      if (!prior.done.has(recordName(r.n, pass))) {
        pending = { r, pass };
        break find;
      }
    }
  }
  if (!pending && wireOnly && reqs[0]) pending = { r: reqs[0], pass: 1 };
  let wirePass = 0;
  if (pending) {
    const refused = await wireGate(pending.r, pending.pass);
    if (refused) {
      log(`REFUSED wire check before pass ${pending.pass}, request n=${pending.r.n}: ${refused}`);
      out.write(`refused: wire check before pass ${pending.pass} (request n=${pending.r.n}): ${refused}. No judge call was made\n`);
      return 3;
    }
    wirePass = pending.pass;
  }
  if (wireOnly) {
    out.write("wire check only: passed; no judge call was made and no verdict was written\n");
    return 0;
  }
  const runFile = join(outDir, "judge-run.json");
  writeFileSync(
    runFile,
    JSON.stringify({ instrument: "PROXY", stub: !!stub, startedAt, requestsDir: resolve(requestsDir), passes, requests: reqs.length, callsPlanned: reqs.length * passes, doneBefore: prior.done.size, shippedModels: [...shippedModels], ...(secondArm ? { arm } : {}), executable: stub ? `stub ${stub}` : cmd, ...(binary ? { claudeSha256: binary.sha256 } : {}), wireExpect: { maxTokens: arm.maxOutputTokens ?? DEFAULT_WIRE.maxTokens, effort: arm.effort ?? DEFAULT_WIRE.effort, thinking: "adaptive" }, argvTemplate: judgeArgv({ model: "<model>", system: "<system>", schema: "<schema>" }, arm), envPassthrough: Object.keys(scrubbedEnv(process.env, arm.maxOutputTokens)), volumePerPass: vol }, null, 2),
  );
  out.write(`proxy-judge${stub ? " [STUB REHEARSAL: no model, no network]" : ""}: ${reqs.length} requests x ${passes} passes; ${prior.done.size} already judged; shipped model ${[...shippedModels].join(", ")}\n`);
  if (secondArm) out.write(`second arm: ${armWant}; a separate arm, never merged with the shipped-model arm's figures\n`);
  out.write(`volume per pass: ${vol.requests} requests, ${vol.totalChars} chars (system ${vol.systemChars}, user ${vol.userChars}), ~${vol.estimatedTokens} tokens at 3.5 chars/token (estimate, no tokenizer); longest argv ${vol.maxArgvChars} chars\n`);

  // 5. Passes outer, requests inner; every verdict on disk as it arrives.
  const st: { stop: string | null } = { stop: null };
  let judgedNow = 0;
  const modelsSeen = new Map<string, number>();
  const passUsage = new Map<number, { input: number; output: number; cacheWrite: number; cacheRead: number; calls: number }>();
  const judge = (r: JudgeRequest, pass: number): "ok" | "stop" => {
    const dir = mkdtempSync(join(workRoot, "call-"));
    try {
      if (readdirSync(dir).length !== 0) throw new Error(`${dir} is not empty`);
      const argv = judgeArgv(r, arm);
      const expected = arm.judgeModel ?? r.model;
      const t0 = Date.now();
      const startedCall = new Date().toISOString();
      const p = spawnSync(cmd, [...cmdArgsPrefix, ...argv], { cwd: dir, env, input: r.user, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
      const wallMs = Date.now() - t0;
      if (p.error || p.status !== 0) {
        st.stop = `infrastructure: call n=${r.n} pass ${pass} exited ${p.status ?? "signal"}${p.error ? ` (${p.error.message})` : ""}: ${(p.stderr ?? "").trim().slice(0, 300)}`;
        log(`STOP ${st.stop}`);
        return "stop";
      }
      const parsed = parseResult(p.stdout ?? "");
      if (!parsed.ok) {
        st.stop = `infrastructure: call n=${r.n} pass ${pass}: ${parsed.reason}`;
        log(`STOP ${st.stop}`);
        return "stop";
      }
      for (const m of parsed.models) modelsSeen.set(m, (modelsSeen.get(m) ?? 0) + 1);
      const rec: JudgeRecord = {
        n: r.n,
        pass,
        target: r.target,
        model: expected,
        ...(secondArm
          ? { shippedModel: r.model, effort: arm.effort, maxOutputTokensPinned: arm.maxOutputTokens, maxOutputTokensReported: parsed.maxOutputTokens[parsed.models[0] ?? ""] ?? null, thinkingTokens: parsed.thinkingTokens, numTurns: parsed.numTurns }
          : {}),
        modelsReported: parsed.models,
        toolName: r.toolName,
        usage: parsed.usage,
        reportedCostUsd: parsed.reportedCostUsd,
        sessionId: parsed.sessionId,
        durationMs: parsed.durationMs,
        wallMs,
        structuredOutput: parsed.structuredOutput,
        verdict: verdictFrom(r.toolName, parsed.structuredOutput),
        stub: !!stub,
        startedAt: startedCall,
        endedAt: new Date().toISOString(),
      };
      const mismatch = parsed.models.length !== 1 || parsed.models[0] !== expected;
      if (mismatch) {
        writeFileSync(join(proxyDir, mismatchName(r.n, pass)), JSON.stringify(rec, null, 2));
        st.stop = `model mismatch: call n=${r.n} pass ${pass} was answered by ${parsed.models.join("+")}, not ${expected}; not substituted, run stopped`;
        log(`STOP ${st.stop}`);
        return "stop";
      }
      // The result's maxOutputTokens field is the model's default, not the
      // cap in force, and is never compared (amendment A2); the cap is read
      // on the wire. What a result CAN show is output above the pinned cap:
      // either the cap was not applied or the call took more than one
      // request. No file is written, so the verdict is never read or scored.
      if (arm.maxOutputTokens !== undefined && parsed.usage.output > arm.maxOutputTokens) {
        st.stop = `instrument mismatch: call n=${r.n} pass ${pass} reported ${parsed.usage.output} output tokens (num_turns ${String(parsed.numTurns)}), over the pinned cap ${arm.maxOutputTokens}; no file written, run stopped`;
        log(`STOP ${st.stop}`);
        return "stop";
      }
      writeFileSync(join(proxyDir, recordName(r.n, pass)), JSON.stringify(rec, null, 2));
      const pu = passUsage.get(pass) ?? { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, calls: 0 };
      pu.input += parsed.usage.input;
      pu.output += parsed.usage.output;
      pu.cacheWrite += parsed.usage.cacheWrite;
      pu.cacheRead += parsed.usage.cacheRead;
      pu.calls++;
      passUsage.set(pass, pu);
      judgedNow++;
      log(`ok n=${r.n} pass=${pass} model=${parsed.models[0]} in=${parsed.usage.input} out=${parsed.usage.output} verdict=${rec.verdict ? `${rec.verdict.isVulnerable}/${rec.verdict.confidence}` : "null"}`);
      return "ok";
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  outer: for (let pass = 1; pass <= passes; pass++) {
    for (const r of reqs) {
      if (prior.done.has(recordName(r.n, pass))) continue;
      if (judgedNow >= maxCalls) {
        st.stop = `--max-calls ${maxCalls} reached; resumable`;
        break outer;
      }
      if (wirePass !== pass) {
        const refused = await wireGate(r, pass);
        if (refused) {
          st.stop = `wire check before pass ${pass} (request n=${r.n}): ${refused}; no call of that pass was made, run stopped`;
          log(`STOP ${st.stop}`);
          break outer;
        }
        wirePass = pass;
      }
      if (judge(r, pass) === "stop") break outer;
    }
  }

  // 6. Score what is on disk; print the label.
  const results = assembleResults(reqs, proxyDir, passes);
  const proxy = proxyLabel(results, passes);
  const summary = proxy.summary;
  const label = arm.judgeModel !== undefined ? `${proxy.label} [judge ${arm.judgeModel}, not the shipped ${[...shippedModels].join(", ")}]` : secondArm ? `${proxy.label} [second arm ${armWant}]` : proxy.label;
  const judgedTotal = results.reduce((a, r) => a + r.verdicts.length, 0);
  const usageByPass = Object.fromEntries([...passUsage.entries()].map(([k, v]) => [k, v]));
  writeFileSync(
    join(outDir, "results.json"),
    JSON.stringify({ instrument: "PROXY", stub: !!stub, label: stub ? `STUB/${label}` : label, ...(secondArm ? { arm } : {}), startedAt, updatedAt: new Date().toISOString(), passes, requests: reqs.length, callsPlanned: reqs.length * passes, judgedTotal, judgedThisInvocation: judgedNow, modelsSeenThisInvocation: Object.fromEntries(modelsSeen), usageThisInvocationByPass: usageByPass, stop: st.stop, volumePerPass: vol, summary, results }, null, 2),
  );
  const modelLine = [...modelsSeen.entries()].map(([m, c]) => `${m} on ${c}`).join(", ") || "no call";
  out.write(
    `${stub ? "STUB/" : ""}${label} | held-out ${summary["heldOutCaseHits"]} of ${summary["heldOutCases"]} -> ${summary["recallVerdict"]}; clean flags ${summary["cleanFlagCount"]} of 30 -> ${summary["noiseVerdict"]}; ` +
      `judged ${judgedTotal} of ${reqs.length * passes} (${judgedNow} this invocation); answered by ${modelLine}${st.stop ? `; STOPPED (${st.stop})` : ""}\n`,
  );
  for (const [p, u] of passUsage) out.write(`pass ${p} reported usage this invocation: ${u.calls} calls, input ${u.input}, output ${u.output}, cache write ${u.cacheWrite}, cache read ${u.cacheRead}\n`);
  if (stub) out.write("this was a STUB rehearsal: the label above is not evidence about any model\n");
  return st.stop ? 2 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`proxy-judge refused: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(3);
  },
);
