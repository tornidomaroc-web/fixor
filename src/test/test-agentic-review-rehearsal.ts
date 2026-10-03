/**
 * Agentic-review rehearsal (free, keyless, in test:ci). No model, no outbound
 * network: the wire check's recorder listens on 127.0.0.1 and the stub is its
 * only client; nothing asserts on time. Builds synthetic upstream repositories
 * with real history, prepares them with dist/test/agentic-prepare.js, drives
 * dist/test/agentic-review.js with a stub CLI, and proves:
 *
 *   A. Preparation: the blame rule finds the introducing commit; a case whose
 *      fix patch does not apply gets no fix side; the defect window contains
 *      the anchor; the clean rule picks the newest route-shaped commit before
 *      the cut-off and falls back when none exists; every prepared repository
 *      is neutral (two commits on work, one on origin/HEAD, neutral author,
 *      committer, dates, message, local origin) and carries no upstream
 *      message, author or path; the manifest holds no file contents.
 *   B. Scoring, as functions: the findings parser, the hit rule, the case
 *      rule (4 of 5 and at most 1 of 5), the no-fix-side rule, the clean
 *      flag rule, and Gate A on each side of its two numbers and its
 *      precondition.
 *   C. The harness with a marker-flagging stub: every accepted case with a
 *      fix side is a hit, the case without one is not, no clean change is
 *      flagged; with a flag-everything stub: no case is a hit (the fix side
 *      catches it) and the clean changes are flagged.
 *   D. Blindness: argv is byte-for-byte the pinned list; stdin is the
 *      expanded built-in prompt and nothing else; the environment is the
 *      whitelist plus the two pinned variables; the cwd is the neutral state
 *      directory; nothing in argv, stdin, cwd or env names a case, a set, an
 *      advisory, an anchor, the upstream path or the repository.
 *   E. Guards: a credential refuses; a missing pin, a wrong pin or a missing
 *      tool record refuses; a changed prompt refuses; a tool outside the set
 *      or a non-git Bash command voids the run and the series; another model
 *      stops; a run that writes into the repository stops with no record; a
 *      cut-off resumes with no run repeated; a wrong cap, model, tool list or
 *      login on the wire refuses before any run; the recorder check records
 *      the tool list.
 *   F. Token volume per state from the expanded prompts, printed.
 */
