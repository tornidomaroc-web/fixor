import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { logger } from "../lib/logger";

export interface WalkOptions {
  root: string;
  extensions: Set<string>;
}

export interface SkippedDir {
  /** Path relative to the scan root, forward-slash separated. */
  path: string;
  /**
   * Why the walker skipped this directory:
   *   - "default-skip" — matched DEFAULT_SKIP_DIRS (built-in deny-list
   *     of dependency, build-output, cache, and editor-state dirs).
   *   - "gitignore"    — matched a directory-pattern in the repo's
   *     .gitignore file.
   * The pre-scan summary in src/cli/scan.ts uses this discriminator
   * to show users WHY a dir was skipped, so a customer can spot a
   * false-skip (e.g. their first-party `vendor/` dir) before paying
   * for the scan.
   */
  rule: "default-skip" | "gitignore";
}

export interface WalkResult {
  /** Absolute paths of files that passed every filter. */
  files: string[];
  /** Directories the walker chose not to descend into, with rule. */
  skippedDirs: SkippedDir[];
  /**
   * `.gitignore` lines starting with `!` (negation: re-include a
   * previously-excluded path). The walker's gitignore parser does
   * NOT honor negation today — see loadGitignore() — so any file
   * the user intended to re-include via `!` is SILENTLY DROPPED if
   * its parent directory matched an earlier exclude pattern.
   *
   * This list captures every such ignored line so the pre-scan
   * summary in src/cli/scan.ts can warn the operator. Without this
   * surfacing, the negation-drop is exactly the silent-fail class
   * this whole PR exists to kill.
   *
   * Fixing the negation handling itself is a separate, deferred
   * concern (the walker would need full gitignore semantics with
   * pattern ordering); the warning is the in-scope mitigation.
   */
  ignoredNegations: string[];
}

/**
 * Default file extensions the scan command considers. Anything outside
 * this set is filtered before any LLM call regardless of skip rules.
 * Exported so the test harness can call walkFiles without copy-pasting
 * the list and getting stale on a future addition.
 */
export const DEFAULT_EXTENSIONS = ["ts", "tsx", "js", "jsx", "py", "go"];

/**
 * Directories the walker refuses to descend into by default. Ordered
 * loosely by tier (high-confidence-skip first; the lower-confidence
 * names sit at the bottom of the list for readability).
 *
 * The load-bearing decision here is: false-skip (we silently miss the
 * customer's first-party source) is the worst-case failure, the same
 * silent-fail class as the dashboard allowlist bug we shipped earlier
 * this week. The mitigation has THREE layers:
 *
 *   1. Conservative deny-list — only names where the strong consensus
 *      across ecosystems is "this is always third-party or build
 *      output, not first-party source." See inclusion criterion below.
 *   2. Per-skip INFO log — every skip is logged with the rule, so the
 *      operator can grep the run output for what was excluded.
 *   3. Pre-scan summary block in src/cli/scan.ts shows skip counts
 *      and category breakdown BEFORE the cost-confirmation prompt.
 *      A customer who sees "skipped 12 default dirs" and is surprised
 *      can abort before any LLM call.
 *
 * INCLUSION CRITERION (explicit, applies to both tiers):
 *   A name belongs in DEFAULT_SKIP_DIRS only if BOTH hold:
 *     (a) it has a single dominant convention across ecosystems
 *         (dependency / build-output / cache / editor-state); AND
 *     (b) it has no common first-party-source use.
 *
 *   Names that fail (a) or (b) stay out. The clearest contrast:
 *     - `out/`: single dominant convention (Next.js export, Java/
 *       IntelliJ module output, TypeScript outDir). No common
 *       first-party-source pattern uses `out/`. INCLUDED (Tier-2).
 *     - `env/`: TWO competing conventions (Python venv name AND
 *       per-environment config dir). Config-dir-named-env is
 *       genuinely first-party for projects that have it. EXCLUDED.
 *
 *   Users whose stack puts source in an excluded name (e.g. an old
 *   monorepo with first-party `vendor/`) see the dir on the pre-scan
 *   summary and can rename, restructure, or wait for a v2
 *   `--include-dir` override flag. Do not build the override
 *   mechanism speculatively.
 */
