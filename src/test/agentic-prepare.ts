/**
 * Agentic change review: case preparation. Pre-registration and amendment A1:
 *   docs/measurements/agentic-review-2026-10-02/
 *
 * For each case: mirror the repository, find the introducing commit I of the
 * first defect file by the blame rule, compute the defect windows at I, and
 * build the neutral repositories (A1 3.6, 3.7): commit 1 is I^'s tree, commit
 * 2 is I's tree (vulnerable) or I's tree plus the fix patch (fix side), both
 * with neutral author, committer, date and message, origin a local bare
 * repository whose HEAD is commit 1. For each clean row: the newest route-
 * shaped commit before 2026-09-28 (A1 3.2), prepared the same way.
 *
 * Reads public GitHub repositories with git only. Runs no detector, judge or
 * model. Writes the prepared manifest (identifiers, windows, tokens, tree
 * hashes) and nothing else into the repository tree when --out points there;
 * every third-party file stays under --mirrors and --root.
 *
 *   node dist/test/agentic-prepare.js --cases <tsv> --mirrors <dir> --root <neutral dir>
 *        --out <manifest.json> [--repo-url-template https://github.com/{repo}.git]
 *        [--clean-before 2026-09-28T00:00:00Z]
 *
 * Cases TSV columns: set, case, repo, fixCommit, parentCommit, path, anchor
 * (a parent-side line number, or `hunk` for the fix diff's first hunk). Clean
 * rows: set=clean, case, repo, head, path.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

import { NEUTRAL, ROUTE_SHAPE_RE, defectWindow, nonTestSource, type DefectFile, type PreparedCase, type PreparedClean, type PreparedManifest, type SetName } from "./lib/agentic-review";
import { WORK_ROOT_FORBIDDEN } from "./lib/proxy-judge";

const out = process.stdout;
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const NEUTRAL_ENV = { GIT_AUTHOR_NAME: NEUTRAL.name, GIT_AUTHOR_EMAIL: NEUTRAL.email, GIT_AUTHOR_DATE: NEUTRAL.date, GIT_COMMITTER_NAME: NEUTRAL.name, GIT_COMMITTER_EMAIL: NEUTRAL.email, GIT_COMMITTER_DATE: NEUTRAL.date, GIT_CONFIG_NOSYSTEM: "1" };

/** A blob fetch from the partial clone's remote failed: an infrastructure error, never a property of the case (A3). */
const NETWORK_RE = /promisor remote|unable to access|Could not resolve host|Empty reply from server|early EOF|RPC failed|Connection (?:reset|timed out|refused)/i;
const stderrOf = (e: unknown): string => String((e as { stderr?: string }).stderr ?? e);

/** Runs git; a network failure (the mirrors are blob:none, so reads fetch lazily) is retried up to three times, then thrown. */
function git(args: string[], cwd?: string, extraEnv: Record<string, string> = {}, input?: string): string {
  for (let attempt = 1; ; attempt++) {
    try { return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...NEUTRAL_ENV, ...extraEnv }, input }); }
    catch (e) {
      if (attempt >= 3 || !NETWORK_RE.test(stderrOf(e))) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000 * attempt);
    }
  }
}
/** Null when git fails on the data (a missing path, no parent); a network failure is never read as "absent" and stops the preparation. */
function gitTry(args: string[], cwd?: string): string | null {
  try { return git(args, cwd); }
  catch (e) { if (NETWORK_RE.test(stderrOf(e))) throw e; return null; }
}

interface Row { set: string; case: string; repo: string; fixCommit: string; parentCommit: string; path: string; anchor: string }
function readRows(file: string): Row[] {
  return readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).slice(1).map((l) => {
    const [set, c, repo, fixCommit, parentCommit, path, anchor] = l.split("\t");
    return { set: set!, case: c!, repo: repo!, fixCommit: fixCommit!, parentCommit: parentCommit ?? "", path: path ?? "", anchor: anchor ?? "" };
  });
}

/** Exports a commit's tree from the mirror into `dir` (which must exist and hold only .git). */
function exportTree(mirror: string, commitish: string, dir: string): void {
  const idx = join(mkdtempSync(join(tmpdir(), "ar-idx-")), "index");
  git(["read-tree", commitish], mirror, { GIT_INDEX_FILE: idx });
  git(["--work-tree=" + dir, "checkout-index", "-a", "-f"], mirror, { GIT_INDEX_FILE: idx });
  rmSync(idx, { force: true });
}
function clearWorkTree(dir: string): void {
  for (const e of readdirSync(dir)) if (e !== ".git") rmSync(join(dir, e), { recursive: true, force: true });
}
function commitAll(dir: string): string {
  git(["add", "-A", "-f"], dir);
  git(["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", NEUTRAL.message], dir);
  return git(["rev-parse", "HEAD"], dir).trim();
}

