#!/usr/bin/env node
/**
 * npm `prepare` step: point core.hooksPath at the tracked .githooks directory.
 *
 * WHY THIS SHAPE. core.hooksPath alone needs one manual command per clone, which
 * is the gap it was meant to close wearing a different hat. A copy-the-hook-in
 * installer clobbers a hook the developer wrote themselves. Setting a PATH from
 * `prepare` does neither: a fresh clone is protected by its first `npm install`,
 * the hooks are tracked so edits propagate on pull, and nothing is overwritten.
 *
 * Node, not shell: `prepare` is an npm script, so node is guaranteed present,
 * whereas a shell one-liner in package.json has to survive both sh and cmd.exe
 * quoting. Git only executes files in a hooks directory whose names match hook
 * names, so this file sitting beside `pre-commit` is inert.
 *
 * THE .git TEST IS THE ENVIRONMENT TEST. `npm ci` runs prepare, including under
 * --omit=dev (both verified), and the Dockerfile runs `npm ci` after copying
 * only package*.json — no .git, and no git binary in node:alpine. Calling
 * `git config` there exits 128 and would break the image build, and Railway
 * deploys from that Dockerfile.
 *
 * So: no .git at all means a container image or an extracted tarball. That is a
 * legitimate context with no hooks to install, and it exits 0 in silence. A .git
 * that IS present but whose `git config` fails is a real fault on a real clone,
 * and it fails loudly. The distinction is made on an observable, never on a
 * guess about the environment. existsSync covers both a .git directory and the
 * .git FILE that a linked worktree uses.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const HOOKS_DIR = ".githooks";

if (!existsSync(".git")) {
  // Container image, tarball extraction, or a nested package installed on its
  // own. Nothing to wire up, and nothing is wrong. Stay silent.
  process.exit(0);
}

const result = spawnSync("git", ["config", "core.hooksPath", HOOKS_DIR], {
  stdio: ["ignore", "ignore", "pipe"],
  encoding: "utf8",
});

if (result.error || result.status !== 0) {
  const detail = result.error
    ? result.error.message
    : (result.stderr || "").trim() || `git exited ${result.status}`;
  console.error("");
  console.error("Hook setup FAILED, and this is a real fault, not a skip.");
  console.error("");
  console.error("  A .git entry is present, so this is a working clone, but");
  console.error(`  \`git config core.hooksPath ${HOOKS_DIR}\` did not succeed:`);
  console.error("");
  console.error(`    ${detail}`);
  console.error("");
  console.error("  Until this is resolved, commits in this clone are NOT");
  console.error("  scanned for secrets before they are created.");
  console.error("");
  process.exit(1);
}