export const DEFAULT_SKIP_DIRS: ReadonlySet<string> = new Set<string>([
  // Tier-1: never first-party (high confidence). Inclusion criterion
  // is trivially satisfied: each of these names has a single dominant
  // convention and no first-party-source variant in common practice.
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "__pycache__",
  ".venv",
  ".turbo",
  ".cache",
  ".nx",
  ".parcel-cache",
  ".yarn",
  ".pnpm-store",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".coverage",
  "coverage",
  ".gradle",
  "bower_components",
  // Tier-1: editor / tool state. Single dominant convention by name;
  // file-extension filter would also skip the JSON/YAML inside but
  // refusing to descend saves the recursion entirely.
  ".idea",
  ".vscode",
  ".fleet",
  ".claude",
  // Tier-2: strong convention, low collision risk. Each satisfies the
  // inclusion criterion (single dominant convention + no common
  // first-party-source variant) but is one step less universal than
  // Tier-1. The pre-scan summary is the safety net for the rare
  // collision case.
  "venv", // Python tutorial convention (python -m venv venv)
  "target", // Rust cargo build output, Maven `mvn package` output
  "vendor", // Go module vendoring, Ruby Bundler, PHP Composer
  "out", // Next.js `next export`, Java/IntelliJ module output, TS outDir
]);

interface GitignorePattern {
  regex: RegExp;
  dirOnly: boolean;
  source: string;
}

/**
 * Walk the given root, returning every file whose extension is in
 * opts.extensions and whose path is not excluded by either the
 * DEFAULT_SKIP_DIRS deny-list or the root's .gitignore.
 *
 * Returns a structured result (files + skippedDirs with rule
 * attribution) rather than a plain string[] so the caller can render
 * a pre-scan summary. Pre-fix this function returned string[]; the
 * shape change broke `scan.ts` (the only call site) which was
 * updated in the same commit.
 */
export function walkFiles(opts: WalkOptions): WalkResult {
  const root = opts.root;
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return { files: [], skippedDirs: [], ignoredNegations: [] };
  }
  const { patterns, ignoredNegations } = loadGitignore(root);
  const files: string[] = [];
  const skippedDirs: SkippedDir[] = [];
  walk(root, root, opts.extensions, patterns, files, skippedDirs);
  return { files, skippedDirs, ignoredNegations };
}

function walk(
  current: string,
  root: string,
  exts: Set<string>,
  patterns: GitignorePattern[],
  files: string[],
  skippedDirs: SkippedDir[],
): void {
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = join(current, entry.name);
    const rel = relative(root, abs).split(sep).join("/");
    if (entry.isDirectory()) {
      if (DEFAULT_SKIP_DIRS.has(entry.name)) {
        skippedDirs.push({ path: rel, rule: "default-skip" });
        logger.info(
          { dir: rel, rule: "default-skip", name: entry.name },
          "file-walker: skipping directory",
        );
        continue;
      }
      if (matches(patterns, rel + "/", true)) {
        skippedDirs.push({ path: rel, rule: "gitignore" });
        logger.info(
          { dir: rel, rule: "gitignore" },
          "file-walker: skipping directory",
        );
        continue;
      }
      walk(abs, root, exts, patterns, files, skippedDirs);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      if (dot < 0) continue;
      const ext = entry.name.slice(dot + 1).toLowerCase();
      if (!exts.has(ext)) continue;
      if (matches(patterns, rel, false)) continue;
      files.push(abs);
    }
  }
}

function loadGitignore(root: string): {
  patterns: GitignorePattern[];
  ignoredNegations: string[];
} {
  const file = join(root, ".gitignore");
  if (!existsSync(file)) return { patterns: [], ignoredNegations: [] };
  const text = readFileSync(file, "utf8");
  const patterns: GitignorePattern[] = [];
  const ignoredNegations: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("!")) {
      // Walker does not honor negation patterns today; capture them
      // so the pre-scan summary can warn the operator that any file
      // the negation would have re-included is silently dropped.
      ignoredNegations.push(line);
      continue;
    }
    const dirOnly = line.endsWith("/");
    const body = dirOnly ? line.slice(0, -1) : line;
    patterns.push({ regex: globToRegex(body), dirOnly, source: line });
  }
  return { patterns, ignoredNegations };
}

function globToRegex(pattern: string): RegExp {
  const anchored = pattern.startsWith("/");
  const body = anchored ? pattern.slice(1) : pattern;
  let re = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "*") {
      if (body[i + 1] === "*") {
        re += ".*";
        i++;
        if (body[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (".+^$()|{}[]\\".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  const prefix = anchored ? "^" : "(^|.*/)";
  return new RegExp(prefix + re + "(/.*)?$");
}

function matches(
  patterns: GitignorePattern[],
  relPath: string,
  isDir: boolean,
): boolean {
  for (const p of patterns) {
    if (p.dirOnly && !isDir) continue;
    if (p.regex.test(relPath)) return true;
  }
  return false;
}