/**
 * Builds one neutral repository at `dir`: main = commit 1 (tree of `base`),
 * work = commit 2 (tree of `top`, or the tree `topTree` when given), origin a
 * bare clone beside it with HEAD at main. Returns the tree hash of commit 2.
 */
function buildState(mirror: string, base: string, top: string | null, topTree: string | null, dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(["init", "-q", "-b", "main", dir]);
  git(["config", "user.name", NEUTRAL.name], dir);
  git(["config", "user.email", NEUTRAL.email], dir);
  exportTree(mirror, base, dir);
  commitAll(dir);
  git(["checkout", "-q", "-b", "work"], dir);
  clearWorkTree(dir);
  exportTree(mirror, topTree ?? top!, dir);
  commitAll(dir);
  const originDir = dir + ".origin.git";
  git(["clone", "-q", "--bare", dir, originDir]);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], originDir);
  git(["remote", "add", "origin", originDir], dir);
  git(["fetch", "-q", "origin"], dir);
  git(["remote", "set-head", "origin", "main"], dir);
  return git(["rev-parse", "work^{tree}"], dir).trim();
}

/** Applies the fix patch for the defect files onto I's tree inside the mirror (a temporary worktree); returns the resulting tree, or null. */
function treeWithPatch(mirror: string, I: string, parent: string, fix: string, paths: string[]): { tree: string | null; note: string | null } {
  const patch = git(["diff", "--binary", parent, fix, "--", ...paths], mirror);
  if (!patch.trim()) return { tree: null, note: "the fix changes none of the defect files" };
  const wt = mkdtempSync(join(tmpdir(), "ar-wt-"));
  rmSync(wt, { recursive: true, force: true });
  try {
    git(["worktree", "add", "-q", "--detach", wt, I], mirror);
    try { git(["apply", "--3way", "--index", "-"], wt, {}, patch); }
    catch (e) {
      // A3: a failed blob fetch is not a missing fix side (which A1 3.1 scores as a miss); it stops the preparation.
      if (NETWORK_RE.test(stderrOf(e))) throw e;
      return { tree: null, note: `the fix patch does not apply to I's tree: ${stderrOf(e).split("\n")[0]?.slice(0, 160)}` };
    }
    return { tree: git(["write-tree"], wt).trim(), note: null };
  } finally {
    gitTry(["worktree", "remove", "--force", wt], mirror);
    rmSync(wt, { recursive: true, force: true });
  }
}

