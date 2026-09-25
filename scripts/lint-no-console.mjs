#!/usr/bin/env node
/**
 * Lint: ban console.* in production source code, in src/ and in the
 * dashboard (apps/dashboard/src, which has no logger and whose own ESLint
 * is not in root CI; a console line there lands in Vercel's function logs).
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

const PATTERN = /console\.(log|warn|error|info|debug|trace)\s*\(/;

// Each root is walked with its own allowlist. The dashboard has no
// logger and no linter of its own in root CI; its two allowed files log
// an operational failure or a stub send, never a user's identifiers.
const ROOTS = [
  {
    root: path.resolve(process.cwd(), "src"),
    label: "src",
    extensions: [".ts"],
    allowedFiles: new Set(["workflows/test-harness.ts"]),
    allowedTopLevelDirs: new Set(["scripts", "test", "real-tests", "demo"]),
    allowedNestedDirNames: new Set(["demo"]),
  },
  {
    root: path.resolve(process.cwd(), "apps", "dashboard", "src"),
    label: "apps/dashboard/src",
    extensions: [".ts", ".tsx"],
    allowedFiles: new Set(["app/api/billing/webhook/route.ts", "lib/resend.ts"]),
    allowedTopLevelDirs: new Set(),
    allowedNestedDirNames: new Set(),
  },
];

async function* walk(dir, extensions, relRoot = "") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = relRoot === "" ? entry.name : `${relRoot}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walk(abs, extensions, rel);
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      yield { abs, rel };
    }
  }
}

function isAllowed(cfg, rel) {
  if (cfg.allowedFiles.has(rel)) return true;
  const segments = rel.split("/");
  if (cfg.allowedTopLevelDirs.has(segments[0])) return true;
  for (const seg of segments) {
    if (cfg.allowedNestedDirNames.has(seg)) return true;
  }
  return false;
}

async function main() {
  const violations = [];
  for (const cfg of ROOTS) {
    for await (const { abs, rel } of walk(cfg.root, cfg.extensions)) {
      if (isAllowed(cfg, rel)) continue;
      const text = await fs.readFile(abs, "utf8");
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (PATTERN.test(lines[i])) {
          violations.push({
            file: `${cfg.label}/${rel}`,
            line: i + 1,
            content: lines[i].trim(),
          });
        }
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
