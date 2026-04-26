#!/usr/bin/env node
/**
 * Lint: ban console.* in production source code.
 *
 * Use src/lib/logger instead. Allowed directories are CLI scripts +
 * test fixtures + demos, since those are stand-alone entry points
 * where plain stdout output is the right interface.
 *
 * The check is intentionally lightweight (regex over .ts files) so it
 * runs in a few hundred ms with no extra deps. ESLint can replace this
 * later if we adopt it for other reasons.
 */
import fs from "node:fs/promises";
import path from "node:path";

const SRC_ROOT = path.resolve(process.cwd(), "src");
const PATTERN = /console\.(log|warn|error|info|debug|trace)\s*\(/;

// Top-level (under src/) directories where console.* is allowed.
const ALLOWED_TOPLEVEL_DIRS = new Set([
  "scripts",
  "test",
  "real-tests",
  "demo",
]);

// Nested directory names — allowed wherever they appear in the path
// (e.g. src/integrations/github/demo/).
const ALLOWED_NESTED_DIR_NAMES = new Set(["demo"]);

// Explicit single-file allowlist for files that are tests-by-purpose
// but live next to production code.
const ALLOWED_FILES = new Set(["workflows/test-harness.ts"]);

async function* walk(dir, relRoot = "") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = relRoot === "" ? entry.name : `${relRoot}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walk(abs, rel);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      yield { abs, rel };
    }
  }
}

function isAllowed(rel) {
  if (ALLOWED_FILES.has(rel)) return true;
  const segments = rel.split("/");
  if (ALLOWED_TOPLEVEL_DIRS.has(segments[0])) return true;
  for (const seg of segments) {
    if (ALLOWED_NESTED_DIR_NAMES.has(seg)) return true;
  }
  return false;
}

async function main() {
  const violations = [];
  for await (const { abs, rel } of walk(SRC_ROOT)) {
    if (isAllowed(rel)) continue;
    const text = await fs.readFile(abs, "utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (PATTERN.test(lines[i])) {
        violations.push({
          file: `src/${rel}`,
          line: i + 1,
          content: lines[i].trim(),
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `lint:no-console — ${violations.length} violation(s) in production code:`,
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  ${v.content}`);
    }
    console.error(
      "\nUse src/lib/logger instead. If this file is a CLI entry point, move it under src/scripts/.",
    );
    process.exit(1);
  }

  console.log("lint:no-console: OK");
}

main().catch((err) => {
  console.error("lint:no-console: scan failed:", err);
  process.exit(1);
});