function main(): number {
  const casesFile = arg("--cases"), mirrors = arg("--mirrors"), root = arg("--root"), outFile = arg("--out");
  if (!casesFile || !mirrors || !root || !outFile) { out.write("usage: agentic-prepare --cases <tsv> --mirrors <dir> --root <neutral dir> --out <manifest.json> [--repo-url-template T] [--clean-before ISO]\n"); return 3; }
  const urlT = arg("--repo-url-template") ?? "https://github.com/{repo}.git";
  const cleanBefore = arg("--clean-before") ?? "2026-09-28T00:00:00Z";
  const repoRoot = process.cwd();
  const rootAbs = resolve(root);
  const inside = (c: string, p: string) => { const a = resolve(c).toLowerCase(), b = resolve(p).toLowerCase(); return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep); };
  if (inside(rootAbs, repoRoot)) { out.write(`refused: --root ${rootAbs} is inside the repository\n`); return 3; }
  if (WORK_ROOT_FORBIDDEN.test(rootAbs)) { out.write(`refused: --root ${rootAbs} names the product, the judge or a case set; the CLI shows the model its working directory\n`); return 3; }
  if (!isAbsolute(rootAbs)) { out.write("refused: --root must be absolute\n"); return 3; }
  mkdirSync(rootAbs, { recursive: true });
  mkdirSync(mirrors, { recursive: true });
  const rows = readRows(casesFile);
  const mirrorOf = (repo: string): string => {
    const m = join(mirrors, repo.replace(/[\\/:]/g, "__") + ".git");
    if (!existsSync(m)) { out.write(`mirror ${repo}\n`); git(["clone", "-q", "--bare", "--filter=blob:none", urlT.replace("{repo}", repo), m]); }
    return m;
  };
  const used = new Set<string>(readdirSync(rootAbs));
  const token = (): string => { for (;;) { const t = randomBytes(4).toString("hex"); if (!used.has(t) && !used.has(t + ".origin.git")) { used.add(t); return t; } } };

  // Cases: rows grouped by set+case, defect files in row order.
  const groups = new Map<string, Row[]>();
  for (const r of rows.filter((x) => x.set !== "clean")) { const k = `${r.set}|${r.case}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  const cases: PreparedCase[] = [];
  for (const [, g] of groups) {
    const first = g[0]!;
    const set = first.set as SetName;
    const rec: PreparedCase = { set, case: first.case, repo: first.repo, fixCommit: first.fixCommit, parentCommit: first.parentCommit, introducing: null, introducingParent: null, accepted: false, rejection: null, files: [], states: { vulnerable: null, fix: null }, fixSideNote: null, treeAtWork: { vulnerable: null, fix: null }, diffStats: null };
    cases.push(rec);
    let mirror: string;
    try { mirror = mirrorOf(first.repo); } catch (e) { if (NETWORK_RE.test(stderrOf(e))) throw e; rec.rejection = `mirror failed: ${String(e).slice(0, 120)}`; continue; }
    const P = first.parentCommit, F = first.fixCommit;
    // Anchors at the parent.
    const anchors: number[] = [];
    for (const r of g) {
      if (/^\d+$/.test(r.anchor)) { anchors.push(Number(r.anchor)); continue; }
      // Amendment A2: the zero-context first hunk's old-side start; for a pure insertion (-a,0) the line after a,
      // which is the line the inserted code guards.
      const d = gitTry(["diff", "-U0", P, F, "--", r.path], mirror) ?? "";
      const m = d.match(/^@@ -(\d+)(?:,(\d+))? /m);
      anchors.push(m ? Math.max(1, Number(m[1]) + (m[2] === "0" ? 1 : 0)) : 0);
    }
    if (!anchors[0]) { rec.rejection = `no anchor for the first defect file ${first.path}`; continue; }
    // Blame rule on the first file.
    const blameAt = (path: string, line: number): { sha: string; orig: number } | null => {
      const b = gitTry(["blame", "-w", "-M", "-C", "--porcelain", "-L", `${line},${line}`, P, "--", path], mirror);
      const m = b?.match(/^([0-9a-f]{40}) (\d+) (\d+)/);
      return m ? { sha: m[1]!, orig: Number(m[2]) } : null;
    };
    const b0 = blameAt(first.path, anchors[0]);
    if (!b0) { rec.rejection = `blame failed on ${first.path}:${anchors[0]} at ${P.slice(0, 12)}`; continue; }
    const I = b0.sha;
    const lineAtP = (gitTry(["show", `${P}:${first.path}`], mirror) ?? "").split(/\r?\n/)[anchors[0] - 1] ?? "";
    const addedByI = (gitTry(["show", "--format=", "-U0", I, "--", first.path], mirror) ?? "").split(/\r?\n/).some((l) => l.startsWith("+") && !l.startsWith("+++") && l.slice(1).trim() === lineAtP.trim());
    rec.introducing = I;
    const Ip = gitTry(["rev-parse", "--verify", `${I}^`], mirror)?.trim() ?? null;
    rec.introducingParent = Ip;
    if (!addedByI) { rec.rejection = `INTRODUCTION-AMBIGUOUS: blame names ${I.slice(0, 12)} but its diff does not add the anchor line`; }
    else if (!Ip) { rec.rejection = `introducing commit ${I.slice(0, 12)} has no parent`; }
    // Defect files and windows at I.
    g.forEach((r, i) => {
      const present = gitTry(["cat-file", "-e", `${I}:${r.path}`]) !== null || gitTry(["cat-file", "-e", `${I}:${r.path}`], mirror) !== null;
      const df: DefectFile = { path: r.path, anchorAtParent: anchors[i]!, anchorAtI: null, blame: null, presentAtI: present, window: null };
      const b = anchors[i] ? blameAt(r.path, anchors[i]!) : null;
      df.blame = b?.sha ?? null;
      if (present && anchors[i]) {
        const textAtI = gitTry(["show", `${I}:${r.path}`], mirror) ?? "";
        if (b && b.sha === I) df.anchorAtI = b.orig;
        else {
          // The line is older than I: find its text at I, nearest to its parent-side line number.
          const want = ((gitTry(["show", `${P}:${r.path}`], mirror) ?? "").split(/\r?\n/)[anchors[i]! - 1] ?? "").trim();
          const hits = textAtI.split(/\r?\n/).map((l, k) => [l.trim(), k + 1] as const).filter(([l]) => l === want && want.length > 0).map(([, k]) => k);
          if (hits.length) df.anchorAtI = hits.sort((x, y) => Math.abs(x - anchors[i]!) - Math.abs(y - anchors[i]!))[0]!;
        }
        if (df.anchorAtI) df.window = defectWindow(textAtI, df.anchorAtI);
      }
      rec.files.push(df);
    });
    if (rec.rejection) continue;
    rec.accepted = true;
    const stat = gitTry(["diff", "--shortstat", `${I}^`, I], mirror) ?? "";
    rec.diffStats = { files: Number((stat.match(/(\d+) files? changed/) ?? [])[1] ?? 0), additions: Number((stat.match(/(\d+) insertions?/) ?? [])[1] ?? 0), deletions: Number((stat.match(/(\d+) deletions?/) ?? [])[1] ?? 0) };
    // States.
    const tv = token();
    rec.states.vulnerable = tv;
    rec.treeAtWork.vulnerable = buildState(mirror, `${I}^`, I, null, join(rootAbs, tv));
    const fixed = treeWithPatch(mirror, I, P, F, g.map((r) => r.path));
    if (fixed.tree) { const tf = token(); rec.states.fix = tf; rec.treeAtWork.fix = buildState(mirror, `${I}^`, null, fixed.tree, join(rootAbs, tf)); }
    else rec.fixSideNote = fixed.note;
    out.write(`case ${set} ${first.case}: I=${I.slice(0, 12)} files ${rec.files.length} windows ${rec.files.filter((f) => f.window).length} fix-side ${rec.states.fix ? "yes" : "no"}\n`);
  }

  // Clean rows (A1 3.2).
  const clean: PreparedClean[] = [];
  for (const r of rows.filter((x) => x.set === "clean")) {
    const rec: PreparedClean = { case: r.case, repo: r.repo, path: r.path, commit: null, commitParent: null, routeShaped: false, rejection: null, state: null, treeAtWork: null };
    clean.push(rec);
    let mirror: string;
    try { mirror = mirrorOf(r.repo); } catch (e) { if (NETWORK_RE.test(stderrOf(e))) throw e; rec.rejection = `mirror failed: ${String(e).slice(0, 120)}`; continue; }
    const head = r.fixCommit; // the TSV's fourth column carries the head for clean rows
    const log = (gitTry(["log", "--no-merges", `--before=${cleanBefore}`, "--format=%H", head, "--", r.path], mirror) ?? "").split("\n").filter(Boolean);
    let pick: string | null = null, fallback: string | null = null;
    for (const c of log) {
      const files = (gitTry(["diff-tree", "--no-commit-id", "--name-only", "-r", c], mirror) ?? "").split("\n").filter(Boolean);
      const src = files.filter(nonTestSource);
      if (src.length < 1 || src.length > 10) continue;
      if (!fallback) fallback = c;
      const d = gitTry(["show", "--format=", "-U0", c, "--", r.path], mirror) ?? "";
      if (d.split(/\r?\n/).some((l) => /^[+-](?![+-]{2})/.test(l) && ROUTE_SHAPE_RE.test(l.slice(1)))) { pick = c; break; }
    }
    const c = pick ?? fallback;
    if (!c) { rec.rejection = "no non-merge commit touching the file with 1 to 10 non-test JS/TS files"; continue; }
    rec.commit = c; rec.routeShaped = !!pick;
    rec.commitParent = gitTry(["rev-parse", "--verify", `${c}^`], mirror)?.trim() ?? null;
    if (!rec.commitParent) { rec.rejection = "the clean commit has no parent"; continue; }
    const t = token();
    rec.state = t;
    rec.treeAtWork = buildState(mirror, `${c}^`, c, null, join(rootAbs, t));
    out.write(`clean ${r.case}: ${c.slice(0, 12)} route-shaped ${rec.routeShaped}\n`);
  }

  const manifest: PreparedManifest = { version: 1, preparedAt: new Date().toISOString(), root: rootAbs, cases, clean };
  mkdirSync(resolve(outFile, ".."), { recursive: true });
  writeFileSync(outFile, JSON.stringify(manifest, null, 1));
  // Nothing from any third-party file is in the manifest: every string is an identifier, a path, a hash or a note.
  const accepted = cases.filter((c) => c.accepted);
  out.write(`prepared: ${cases.length} cases (${accepted.length} accepted, ${accepted.filter((c) => c.states.fix).length} with a fix side), ${clean.filter((k) => k.state).length} clean changes; root ${rootAbs}\n`);
  // A state directory never carries a symlink out of itself.
  for (const d of readdirSync(rootAbs)) { const p = join(rootAbs, d); if (lstatSync(p).isSymbolicLink()) { out.write(`refused: ${p} is a symlink\n`); return 3; } }
  return 0;
}

try { process.exitCode = main(); } catch (err) { process.stderr.write(`agentic-prepare failed: ${(err as Error).stack ?? String(err)}\n`); process.exitCode = 3; }
