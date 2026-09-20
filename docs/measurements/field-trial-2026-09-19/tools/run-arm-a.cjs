// Field trial Arm A (amendment A1, cost-corrected): the one-pass driver.
//
// Usage (from the repository root, after `npm run build`):
//   node run-arm-a.cjs live      <corpusDir> <outDir> <ceilingUsd>
//   node run-arm-a.cjs rehearsal <corpusDir> <outDir> <ceilingUsd> <mockPort>
//
// Live: every scan runs as `node --require trial-observer.cjs --env-file=.env
// dist/cli/scan.js <dir> --yes --output=<report>`. The key reaches the child
// only through --env-file; this driver never holds it. Rehearsal: a placeholder
// key and a local mock, no --env-file.
//
// Order: case 10 first (the largest payloads, the likeliest to meet a rate
// limit or the 45 s timeout), then descending payload, then the zero-call
// cases. Each case runs parent then fix. After every scan the six stop
// conditions are checked and the pass stops at the first failure.
"use strict";
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const [mode, corpus, outDir, ceilingArg, port] = process.argv.slice(2);
if (!["live", "rehearsal"].includes(mode) || !corpus || !outDir || !ceilingArg) {
  console.error("usage: run-arm-a.cjs live|rehearsal <corpusDir> <outDir> <ceilingUsd> [mockPort]");
  process.exit(1);
}
const live = mode === "live";
const ceiling = Number(ceilingArg);
const repo = process.cwd();
const tools = path.join(repo, "docs", "measurements", "field-trial-2026-09-19", "tools");
const OBS = path.join(tools, "trial-observer.cjs");
const MODEL = "claude-sonnet-4-6";

const EXPECTED_HASHES = {
  "docs/measurements/field-trial-2026-09-19/known-answer-admission.md":
    "1224650e3f3e9d14536cb62a5aff9f403c221bf7c73289e908a7a78acf3f9cb4",
  "docs/measurements/field-trial-2026-09-19/field-trial-prereg-2026-09-19.md":
    "3c9328572879c061b99a48af6db287d61b97f8296676ab977658faac9e2c9f4c",
  "docs/measurements/field-trial-2026-09-19/field-trial-amendment-A1-2026-09-19.md":
    "3317a1ae98ded2782709cf1f6e5fd87397d4f0e994fc3a1fe268cb090476f6cb",
  "docs/measurements/field-trial-2026-09-19/field-trial-amendment-A1-cost-2026-09-19.md":
    "edadfe38287f45256408c476ab5023c9fac5bd7c12fe619e296ec820a5883dad",
};
const EXPECTED_TREE = "84e08fdf955c77969c248d25f5512d89a30c79b5";

// [case, calls at parent, calls at fix] in run order.
const PLAN = [
  ["10", 2, 2], ["09", 2, 2], ["07", 2, 2], ["04", 2, 2], ["05", 4, 4], ["01", 1, 1],
  ["11", 0, 1], ["02", 0, 0], ["03", 0, 0], ["06", 0, 0], ["08", 0, 0], ["12", 0, 0],
];

const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const git = (...a) => spawnSync("git", a, { cwd: repo, encoding: "utf8" }).stdout.trim();
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const now = () => new Date().toISOString();

function manifest() {
  const h = crypto.createHash("sha256");
  for (const v of ["known-answer", "known-answer-fixed"]) {
    const root = path.join(corpus, v);
    const walk = (d) =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
      );
    for (const f of walk(root).sort()) h.update(`${path.relative(corpus, f)}\0${sha(f)}\n`);
  }
  return h.digest("hex");
}

function stop(reason, extra) {
  const rec = { at: now(), stop: reason, ...extra };
  fs.appendFileSync(path.join(outDir, "run.jsonl"), JSON.stringify(rec) + "\n");
  console.log(`STOP: ${reason}`);
  process.exit(3);
}

fs.mkdirSync(path.join(outDir, "parent"), { recursive: true });
fs.mkdirSync(path.join(outDir, "fix"), { recursive: true });
const obsFile = path.join(outDir, "observer.jsonl");
if (fs.existsSync(obsFile)) stop("observer file already exists; refusing to mix runs");

// Pre-spend checks.
if (process.env.ANTHROPIC_API_KEY !== undefined) stop("driver environment holds ANTHROPIC_API_KEY; it must come only from --env-file");
for (const [p, want] of Object.entries(EXPECTED_HASHES)) {
  const got = sha(path.join(repo, p));
  if (got !== want) stop("hash mismatch before the first call", { file: p, want, got });
}
const tree = git("rev-parse", "HEAD^{tree}");
if (tree !== EXPECTED_TREE) stop("tree mismatch before the first call", { want: EXPECTED_TREE, got: tree });
if (git("status", "--porcelain", "--untracked-files=no") !== "") stop("tracked changes present before the first call");
const manifestBefore = manifest();

