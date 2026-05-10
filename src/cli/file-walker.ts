import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface WalkOptions {
  root: string;
  extensions: Set<string>;
}

const HARD_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
]);

interface GitignorePattern {
  regex: RegExp;
  dirOnly: boolean;
}

export function walkFiles(opts: WalkOptions): string[] {
  const root = opts.root;
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return [];
  }
  const patterns = loadGitignore(root);
  const out: string[] = [];
  walk(root, root, opts.extensions, patterns, out);
  return out;
}

function walk(
  current: string,
  root: string,
  exts: Set<string>,
  patterns: GitignorePattern[],
  out: string[],
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
      if (HARD_SKIP_DIRS.has(entry.name)) continue;
      if (matches(patterns, rel + "/", true)) continue;
      walk(abs, root, exts, patterns, out);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      if (dot < 0) continue;
      const ext = entry.name.slice(dot + 1).toLowerCase();
      if (!exts.has(ext)) continue;
      if (matches(patterns, rel, false)) continue;
      out.push(abs);
    }
  }
}

function loadGitignore(root: string): GitignorePattern[] {
  const file = join(root, ".gitignore");
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const patterns: GitignorePattern[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const dirOnly = line.endsWith("/");
    const body = dirOnly ? line.slice(0, -1) : line;
    patterns.push({ regex: globToRegex(body), dirOnly });
  }
  return patterns;
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
