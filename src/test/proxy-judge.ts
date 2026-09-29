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
 *        [--passes 5] [--claude <path to claude.exe or cli.js>]
 *        [--work-root <dir outside the repository>] [--max-calls N]
 *        [--stub <stub script.js>]          (rehearsal only; no model)
 *
 * BEFORE A REAL RUN THE OWNER: (1) confirms at claude.ai that extra usage /
 * usage credits are OFF, because this script cannot see that setting and a
 * subscription window that has run out would otherwise bill credits;
 * (2) produces the request files with the runner in --mode mock over the
 * blob-verified corpora; (3) runs this with no API credential anywhere in
 * the environment. A rate limit stops the run with no file written for the
 * interrupted call; the same command resumes from the last completed call.
 *
 * Exit codes: 0 all passes complete and scored; 2 stopped (infrastructure
 * failure, model mismatch, or --max-calls reached), resumable unless a
 * model-mismatch file was written; 3 refused to start, nothing written.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";

import {
  FORBIDDEN_FLAGS,
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
  type JudgeRecord,
  type JudgeRequest,
} from "./lib/proxy-judge";

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

/** `claude` on PATH as a real executable; a .cmd shim cannot carry the argv this needs. */
function findClaude(): { cmd: string; reason?: string } {
  const dirs = (process.env["PATH"] ?? "").split(delimiter).filter(Boolean);
  const names = process.platform === "win32" ? ["claude.exe"] : ["claude"];
  for (const d of dirs) {
    for (const n of names) {
      const p = join(d, n);
      if (existsSync(p) && statSync(p).isFile()) return { cmd: p };
    }
  }
  return { cmd: "", reason: `no ${names[0]} found on PATH; pass --claude <path to claude.exe or to the CLI's cli.js> (a .cmd shim is not accepted: cmd.exe cannot carry the system prompt)` };
}

function main(): number {
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
    out.write("usage: proxy-judge --requests <mock-run-dir> --out <dir> [--passes 5] [--claude <path>] [--work-root <dir>] [--max-calls N] [--stub <script.js>]\n");
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
  const repoRoot = process.cwd();
  const workRoot = resolve(arg("--work-root") ?? join(tmpdir(), "fixor-proxy-judge"));
  if (isInside(workRoot, repoRoot) || isInside(workRoot, requestsDir)) {
    out.write(`refused: --work-root ${workRoot} is inside the repository or the requests directory; the process must start from an empty folder outside both\n`);
    return 3;
  }
  for (const f of FORBIDDEN_FLAGS) {
    if (process.argv.includes(f)) {
      out.write(`refused: ${f} is never passed to the judge process\n`);
      return 3;
    }
  }

  // 3. The executable.
  let cmd: string;
  let cmdArgsPrefix: string[] = [];
  if (stub) {
    if (!isAbsolute(stub) || !existsSync(stub) || !stub.endsWith(".js")) {
      out.write(`refused: --stub must be an absolute path to an existing .js file\n`);
      return 3;
    }
    cmd = process.execPath;
    cmdArgsPrefix = [stub];
  } else {
    const given = arg("--claude");
    if (given) {
      if (!existsSync(given) || !statSync(given).isFile()) {
        out.write(`refused: --claude ${given} is not a file\n`);
        return 3;
      }
      if (/\.(cmd|bat)$/i.test(given)) {
        out.write(`refused: --claude ${given} is a shell shim; pass claude.exe or the CLI's cli.js\n`);
        return 3;
      }
      if (given.endsWith(".js")) {
        cmd = process.execPath;
        cmdArgsPrefix = [resolve(given)];
      } else {
        cmd = resolve(given);
      }
    } else {
      const found = findClaude();
      if (!found.cmd) {
        out.write(`refused: ${found.reason}\n`);
        return 3;
      }
      cmd = found.cmd;
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
  mkdirSync(proxyDir, { recursive: true });
  mkdirSync(workRoot, { recursive: true });
  const shippedModels = new Set(reqs.map((r) => r.model));
  const startedAt = new Date().toISOString();
  const runFile = join(outDir, "judge-run.json");
  writeFileSync(
    runFile,
    JSON.stringify({ instrument: "PROXY", stub: !!stub, startedAt, requestsDir: resolve(requestsDir), passes, requests: reqs.length, callsPlanned: reqs.length * passes, doneBefore: prior.done.size, shippedModels: [...shippedModels], executable: stub ? `stub ${stub}` : cmd, argvTemplate: judgeArgv({ model: "<model>", system: "<system>", schema: "<schema>" }), envPassthrough: Object.keys(scrubbedEnv(process.env)), volumePerPass: vol }, null, 2),
  );
  out.write(`proxy-judge${stub ? " [STUB REHEARSAL: no model, no network]" : ""}: ${reqs.length} requests x ${passes} passes; ${prior.done.size} already judged; shipped model ${[...shippedModels].join(", ")}\n`);
  out.write(`volume per pass: ${vol.requests} requests, ${vol.totalChars} chars (system ${vol.systemChars}, user ${vol.userChars}), ~${vol.estimatedTokens} tokens at 3.5 chars/token (estimate, no tokenizer); longest argv ${vol.maxArgvChars} chars\n`);

  // 5. Passes outer, requests inner; every verdict on disk as it arrives.
  const env = scrubbedEnv(process.env);
  const log = (line: string): void => appendFileSync(join(outDir, "judge.log"), `${new Date().toISOString()} ${line}\n`);
  const st: { stop: string | null } = { stop: null };
  let judgedNow = 0;
  const modelsSeen = new Map<string, number>();
  const passUsage = new Map<number, { input: number; output: number; cacheWrite: number; cacheRead: number; calls: number }>();
  const judge = (r: JudgeRequest, pass: number): "ok" | "stop" => {
    const dir = mkdtempSync(join(workRoot, "call-"));
    try {
      if (readdirSync(dir).length !== 0) throw new Error(`${dir} is not empty`);
      const argv = judgeArgv(r);
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
        model: r.model,
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
      const mismatch = parsed.models.length !== 1 || parsed.models[0] !== r.model;
      if (mismatch) {
        writeFileSync(join(proxyDir, mismatchName(r.n, pass)), JSON.stringify(rec, null, 2));
        st.stop = `model mismatch: call n=${r.n} pass ${pass} was answered by ${parsed.models.join("+")}, not ${r.model}; not substituted, run stopped`;
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
      if (judge(r, pass) === "stop") break outer;
    }
  }

  // 6. Score what is on disk; print the label.
  const results = assembleResults(reqs, proxyDir, passes);
  const { label, summary } = proxyLabel(results, passes);
  const judgedTotal = results.reduce((a, r) => a + r.verdicts.length, 0);
  const usageByPass = Object.fromEntries([...passUsage.entries()].map(([k, v]) => [k, v]));
  writeFileSync(
    join(outDir, "results.json"),
    JSON.stringify({ instrument: "PROXY", stub: !!stub, label: stub ? `STUB/${label}` : label, startedAt, updatedAt: new Date().toISOString(), passes, requests: reqs.length, callsPlanned: reqs.length * passes, judgedTotal, judgedThisInvocation: judgedNow, modelsSeenThisInvocation: Object.fromEntries(modelsSeen), usageThisInvocationByPass: usageByPass, stop: st.stop, volumePerPass: vol, summary, results }, null, 2),
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

try {
  process.exit(main());
} catch (err) {
  process.stderr.write(`proxy-judge refused: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(3);
}