const env = { ...process.env };
Object.assign(env, {
  FIXOR_REPLAY: "", FIXOR_RECORD: "", FIXOR_REPLAY_ROOT: "", FIXOR_ESCALATE_MEDIUM: "false",
  FIXOR_SECRETS_LLM_OPT_IN: "false", FIXOR_ADMIN_CHECK_LLM_OPT_IN: "false", FIXOR_DEBUG_IDOR_LLM: "",
  FIXOR_HALT_USD: "", FIXOR_PILOT_ENABLED: "false", SENTRY_DSN: "", LOG_LEVEL: "info",
  ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_LOG: "", DEBUG: "", NODE_DEBUG: "", NODE_OPTIONS: "",
  HTTP_PROXY: "", HTTPS_PROXY: "", NODE_TLS_REJECT_UNAUTHORIZED: "", NODE_ENV: "",
  TRIAL_OBSERVER_OUT: obsFile, TRIAL_CEILING_USD: String(ceiling),
  ANTHROPIC_BASE_URL: live ? "https://api.anthropic.com" : `http://127.0.0.1:${port}`,
});
if (!live) env.ANTHROPIC_API_KEY = "fixor-rehearsal-placeholder-no-network";

const readObs = () =>
  fs.existsSync(obsFile)
    ? fs.readFileSync(obsFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
    : [];
const logNum = (log, key) => {
  const m = log.replace(/\x1b\[[0-9;]*m/g, "").match(new RegExp(`${key}"?\\s*[:=]\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
};

const windowStart = now();
fs.appendFileSync(path.join(outDir, "run.jsonl"), JSON.stringify({ at: windowStart, event: "start", mode, ceiling, tree, manifestBefore }) + "\n");

for (const [n, parentCalls, fixCalls] of PLAN) {
  for (const [version, expected] of [["parent", parentCalls], ["fix", fixCalls]]) {
    const dir = path.join(corpus, version === "parent" ? "known-answer" : "known-answer-fixed", n);
    const report = path.join(outDir, version, `${n}.report.md`);
    const before = readObs().length;
    const t0 = now();
    const args = ["--require", OBS, ...(live ? ["--env-file=.env"] : []), "dist/cli/scan.js", dir, "--yes", `--output=${report}`];
    const r = spawnSync(process.execPath, args, { cwd: repo, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 15 * 60 * 1000 });
    const log = `${r.stdout || ""}${r.stderr || ""}`;
    fs.writeFileSync(path.join(outDir, version, `${n}.log`), log);
    fs.writeFileSync(path.join(outDir, version, `${n}.exit`), `${r.status}\n`);
    const fresh = readObs().slice(before);
    const spent = readObs().reduce((s, x) => s + (typeof x.costUsd === "number" ? x.costUsd : 0), 0);
    const rec = {
      case: n, version, started: t0, ended: now(), exit: r.status, signal: r.signal,
      attempted: logNum(log, "llmCallsAttempted"), failed: logNum(log, "llmCallsFailed"),
      notAnalyzed: logNum(log, "filesNotAnalyzed"), expected,
      observerLines: fresh.length, observerErrors: fresh.filter((x) => x.error).length,
      refused: fresh.filter((x) => x.refused).length,
      models: [...new Set(fresh.map((x) => x.requestModel))], responseModels: [...new Set(fresh.filter((x) => x.responseModel).map((x) => x.responseModel))],
      invocationCostUsd: fresh.reduce((s, x) => s + (x.costUsd || 0), 0), cumulativeCostUsd: spent,
    };
    fs.appendFileSync(path.join(outDir, "run.jsonl"), JSON.stringify(rec) + "\n");
    console.log(`${n} ${version}: exit ${r.status} calls ${rec.attempted}/${expected} failed ${rec.failed} cost $${rec.invocationCostUsd.toFixed(4)} cumulative $${spent.toFixed(4)}`);

    if (rec.refused > 0 || spent > ceiling) stop("condition 5: running cost crossed the ceiling", rec);
    if (r.status === 2) stop("condition 2: scan exit code 2 (degraded coverage)", rec);
    if (r.status !== 0) stop(`scan exited ${r.status}`, rec);
    if (rec.attempted !== expected) stop("condition 1: call count differs from the dry run", rec);
    if (rec.failed !== 0 || rec.notAnalyzed !== 0) stop("condition 2: failed call or unanalysed file", rec);
    if (rec.models.some((m) => m !== MODEL)) stop("condition 3: requested model id is not claude-sonnet-4-6", rec);
    if (live && expected > 0) sleep(20_000);
  }
}

const manifestAfter = manifest();
if (manifestAfter !== manifestBefore) stop("condition 4: corpus files changed during the run", { manifestBefore, manifestAfter });
const end = now();
const total = readObs().reduce((s, x) => s + (x.costUsd || 0), 0);
fs.appendFileSync(path.join(outDir, "run.jsonl"), JSON.stringify({ at: end, event: "end", windowStart, windowEnd: end, observerCostUsd: total, manifestAfter }) + "\n");
console.log(`DONE: window ${windowStart} .. ${end}; observer cost $${total.toFixed(4)}; corpus unchanged`);