import { spawnSync, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { GATE_A_MAX_CLEAN_FLAGS, GATE_A_MIN_HITS, NEUTRAL, RUNS, checkNeutralRepo, defectWindow, estimateTokens, gateA, parseFindings, runHit, scoreCases, scoreClean, type PreparedManifest, type RunRecord } from "./lib/agentic-review";
import { harnessArgv } from "./agentic-review";
import { sha256File } from "./lib/proxy-judge-wire";

const out = process.stdout;
let failures = 0;
const pass = (m: string): void => void out.write(`  PASS ${m}\n`);
const fail = (m: string): void => { failures++; out.write(`  FAIL ${m}\n`); };
for (const k of Object.keys(process.env)) if (/^(ANTHROPIC_|AWS_|CLAUDE_CODE_USE_|FIXOR_PARKED)/i.test(k)) delete process.env[k];

const REPO = process.cwd();
const PREP = join(REPO, "dist", "test", "agentic-prepare.js");
const HARNESS = join(REPO, "dist", "test", "agentic-review.js");
const STUB_SRC = join(REPO, "dist", "test", "lib", "agentic-review-stub.js");
const PROMPT = join(REPO, "docs/measurements/agentic-review-2026-10-02/builtin-security-review-2.1.284.md");
const MARKER = "/* UNGUARDED_HANDLER_MARKER */";
const UPSTREAM_AUTHOR = "Upstream Maintainer";
const UPSTREAM_EMAIL = "maintainer@upstream.example.org";

function run(cmd: string, args: string[], env: Record<string, string> = {}, cwd = REPO): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [cmd, ...args], { encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 256 * 1024 * 1024, cwd });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
function git(dir: string, args: string[], date = "2026-05-01T12:00:00Z", msg?: string): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: UPSTREAM_AUTHOR, GIT_AUTHOR_EMAIL: UPSTREAM_EMAIL, GIT_COMMITTER_NAME: UPSTREAM_AUTHOR, GIT_COMMITTER_EMAIL: UPSTREAM_EMAIL, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_CONFIG_NOSYSTEM: "1", ...(msg ? { MSG: msg } : {}) } });
}
function commit(dir: string, msg: string, date: string): string {
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", msg], date);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}
const handler = (guarded: boolean, marker: boolean) => [
  'import { Router } from "express";',
  'import { db } from "../db";',
  "const router = Router();",
  "",
  'router.get("/items/:id", async (req, res) => {',
  ...(guarded ? ["  requireAuth(req);"] : []),
  `  const item = await db.items.findOne(req.params.id);${marker ? " " + MARKER : ""}`,
  "  res.json(item);",
  "});",
  "",
  "export default router;",
  "",
].join("\n");

interface Upstream { dir: string; fix: string; parent: string; anchor: number; introducing: string }
/** One case repository: base, introducing commit (adds the handler with the marker), an unrelated commit, then the fix (adds the guard). */
function makeCaseUpstream(root: string, name: string, opts: { refactorBeforeFix?: boolean }): Upstream {
  const dir = join(root, name);
  mkdirSync(join(dir, "src", "routes"), { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "README.md"), `# ${name}\n`);
  writeFileSync(join(dir, "src", "routes", "other.ts"), 'export const other = 1;\n');
  commit(dir, "initial import of the project", "2026-03-01T10:00:00Z");
  writeFileSync(join(dir, "src", "routes", "items.ts"), handler(false, true));
  const introducing = commit(dir, `feat(api): add the items endpoint (${name.toUpperCase()}-101)`, "2026-04-02T10:00:00Z");
  writeFileSync(join(dir, "README.md"), `# ${name}\n\nSee the advisory GHSA-xxxx-yyyy-zzzz for ${name}.\n`);
  commit(dir, "docs: mention the advisory GHSA-xxxx-yyyy-zzzz", "2026-04-20T10:00:00Z");
  if (opts.refactorBeforeFix) {
    // A refactor between I and the fix, so the fix patch's context does not match I's tree.
    writeFileSync(join(dir, "src", "routes", "items.ts"), handler(false, true).replace('router.get("/items/:id", async (req, res) => {', 'router.get("/items/:id", async (request, response) => {\n  const req = request, res = response;'));
    commit(dir, "refactor: rename handler parameters", "2026-05-02T10:00:00Z");
  }
  const parent = git(dir, ["rev-parse", "HEAD"]).trim();
  const before = readFileSync(join(dir, "src", "routes", "items.ts"), "utf8");
  const anchor = before.split("\n").findIndex((l) => l.includes(MARKER)) + 1; // parent-side line of the unguarded body line
  // The fix adds the guard and removes the marker, so the fix side carries no signal.
  writeFileSync(join(dir, "src", "routes", "items.ts"), before.replace(/\n(  const item = await[^\n]*)/, (_m, line: string) => "\n  requireAuth(req);\n" + line.replace(" " + MARKER, "")));
  const fix = commit(dir, `fix(security): require authentication on the items endpoint (${name.toUpperCase()}-102)`, "2026-06-15T10:00:00Z");
  return { dir, fix, parent, anchor, introducing };
}
/** A case whose handler arrives by a rename: blame follows the file back to the commit that added it under the old path, so that commit's diff adds nothing to the defect path and the blame rule rejects the case. */
function makeMovedUpstream(root: string, name: string): Upstream {
  const dir = join(root, name);
  mkdirSync(join(dir, "src", "routes"), { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "README.md"), `# ${name}\n`);
  commit(dir, "initial import of the project", "2026-03-01T10:00:00Z");
  writeFileSync(join(dir, "src", "routes", "legacy.ts"), handler(false, true));
  const introducing = commit(dir, "feat(api): add the legacy endpoint", "2026-04-02T10:00:00Z");
  git(dir, ["mv", "src/routes/legacy.ts", "src/routes/items.ts"]);
  commit(dir, "refactor: rename the route file", "2026-04-10T10:00:00Z");
  const parent = git(dir, ["rev-parse", "HEAD"]).trim();
  const before = readFileSync(join(dir, "src", "routes", "items.ts"), "utf8");
  const anchor = before.split("\n").findIndex((l) => l.includes(MARKER)) + 1;
  writeFileSync(join(dir, "src", "routes", "items.ts"), before.replace(/\n(  const item = await[^\n]*)/, (_m, line: string) => "\n  requireAuth(req);\n" + line.replace(" " + MARKER, "")));
  const fix = commit(dir, "fix(security): require authentication on the items endpoint", "2026-06-15T10:00:00Z");
  return { dir, fix, parent, anchor, introducing };
}
/** A clean repository: a route file touched by a doc-only commit, a route-shaped commit before the cut-off, and a later route-shaped commit after it. */
function makeCleanUpstream(root: string, name: string, routeShaped: boolean): { dir: string; head: string; expected: string } {
  const dir = join(root, name);
  mkdirSync(join(dir, "server"), { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "server", "routes.ts"), 'import { Router } from "express";\nconst router = Router();\nrouter.get("/health", (req, res) => res.json({ ok: true }));\nexport default router;\n');
  commit(dir, "initial", "2026-03-01T10:00:00Z");
  writeFileSync(join(dir, "server", "routes.ts"), '// routes for the service\nimport { Router } from "express";\nconst router = Router();\nrouter.get("/health", (req, res) => res.json({ ok: true }));\nexport default router;\n');
  const docOnly = commit(dir, "docs: comment", "2026-06-01T10:00:00Z");
  let expected = docOnly;
  if (routeShaped) {
    writeFileSync(join(dir, "server", "routes.ts"), '// routes for the service\nimport { Router } from "express";\nconst router = Router();\nrouter.get("/health", (req, res) => res.json({ ok: true }));\nrouter.get("/version", (req, res) => res.json({ v: 1 }));\nexport default router;\n');
    expected = commit(dir, "feat: version endpoint", "2026-08-01T10:00:00Z");
  }
  writeFileSync(join(dir, "server", "routes.ts"), readFileSync(join(dir, "server", "routes.ts"), "utf8") + 'router.post("/late", (req, res) => res.json({}));\n');
  const head = commit(dir, "feat: late endpoint after the cut-off", "2026-09-30T10:00:00Z");
  return { dir, head, expected };
}

interface Stub { dir: string; script: string; config: (c: Record<string, unknown>) => void; count: () => number; wireCount: () => number; captures: () => Array<{ argv: string[]; stdin: string; cwd: string; env: Record<string, string> }>; reset: () => void }
function makeStub(): Stub {
  const dir = mkdtempSync(join(tmpdir(), "ar-stub-"));
  const script = join(dir, "claude-stub.js");
  copyFileSync(STUB_SRC, script);
  const n = (f: string) => (existsSync(join(dir, f)) ? Number(readFileSync(join(dir, f), "utf8")) : 0);
  return { dir, script, config: (c) => writeFileSync(join(dir, "stub-config.json"), JSON.stringify(c)), count: () => n("count.txt"), wireCount: () => n("wire-count.txt"), captures: () => (existsSync(join(dir, "capture.jsonl")) ? readFileSync(join(dir, "capture.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []), reset: () => { for (const f of ["count.txt", "capture.jsonl", "wire-count.txt", "wire-capture.jsonl"]) rmSync(join(dir, f), { force: true }); } };
}

function main(): void {
  const scratch = mkdtempSync(join(tmpdir(), "ar-"));
  const upstreams = join(scratch, "upstream");
  mkdirSync(upstreams);
  const c1 = makeCaseUpstream(upstreams, "alpha", {});
  const c2 = makeCaseUpstream(upstreams, "beta", {});
  const c3 = makeCaseUpstream(upstreams, "gamma", { refactorBeforeFix: true });
  const c4 = makeCaseUpstream(upstreams, "delta", {}); // post-cutoff column, anchor by hunk
  const c6 = makeMovedUpstream(upstreams, "theta"); // blame names a commit whose diff does not add the anchor line
  const k1 = makeCleanUpstream(upstreams, "epsilon", true);
  const k2 = makeCleanUpstream(upstreams, "zeta", false);
  const casesTsv = join(scratch, "cases.tsv");
  writeFileSync(casesTsv, ["set\tcase\trepo\tfixCommit\tparentCommit\tpath\tanchor",
    `held-out\t01\talpha\t${c1.fix}\t${c1.parent}\tsrc/routes/items.ts\t${c1.anchor}`,
    `held-out\t02\tbeta\t${c2.fix}\t${c2.parent}\tsrc/routes/items.ts\t${c2.anchor}`,
    `held-out\t03\tgamma\t${c3.fix}\t${c3.parent}\tsrc/routes/items.ts\t${c3.anchor}`,
    `held-out\t04\ttheta\t${c6.fix}\t${c6.parent}\tsrc/routes/items.ts\t${c6.anchor}`,
    `post-cutoff\t01\tdelta\t${c4.fix}\t${c4.parent}\tsrc/routes/items.ts\thunk`,
    `clean\t01\tepsilon\t${k1.head}\t\tserver/routes.ts\t`,
    `clean\t02\tzeta\t${k2.head}\t\tserver/routes.ts\t`, ""].join("\n"));
  // The neutral root: a short random name under the scratch dir, which names nothing.
  const root = join(scratch, "r");
  const mirrors = join(scratch, "m");
  const manifestFile = join(scratch, "prepared.json");

  out.write("\nA. preparation\n");
  const prep = run(PREP, ["--cases", casesTsv, "--mirrors", mirrors, "--root", root, "--out", manifestFile, "--repo-url-template", `file:///${upstreams.replace(/\\/g, "/")}/{repo}`]);
  if (prep.status === 0 && existsSync(manifestFile)) pass("prepare exited 0 and wrote the manifest");
  else { fail(`prepare: status ${prep.status}: ${prep.stdout}${prep.stderr}`); out.write(`\nFAIL: agentic-review rehearsal (${failures} failure(s))\n`); process.exit(1); }
  const M = JSON.parse(readFileSync(manifestFile, "utf8")) as PreparedManifest;
  const byCase = (set: string, c: string) => M.cases.find((x) => x.set === set && x.case === c)!;
  const a1 = byCase("held-out", "01"), a3 = byCase("held-out", "03"), p1 = byCase("post-cutoff", "01");
  if (a1.accepted && a1.introducing === c1.introducing && a1.introducingParent) pass("blame names the commit that added the unguarded handler as I, and I's diff adds the anchor line");
  else fail(`case 01: accepted ${a1.accepted} I ${a1.introducing} expected ${c1.introducing} ${a1.rejection ?? ""}`);
  const w = a1.files[0]!.window, aI = a1.files[0]!.anchorAtI;
  if (w && aI && w[0] <= aI && aI <= w[1] && w[0] >= 2 && w[1] - w[0] < 20) pass(`the defect window [${w[0]}, ${w[1]}] encloses the anchor at I (${aI}) and is the handler block plus padding`);
  else fail(`window ${JSON.stringify(w)} anchor ${aI}`);
  if (a1.states.vulnerable && a1.states.fix && a1.treeAtWork.vulnerable !== a1.treeAtWork.fix) pass("case 01 has a vulnerable state and a fix state with different trees");
  else fail(`case 01 states ${JSON.stringify(a1.states)}`);
  if (a3.accepted && a3.states.vulnerable && !a3.states.fix && /does not apply/.test(a3.fixSideNote ?? "")) pass("case 03, whose fix patch does not apply to I's tree, has no fix side and says why");
  else fail(`case 03: ${JSON.stringify({ accepted: a3.accepted, states: a3.states, note: a3.fixSideNote, rejection: a3.rejection })}`);
  if (p1.accepted && p1.files[0]!.anchorAtParent === c4.anchor && p1.states.fix) pass(`the post-cutoff case's anchor from the fix's first hunk equals the parent-side line (${c4.anchor})`);
  else fail(`post-cutoff anchor ${p1.files[0]!.anchorAtParent} expected ${c4.anchor}, accepted ${p1.accepted}`);
  const a4 = byCase("held-out", "04");
  if (!a4.accepted && a4.introducing === c6.introducing && /INTRODUCTION-AMBIGUOUS/.test(a4.rejection ?? "") && !a4.states.vulnerable) pass("a case whose blamed commit adds the line under another path is rejected by the blame rule and gets no state");
  else fail(`case 04: accepted ${a4.accepted} I ${a4.introducing} expected ${c6.introducing} rejection ${a4.rejection} states ${JSON.stringify(a4.states)}`);
  const k1m = M.clean.find((k) => k.case === "01")!, k2m = M.clean.find((k) => k.case === "02")!;
  if (k1m.commit === k1.expected && k1m.routeShaped) pass("the clean rule picks the newest route-shaped commit before the cut-off, not the later one");
  else fail(`clean 01 picked ${k1m.commit} expected ${k1.expected} routeShaped ${k1m.routeShaped}`);
  if (k2m.commit === k2.expected && !k2m.routeShaped) pass("with no route-shaped change the clean rule falls back to the newest commit and says so");
  else fail(`clean 02 picked ${k2m.commit} expected ${k2.expected} routeShaped ${k2m.routeShaped}`);
  // Neutral repositories, and no upstream trace.
  const stateDirs = readdirSync(root).filter((d) => !d.endsWith(".origin.git"));
  let neutralBad = 0, traceBad = 0;
  const fmt = "--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%aI%x00%cI%x00%s";
  for (const d of stateDirs) {
    const dir = join(root, d);
    const facts = { workLog: git(dir, ["log", fmt, "work"]).split("\n").filter(Boolean), originHeadLog: git(dir, ["log", fmt, "origin/HEAD"]).split("\n").filter(Boolean), remotes: git(dir, ["remote", "-v"]).split("\n").filter((l) => l.endsWith("(fetch)")).map((l) => l.replace(/\s+\(fetch\)$/, "")), status: git(dir, ["status", "--porcelain"]) };
    if (checkNeutralRepo(facts, dir + ".origin.git").length) neutralBad++;
    const all = git(dir, ["log", "--all", "--format=%an %ae %s %aI"]) + git(dir, ["reflog", "--format=%gs %an"]);
    if (/Upstream|upstream\.example|GHSA|feat\(|fix\(|refactor|docs:|-10[12]\)/.test(all)) traceBad++;
    if (!existsSync(join(dir, "src")) && !existsSync(join(dir, "server"))) traceBad++;
  }
  if (stateDirs.length === 9 && neutralBad === 0) pass(`all ${stateDirs.length} prepared repositories are neutral: two commits on work, one on origin/HEAD, '${NEUTRAL.name}' and 2000-01-01 throughout, a local origin, a clean tree`);
  else fail(`neutral check: ${stateDirs.length} dirs, ${neutralBad} not neutral`);
  // The neutral check refuses a repository that is not neutral: one negative per property, built from a real state's facts.
  const d0 = join(root, stateDirs[0]!);
  const f0 = { workLog: git(d0, ["log", fmt, "work"]).split("\n").filter(Boolean), originHeadLog: git(d0, ["log", fmt, "origin/HEAD"]).split("\n").filter(Boolean), remotes: git(d0, ["remote", "-v"]).split("\n").filter((l) => l.endsWith("(fetch)")).map((l) => l.replace(/\s+\(fetch\)$/, "")), status: git(d0, ["status", "--porcelain"]) };
  const swap = (line: string, field: number, value: string) => line.split("\0").map((x, i) => (i === field ? value : x)).join("\0");
  const negatives: Array<[string, typeof f0]> = [
    ["a third commit on work", { ...f0, workLog: [...f0.workLog, f0.workLog[0]!] }],
    ["an upstream author", { ...f0, workLog: [swap(f0.workLog[0]!, 1, UPSTREAM_AUTHOR), f0.workLog[1]!] }],
    ["an upstream commit message", { ...f0, workLog: [swap(f0.workLog[0]!, 7, "fix(security): require authentication"), f0.workLog[1]!] }],
    ["a real date", { ...f0, workLog: [swap(f0.workLog[0]!, 5, "2026-06-15T10:00:00Z"), f0.workLog[1]!] }],
    ["an origin pointing at the upstream", { ...f0, remotes: [`origin\t${c1.dir}`] }],
    ["a dirty working tree", { ...f0, status: "?? stray.txt\n" }],
  ];
  if (checkNeutralRepo(f0, d0 + ".origin.git").length === 0) pass("the neutral check accepts the real state it is about to be shown a broken copy of");
  else fail(`neutral control: ${checkNeutralRepo(f0, d0 + ".origin.git").join("; ")}`);
  for (const [name, facts] of negatives) (checkNeutralRepo(facts, d0 + ".origin.git").length > 0 ? pass : fail)(`the neutral check refuses ${name}`);
  if (traceBad === 0) pass("no prepared repository carries an upstream author, message, advisory id or issue number in any ref or reflog");
  else fail(`${traceBad} repositories carry an upstream trace`);
  const manifestText = readFileSync(manifestFile, "utf8");
  if (!manifestText.includes(MARKER) && !manifestText.includes("requireAuth") && !manifestText.includes("Router()")) pass("the manifest holds identifiers, windows and hashes, no file contents");
  else fail("the manifest carries file contents");
  // A3: a blob that cannot be fetched (a blob:none mirror whose remote is gone) stops the preparation; it is never a rejection or a missing fix side.
  const c5 = makeCaseUpstream(upstreams, "eta", {});
  git(c5.dir, ["config", "uploadpack.allowFilter", "true"]);
  const mirrorsNet = join(scratch, "m-net");
  mkdirSync(mirrorsNet);
  git(scratch, ["clone", "-q", "--bare", "--filter=blob:none", `file:///${c5.dir.replace(/\\/g, "/")}`, join(mirrorsNet, "eta.git")]);
  const promisor = git(join(mirrorsNet, "eta.git"), ["config", "--get", "remote.origin.promisor"]).trim();
  renameSync(c5.dir, c5.dir + "-gone");
  const netTsv = join(scratch, "cases-net.tsv"), netOut = join(scratch, "prepared-net.json");
  writeFileSync(netTsv, ["set\tcase\trepo\tfixCommit\tparentCommit\tpath\tanchor", `held-out\t01\teta\t${c5.fix}\t${c5.parent}\tsrc/routes/items.ts\t${c5.anchor}`, ""].join("\n"));
  const pn = run(PREP, ["--cases", netTsv, "--mirrors", mirrorsNet, "--root", join(scratch, "r-net"), "--out", netOut, "--repo-url-template", `file:///${upstreams.replace(/\\/g, "/")}/{repo}`]);
  if (promisor === "true" && pn.status === 3 && /promisor remote/.test(pn.stderr) && !existsSync(netOut)) pass("A3: a blob the mirror cannot fetch stops the preparation with exit 3 and no manifest, instead of rejecting the case");
  else fail(`A3 network: promisor ${promisor}, status ${pn.status}, manifest ${existsSync(netOut)}: ${pn.stdout.slice(-300)} ${pn.stderr.slice(-300)}`);
  // Resume: a complete manifest is never resumed; a partial one keeps every finished record whose states exist and prepares the rest.
  const urlArg = ["--repo-url-template", `file:///${upstreams.replace(/\\/g, "/")}/{repo}`];
  const rcomp = run(PREP, ["--cases", casesTsv, "--mirrors", mirrors, "--root", root, "--out", manifestFile, "--resume", ...urlArg]);
  if (rcomp.status === 3 && /is a complete manifest/.test(rcomp.stdout)) pass("resume refuses a complete manifest"); else fail(`resume on complete: ${rcomp.status} ${rcomp.stdout.slice(-200)}`);
  const partialFile = join(scratch, "prepared-partial.json");
  writeFileSync(partialFile, JSON.stringify({ ...M, complete: false, clean: M.clean.slice(0, 1) }));
  const rp = run(PREP, ["--cases", casesTsv, "--mirrors", mirrors, "--root", root, "--out", partialFile, "--resume", ...urlArg]);
  const P1 = existsSync(partialFile) ? (JSON.parse(readFileSync(partialFile, "utf8")) as PreparedManifest) : null;
  const reusedLines = (rp.stdout.match(/\(reused\)/g) ?? []).length;
  if (rp.status === 0 && P1?.complete === true && reusedLines === M.cases.length + 1 && JSON.stringify(P1.cases) === JSON.stringify(M.cases) && P1.clean[0]!.state === M.clean[0]!.state && P1.clean[1]!.state && P1.clean[1]!.state !== M.clean[1]!.state && existsSync(join(root, P1.clean[1]!.state)))
    pass(`resume reuses the ${reusedLines} finished records unchanged, prepares only the missing one into a new state, and marks the manifest complete`);
  else fail(`resume: status ${rp.status}, complete ${P1?.complete}, reused ${reusedLines}: ${rp.stdout.slice(-300)} ${rp.stderr.slice(-300)}`);
  // A record whose state directory is gone is prepared again, not reused.
  const goneFile = join(scratch, "prepared-gone.json");
  writeFileSync(goneFile, JSON.stringify({ ...M, complete: false, clean: [{ ...M.clean[0]!, state: "deadbeef" }] }));
  const rg = run(PREP, ["--cases", casesTsv, "--mirrors", mirrors, "--root", root, "--out", goneFile, "--resume", ...urlArg]);
  const P2 = existsSync(goneFile) ? (JSON.parse(readFileSync(goneFile, "utf8")) as PreparedManifest) : null;
  if (rg.status === 0 && P2?.clean[0]!.state && P2.clean[0]!.state !== "deadbeef" && existsSync(join(root, P2.clean[0]!.state))) pass("a record naming a state directory that no longer exists is prepared again");
  else fail(`resume with a missing state: status ${rg.status}, state ${P2?.clean[0]?.state}: ${rg.stdout.slice(-200)}`);

  out.write("\nB. scoring, as functions\n");
  const md = "# Vuln 1: missing_authorization: `src/routes/items.ts:7`\n\n* Severity: High\n* Description: no auth\n\n# Vuln 2: xss: `web/app.tsx:12`\n\n* Severity: Medium\n* Description: reflected\n";
  const fs = parseFindings(md);
  if (fs.length === 2 && fs[0]!.file === "src/routes/items.ts" && fs[0]!.line === 7 && fs[0]!.category === "missing_authorization" && fs[1]!.severity === "Medium") pass("the findings parser reads file, line, category and severity from the built-in's markdown shape");
  else fail(`findings parsed: ${JSON.stringify(fs)}`);
  const files = [{ path: "src/routes/items.ts", anchorAtParent: 7, anchorAtI: 7, blame: "x", presentAtI: true, window: [4, 12] as [number, number] }];
  const hits = [
    [runHit(fs, files).hit, true, "right file, line in window, access-control category"],
    [runHit(parseFindings("# Vuln 1: missing_authorization: `src/routes/items.ts:40`\n"), files).hit, false, "line outside the window"],
    [runHit(parseFindings("# Vuln 1: missing_authorization: `src/routes/other.ts:7`\n"), files).hit, false, "another file"],
    [runHit(parseFindings("# Vuln 1: sql_injection: `src/routes/items.ts:7`\n* Description: string concatenation\n"), files).hit, false, "not an access-control category"],
    [runHit(parseFindings("# Vuln 1: broken_object_level: `src/routes/items.ts:7`\n* Description: any user can read another user's item (IDOR)\n"), files).hit, true, "an access-control word in the description"],
  ] as const;
  for (const [got, want, name] of hits) (got === want ? pass : fail)(`hit rule: ${name} -> ${got}`);
  const man = (n: number, fixSides = n): PreparedManifest => ({ version: 1, preparedAt: "", root: "/r", cases: Array.from({ length: n }, (_, i) => ({ set: "held-out" as const, case: String(i + 1).padStart(2, "0"), repo: "x", fixCommit: "f", parentCommit: "p", introducing: "i", introducingParent: "ip", accepted: true, rejection: null, files, states: { vulnerable: `v${i}`, fix: i < fixSides ? `f${i}` : null }, fixSideNote: null, treeAtWork: { vulnerable: "t", fix: i < fixSides ? "t2" : null }, diffStats: null })), clean: Array.from({ length: 10 }, (_, i) => ({ case: String(i + 1), repo: "x", path: "p", commit: "c", commitParent: "cp", routeShaped: true, rejection: null, state: `k${i}`, treeAtWork: "t" })) });
  const recsFor = (m: PreparedManifest, hitCases: number, cleanFlagged: number, fixHitsOnFirst = 0, vulnHitRuns = 4): RunRecord[] => {
    const r: RunRecord[] = [];
    m.cases.forEach((c, i) => { for (let run = 1; run <= RUNS; run++) { const hit = i < hitCases && run <= vulnHitRuns; r.push({ set: c.set, case: c.case, state: "vulnerable", run, voided: false, findings: hit ? fs : [], hit, anyFinding: hit }); if (c.states.fix) { const fh = i === 0 && run <= fixHitsOnFirst; r.push({ set: c.set, case: c.case, state: "fix", run, voided: false, findings: fh ? fs : [], hit: fh, anyFinding: fh }); } } });
    m.clean.forEach((k, i) => { for (let run = 1; run <= RUNS; run++) { const f = i < cleanFlagged && run <= 4; r.push({ set: "clean", case: k.case, state: "clean", run, voided: false, findings: f ? fs : [], hit: false, anyFinding: f }); } });
    return r;
  };
  const gate = (m: PreparedManifest, r: RunRecord[], voided = false) => gateA(m, scoreCases(m, r), scoreClean(m, r), voided).label;
  const g = [
    [gate(man(10), recsFor(man(10), GATE_A_MIN_HITS, GATE_A_MAX_CLEAN_FLAGS)), "AGENTIC-CONTINUE", `${GATE_A_MIN_HITS} hits and ${GATE_A_MAX_CLEAN_FLAGS} clean flags continue`],
    [gate(man(10), recsFor(man(10), GATE_A_MIN_HITS - 1, 0)), "AGENTIC-STOP", `${GATE_A_MIN_HITS - 1} hits stop`],
    [gate(man(10), recsFor(man(10), 10, GATE_A_MAX_CLEAN_FLAGS + 1)), "AGENTIC-STOP", `${GATE_A_MAX_CLEAN_FLAGS + 1} clean flags stop even with 10 hits`],
    [gate(man(10), recsFor(man(10), 10, 0, 2)), "AGENTIC-CONTINUE", "2 of 5 fix-side hits on one case drop that case (9 hits) and still continue"],
    [scoreCases(man(10), recsFor(man(10), 10, 0, 2))[0]!.hit, false, "a case flagged on 2 of 5 fix-side runs is not a hit"],
    [gate(man(10, 6), recsFor(man(10, 6), 10, 0)), "AGENTIC-CONTINUE", "4 cases without a fix side count as misses; 6 hits continue"],
    [scoreCases(man(10, 6), recsFor(man(10, 6), 10, 0))[9]!.hit, false, "a case without a fix side is never a hit (A1 3.1)"],
    [scoreCases(man(10), recsFor(man(10), 10, 0, 0, 3))[0]!.hit, false, "a case flagged on 3 of 5 vulnerable runs is not a hit"],
    [gate(man(10), recsFor(man(10), 10, 0, 0, 3)), "AGENTIC-STOP", "10 cases each flagged on 3 of 5 vulnerable runs are 0 hits and stop"],
    [gate(man(7), recsFor(man(7), 7, 0)), "AGENTIC-PRECONDITION-FAILED", "7 accepted cases fail the precondition"],
    [gate(man(10), recsFor(man(10), 10, 0).slice(0, -1)), "AGENTIC-INCOMPLETE", "one missing run is incomplete"],
    [gate(man(10), recsFor(man(10), 10, 0), true), "AGENTIC-STOP", "a voided series stops"],
  ] as const;
  for (const [got, want, name] of g) (got === want ? pass : fail)(`gate: ${name} -> ${String(got)}`);
  const sample = defectWindow("a\nfunction f() {\n  x();\n  y();\n}\nz();\n", 3);
  if (sample[0] === 1 && sample[1] === 7) pass(`defectWindow on a small function returns the block plus padding, clipped to the file (${sample.join("-")})`);
  else fail(`defectWindow ${sample.join("-")}`);

  out.write("\nC. the harness with the stub\n");
  const stub = makeStub();
  const recorderOut = join(scratch, "rec");
  const recRun = run(HARNESS, ["--prepared", manifestFile, "--out", recorderOut, "--stub", stub.script, "--recorder-check", join(root, a1.states.vulnerable!)]);
  const recFile = join(recorderOut, "recorded-tools.json");
  const recorded = existsSync(recFile) ? (JSON.parse(readFileSync(recFile, "utf8")) as { tools: string[]; harnessPromptReachedWire: boolean }) : null;
  if (recRun.status === 0 && recorded && recorded.tools.join(",") === "Bash,Glob,Grep,LS,Read,Task" && recorded.harnessPromptReachedWire) pass("the recorder check records the tool list from the wire and sees the harness prompt there");
  else fail(`recorder check: status ${recRun.status} ${JSON.stringify(recorded)} ${recRun.stdout}`);
  const common = (o: string, extra: string[] = []) => ["--prepared", manifestFile, "--out", o, "--stub", stub.script, "--expect-tools", recFile, ...extra];
  stub.reset();
  stub.config({ marker: MARKER });
  const dirC = join(scratch, "c-marker");
  const c = run(HARNESS, common(dirC));
  const rc = existsSync(join(dirC, "results.json")) ? (JSON.parse(readFileSync(join(dirC, "results.json"), "utf8")) as { gate: { label: string; heldOutHits: number; cleanFlags: number; postCutoffHits: number }; cases: Array<{ case: string; set: string; hit: boolean; hasFixSide: boolean }>; judged: number; planned: number }) : null;
  const planned = (M.cases.filter((x) => x.accepted).reduce((a, x) => a + (x.states.vulnerable ? 1 : 0) + (x.states.fix ? 1 : 0), 0) + M.clean.filter((k) => k.state).length) * RUNS;
  if (c.status === 0 && rc && rc.judged === planned && stub.count() === planned) pass(`exit 0: ${planned} runs = ${planned / RUNS} states x ${RUNS}, ${stub.count()} processes`);
  else fail(`marker run: status ${c.status}, judged ${rc?.judged}, calls ${stub.count()}: ${c.stdout.slice(-600)}${c.stderr.slice(-300)}`);
  if (rc && rc.gate.heldOutHits === 2 && rc.gate.cleanFlags === 0 && rc.gate.postCutoffHits === 1 && rc.cases.find((x) => x.case === "03" && x.set === "held-out")!.hit === false) pass("marker stub: held-out 01 and 02 hit, 03 (no fix side) a miss, post-cutoff 1 of 1, clean 0 flagged");
  else fail(`marker scoring: ${JSON.stringify(rc?.gate)} ${JSON.stringify(rc?.cases)}`);
  if (rc && rc.gate.label === "STUB/AGENTIC-PRECONDITION-FAILED".replace("STUB/", "") && /^STUB\/AGENTIC-PRECONDITION-FAILED/m.test(c.stdout)) pass("with 3 held-out cases the gate reports its precondition and no CONTINUE or STOP, and the label is marked STUB");
  else fail(`label: ${rc?.gate.label}; stdout ${c.stdout.split("\n").find((l) => /AGENTIC/.test(l))}`);
  if (!/hit|AGENTIC-(CONTINUE|STOP)/.test(c.stdout.split("STUB/AGENTIC")[0] ?? "")) pass("nothing printed before the label line names a hit, a count or a verdict");
  else fail("a verdict word was printed before completion");
  const capsC = stub.captures();
  stub.reset();
  stub.config({ marker: MARKER, flagAll: true });
  const dirF = join(scratch, "c-flagall");
  const f = run(HARNESS, common(dirF));
  const rf = existsSync(join(dirF, "results.json")) ? (JSON.parse(readFileSync(join(dirF, "results.json"), "utf8")) as { gate: { heldOutHits: number; cleanFlags: number; postCutoffHits: number } }) : null;
  if (f.status === 0 && rf && rf.gate.heldOutHits === 0 && rf.gate.postCutoffHits === 0 && rf.gate.cleanFlags === 2) pass("flag-everything stub: every fix side is flagged too, so no case is a hit, and both clean changes are flagged");
  else fail(`flagAll: status ${f.status} ${JSON.stringify(rf?.gate)}`);

  out.write("\nD. blindness\n");
  const argvWant = JSON.stringify(harnessArgv("claude-opus-5-5", "high"));
  // LOGONSERVER and USERDOMAIN are added by Windows to every child process, even one started with env {PATH} only.
  const envWant = new Set(["LOGONSERVER", "USERDOMAIN", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "DISABLE_AUTOUPDATER", "CLAUDE_CODE_MAX_OUTPUT_TOKENS", "CLAUDE_CODE_SUBAGENT_MODEL", "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "COMSPEC", "WINDIR", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "TEMP", "TMP", "TMPDIR", "USERNAME", "USER", "LANG", "LC_ALL", "TERM", "SHELL", "XDG_CONFIG_HOME", "CLAUDE_CONFIG_DIR"]);
  const leaks = ["held-out", "post-cutoff", "GHSA", "advisory", "anchor", "alpha", "beta", "gamma", "delta", "epsilon", "zeta", upstreams, REPO, "Upstream", "prepared.json", "-101", "-102", "requireAuth(req);\n  const item"];
  const e = { argv: 0, env: 0, cwd: 0, stdin: 0, leak: 0, prompt: 0 };
  const envBad = new Set<string>();
  const bodyLF = readFileSync(PROMPT, "utf8").replace(/\r\n/g, "\n");
  for (const cap of capsC) {
    if (JSON.stringify(cap.argv) !== argvWant) e.argv++;
    for (const k of Object.keys(cap.env)) if (!envWant.has(k.toUpperCase()) || /^(ANTHROPIC_|AWS_|FIXOR_)/i.test(k)) { e.env++; envBad.add(k); }
    if (cap.env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] !== "32000" || cap.env["CLAUDE_CODE_SUBAGENT_MODEL"] !== "claude-opus-5-5") e.env++;
    const cwd = resolve(cap.cwd);
    if (!cwd.startsWith(resolve(root)) || !readdirSync(root).includes(cwd.slice(resolve(root).length + 1))) e.cwd++;
    if (!cap.stdin.startsWith("You are a senior security engineer") || !cap.stdin.includes("GIT STATUS:") || cap.stdin.includes("!`git") || !cap.stdin.includes("diff --git")) e.stdin++;
    if (!bodyLF.includes("Your final reply must contain the markdown report and nothing else.") || !cap.stdin.trim().endsWith("Your final reply must contain the markdown report and nothing else.")) e.prompt++;
    const everything = cap.argv.join("\0") + "\0" + cap.stdin + "\0" + cap.cwd + "\0" + Object.entries(cap.env).filter(([k]) => k.toUpperCase() !== "PATH").map(([, v]) => v).join("\0");
    for (const s of leaks) if (s && everything.includes(s)) e.leak++;
  }
  if (capsC.length === planned && e.argv === 0) pass(`argv is byte-for-byte the pinned list on all ${capsC.length} runs: --tools ${harnessArgv("x", "y")[harnessArgv("x", "y").indexOf("--tools") + 1]}, no network tool`);
  else fail(`argv differed on ${e.argv} of ${capsC.length}`);
  if (e.env === 0) pass("the environment is the whitelist plus CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000 and CLAUDE_CODE_SUBAGENT_MODEL, nothing credential-shaped");
  else fail(`environment violated on ${e.env} runs: ${[...envBad].join(", ")}`);
  if (e.cwd === 0) pass("every cwd is a prepared state directory under the neutral root");
  else fail(`cwd violated on ${e.cwd} runs`);
  if (e.stdin === 0 && e.prompt === 0) pass("stdin is the built-in's body with its four git commands expanded, ending with the built-in's last line");
  else fail(`stdin violated on ${e.stdin + e.prompt} runs`);
  if (e.leak === 0) pass("no case id, set name, advisory, anchor, upstream path, upstream message or repository path reached argv, stdin, cwd or env");
  else fail(`${e.leak} leak(s)`);

  out.write("\nE. guards\n");
  const refusals: Array<{ name: string; env?: Record<string, string>; extra?: string[]; args?: string[]; expect: RegExp }> = [
    { name: "ANTHROPIC_API_KEY in the environment", env: { ANTHROPIC_API_KEY: "sk-ant-not-a-real-key" }, expect: /ANTHROPIC_API_KEY is set/ },
    { name: "a Fable model", extra: ["--model", "claude-fable-5-1"], expect: /Fable model bills usage credits/ },
    { name: "no --stub and no --claude", args: ["--prepared", manifestFile, "--out", join(scratch, "x1"), "--expect-tools", recFile], expect: /--claude <path> with --claude-sha256/ },
    { name: "--claude without a pin", args: ["--prepared", manifestFile, "--out", join(scratch, "x2"), "--expect-tools", recFile, "--claude", stub.script], expect: /--claude-sha256 <64 hex> is required/ },
    { name: "a wrong pin", args: ["--prepared", manifestFile, "--out", join(scratch, "x3"), "--expect-tools", recFile, "--claude", stub.script, "--claude-sha256", "0".repeat(64)], expect: /not the pinned/ },
    { name: "no recorded tool list", args: ["--prepared", manifestFile, "--out", join(scratch, "x4"), "--stub", stub.script], expect: /--expect-tools <recorded-tools.json> is required/ },
    { name: "a prepared root inside the repository", args: ["--prepared", (() => { const p = join(scratch, "bad.json"); writeFileSync(p, JSON.stringify({ ...M, root: join(REPO, "tmp-ar") })); return p; })(), "--out", join(scratch, "x5"), "--stub", stub.script, "--expect-tools", recFile], expect: /inside the repository or names/ },
    { name: "a partial prepared manifest", args: ["--prepared", (() => { const p = join(scratch, "partial-for-harness.json"); writeFileSync(p, JSON.stringify({ ...M, complete: false })); return p; })(), "--out", join(scratch, "x6"), "--stub", stub.script, "--expect-tools", recFile], expect: /manifest is partial/ },
  ];
  const modifiedPrompt = join(scratch, "prompt-modified.md");
  writeFileSync(modifiedPrompt, readFileSync(PROMPT, "utf8").replace("Below 0.7: Don't report", "Below 0.5: Don't report"));
  refusals.push({ name: "a changed prompt text", extra: ["--prompt", modifiedPrompt], expect: /prompt body's sha256 is .*, pinned/ });
  for (const r of refusals) {
    stub.reset();
    const args = r.args ?? common(join(scratch, `refuse-${refusals.indexOf(r)}`), r.extra ?? []);
    const res = run(HARNESS, args, r.env);
    if (res.status === 3 && r.expect.test(res.stdout + res.stderr) && stub.count() === 0 && stub.wireCount() === 0) pass(`${r.name}: exit 3, no process started`);
    else fail(`${r.name}: status ${res.status}, calls ${stub.count()}, wire ${stub.wireCount()}: ${res.stdout}${res.stderr}`);
  }
  if (!existsSync(join(REPO, "tmp-ar"))) pass("the refused root was not created inside the repository"); else fail("a directory was created inside the repository");
  const voids: Array<{ name: string; cfg: Record<string, unknown>; expect: RegExp }> = [
    { name: "a tool outside the set (WebFetch)", cfg: { marker: MARKER, extraTool: "WebFetch" }, expect: /voided by a tool call outside the allowed set or reaching outside the repository \(WebFetch\)/ },
    { name: "a Bash command that is not an allowed git read", cfg: { marker: MARKER, extraBash: "curl http://example.invalid" }, expect: /voided by a tool call outside the allowed set or reaching outside the repository \(Bash curl/ },
    { name: "a Bash chain whose second part is not allowed", cfg: { marker: MARKER, extraBash: "git status && cat /etc/passwd" }, expect: /voided by a tool call/ },
    // A3: reaching outside the run's repository (the sibling states, the mirrors, this checkout).
    { name: "A3: a Read of an absolute path outside the repository (the state root)", cfg: { marker: MARKER, extraUse: { name: "Read", input: { file_path: join(root, "x.txt") } } }, expect: /reaching outside the repository \(Read / },
    { name: "A3: a Glob whose pattern climbs out with ..", cfg: { marker: MARKER, extraUse: { name: "Glob", input: { pattern: "../**/*.ts" } } }, expect: /reaching outside the repository \(Glob / },
    { name: "A3: a Grep in a home path", cfg: { marker: MARKER, extraUse: { name: "Grep", input: { pattern: "requireAuth", path: "~/projects" } } }, expect: /reaching outside the repository \(Grep / },
    { name: "A3: git diff --no-index", cfg: { marker: MARKER, extraBash: "git diff --no-index a.ts b.ts" }, expect: /reaching outside the repository \(Bash git diff --no-index/ },
    { name: "A3: a git read naming a path above the repository", cfg: { marker: MARKER, extraBash: "git log --oneline -- ../other" }, expect: /reaching outside the repository \(Bash git log/ },
  ];
  for (const v of voids) {
    stub.reset(); stub.config(v.cfg);
    const d = join(scratch, `void-${voids.indexOf(v)}`);
    const res = run(HARNESS, common(d));
    const runsDir = join(d, "runs");
    const files = existsSync(runsDir) ? readdirSync(runsDir) : [];
    const again = run(HARNESS, common(d));
    if (res.status === 2 && v.expect.test(res.stdout) && stub.count() === 1 && files.includes("VOID") && again.status === 3 && /voided/.test(again.stdout) && stub.count() === 1) pass(`${v.name}: run voided, series stopped on the first run with exit 2, and it does not resume`);
    else fail(`${v.name}: status ${res.status}/${again.status}, calls ${stub.count()}, files ${files.join(",")}: ${res.stdout.slice(-300)}`);
  }
  // A3 control: an absolute path INSIDE the run's repository and a dotted git range do not void.
  stub.reset(); stub.config({ marker: MARKER, extraUse: { name: "Read", input: { file_path: "{cwd}/src/routes/items.ts" } }, extraBash: "git diff --stat origin/HEAD... -- src/routes/items.ts" });
  const dIn = join(scratch, "inside");
  const rin = run(HARNESS, common(dIn));
  if (rin.status === 0 && !/voided/i.test(rin.stdout) && !existsSync(join(dIn, "runs", "VOID"))) pass("A3 control: a Read of an absolute path inside the repository and a dotted git range are not voided");
  else fail(`A3 control: status ${rin.status}: ${rin.stdout.slice(-300)}`);
  // A state that stopped being neutral after preparation (a third commit, same tree, neutral identity) is refused before it is run.
  const vDir = join(root, a1.states.vulnerable!);
  const neutralEnv = { ...process.env, GIT_AUTHOR_NAME: NEUTRAL.name, GIT_AUTHOR_EMAIL: NEUTRAL.email, GIT_COMMITTER_NAME: NEUTRAL.name, GIT_COMMITTER_EMAIL: NEUTRAL.email, GIT_AUTHOR_DATE: NEUTRAL.date, GIT_COMMITTER_DATE: NEUTRAL.date };
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", NEUTRAL.message], { cwd: vDir, env: neutralEnv });
  stub.reset(); stub.config({ marker: MARKER });
  const dn = join(scratch, "not-neutral");
  const rn = run(HARNESS, common(dn));
  const nRecs = existsSync(join(dn, "runs")) ? readdirSync(join(dn, "runs")).filter((x) => x.startsWith(a1.states.vulnerable!)) : [];
  execFileSync("git", ["reset", "-q", "--hard", "HEAD~1"], { cwd: vDir, env: neutralEnv });
  if (rn.status === 2 && /is not neutral or not clean: work branch has 3 commits/.test(rn.stdout) && nRecs.length === 0) pass("a prepared state that gained a commit is refused before it is run, with no record for it");
  else fail(`not-neutral state: status ${rn.status}, records ${nRecs.join(",")}: ${rn.stdout.slice(-300)}`);
  stub.reset(); stub.config({ marker: MARKER, reportModel: "claude-sonnet-4-6" });
  const dm = join(scratch, "mismatch");
  const m = run(HARNESS, common(dm));
  const mm = existsSync(join(dm, "runs")) ? readdirSync(join(dm, "runs")) : [];
  const m2 = run(HARNESS, common(dm));
  if (m.status === 2 && /model mismatch/.test(m.stdout) && mm.some((x) => x.endsWith(".model-mismatch.json")) && !mm.some((x) => /-r\d\.json$/.test(x)) && m2.status === 3 && /model-mismatch file/.test(m2.stdout)) pass("an answer from another model stops the run on the first run, writes a mismatch file and no record, and blocks resume");
  else fail(`model mismatch: status ${m.status}/${m2.status}, files ${mm.join(",")}: ${m.stdout.slice(-300)}`);
  stub.reset(); stub.config({ marker: MARKER, writeFile: "stub-wrote-this.txt" });
  const dw = join(scratch, "writes");
  const wres = run(HARNESS, common(dw));
  const wfiles = existsSync(join(dw, "runs")) ? readdirSync(join(dw, "runs")) : [];
  if (wres.status === 2 && /changed during run/.test(wres.stdout) && wfiles.length === 0) pass("a run that writes into the repository stops with no record written");
  else fail(`tree change: status ${wres.status}, files ${wfiles.join(",")}: ${wres.stdout.slice(-300)}`);
  // Clean the repository the stub wrote into, so the state is reusable (the harness refuses a dirty tree).
  for (const d of stateDirs) rmSync(join(root, d, "stub-wrote-this.txt"), { force: true });
  stub.reset(); stub.config({ marker: MARKER, failAfter: 7 });
  const dr = join(scratch, "resume");
  const r1 = run(HARNESS, common(dr));
  const n1 = readdirSync(join(dr, "runs")).filter((x) => /-r\d\.json$/.test(x)).length;
  stub.config({ marker: MARKER });
  const r2 = run(HARNESS, common(dr));
  const n2 = readdirSync(join(dr, "runs")).filter((x) => /-r\d\.json$/.test(x)).length;
  if (r1.status === 2 && /infrastructure/.test(r1.stdout) && n1 === 7 && r2.status === 0 && n2 === planned && stub.count() === planned + 1) pass(`cut off after 7 runs: exit 2, 7 records; the same command resumes to ${planned} with the stub invoked ${planned + 1} times (one failed run)`);
  else fail(`resume: ${r1.status}/${r2.status}, records ${n1}/${n2}, calls ${stub.count()}: ${r1.stdout.slice(-200)} ${r2.stdout.slice(-200)}`);
  const wireRefusals: Array<{ name: string; wire: Record<string, unknown>; expect: RegExp }> = [
    { name: "a wrong cap on the wire", wire: { maxTokens: 128000 }, expect: /max_tokens on the wire is 128000, pinned 32000/ },
    { name: "a wrong model on the wire", wire: { model: "claude-sonnet-4-6" }, expect: /model on the wire is/ },
    { name: "a tool list that differs from the recorded one", wire: { tools: ["Read", "Glob", "Grep", "LS", "Task", "Bash", "WebFetch"] }, expect: /tools on the wire are/ },
    { name: "an x-api-key header", wire: { apiKeyHeader: true }, expect: /x-api-key header is sent/ },
    { name: "a non-OAuth bearer", wire: { auth: "Bearer not-the-login" }, expect: /authorization is bearer-other/ },
    { name: "another effort", wire: { effort: "medium" }, expect: /output_config on the wire is/ },
  ];
  for (const w of wireRefusals) {
    stub.reset(); stub.config({ marker: MARKER, wire: w.wire });
    const d = join(scratch, `wire-${wireRefusals.indexOf(w)}`);
    const res = run(HARNESS, common(d));
    if (res.status === 3 && w.expect.test(res.stdout) && stub.count() === 0 && stub.wireCount() === 1) pass(`${w.name}: refused before any run, one wire check`);
    else fail(`${w.name}: status ${res.status}, calls ${stub.count()}, wire ${stub.wireCount()}: ${res.stdout.slice(-300)}`);
  }
  if (sha256File(stub.script).length === 64) pass("sha256File hashes the stub (the pin path is exercised above with a wrong pin)"); else fail("sha256File");

  out.write("\nF. token volume per state, from the expanded prompts the stub received\n");
  const byToken = new Map<string, number>();
  for (const cap of capsC) { const t = resolve(cap.cwd).slice(resolve(root).length + 1); if (!byToken.has(t)) byToken.set(t, cap.stdin.length); }
  let total = 0;
  for (const [t, chars] of byToken) { total += chars; out.write(`  state ${t}: prompt ${chars} chars ~${estimateTokens(chars)} tokens\n`); }
  out.write(`  ${byToken.size} states, prompts total ~${estimateTokens(total)} tokens per run set; the agent's own reads come on top and are measured by the real run\n`);
  pass("token volume reported from the stub inputs (synthetic repositories; the real figure comes from the prepared real cases)");

  out.write(`\n${failures === 0 ? "PASS" : "FAIL"}: agentic-review rehearsal (${failures} failure(s))\n`);
  process.exit(failures === 0 ? 0 : 1);
}

try { main(); } catch (err) { process.stderr.write(`${(err as Error).stack ?? String(err)}\n`); process.exit(1); }
