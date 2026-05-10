#!/usr/bin/env node
/**
 * One-shot script: inject `// ASSUMED-PATH: <path>` (or `# ASSUMED-PATH:`)
 * headers into each fixture under fixtures/<category>/{positive,negative}/.
 *
 * Path rules:
 *   - POSITIVES: src/app/handlers/<category>/<filename>
 *   - NEGATIVES Category A: per-file mapping (location-safe paths
 *     reflecting the in-fixture context — scripts/, tests/, db/migrate/, etc.)
 *   - NEGATIVES Category B: src/app/handlers/<category>/<filename>
 *
 * Files that already contain an ASSUMED-PATH header are skipped.
 * Shebang on line 1 (`#!/usr/bin/env ...`) is preserved; header inserted on line 2.
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { extname, join, basename } from "node:path";

const FIXTURES_ROOT = "fixtures";
const CATEGORIES = [
  "auth-bypass",
  "secrets-exposure",
  "webhook-unverified",
  "env-exposure",
  "admin-check",
];

// Per-file location mapping for the 6 Category A (location-safe) negatives.
// Source: META.md categorisation + in-fixture intent comments.
const CATEGORY_A_PATHS = {
  "auth-bypass/negative/02-internal-dev-tool.ts":
    "scripts/dev/seed-demo-data.ts",
  "auth-bypass/negative/05-default-id-in-seed.js":
    "scripts/seed/seed-uploads.js",
  "auth-bypass/negative/07-jwt-verify-false-tests.py": "tests/conftest.py",
  "auth-bypass/negative/09-rb-admin-migration.rb":
    "db/migrate/20251201_seed_admin_account.rb",
  "secrets-exposure/negative/05-stripe-test-keys-fixtures.ts":
    "fixtures/mock-stripe-keys.test.ts",
  "admin-check/negative/07-bootstrap-admins-script.js":
    "scripts/bootstrap-admins.js",
};

function commentToken(ext) {
  return ext === ".py" || ext === ".rb" ? "#" : "//";
}

function injectHeader(content, headerLine) {
  if (/(?:\/\/|#)\s*ASSUMED-PATH:/.test(content)) {
    return { changed: false, content };
  }
  const lines = content.split(/\r?\n/);
  const isShebang = (lines[0] ?? "").startsWith("#!");
  const insertAt = isShebang ? 1 : 0;
  lines.splice(insertAt, 0, headerLine);
  return { changed: true, content: lines.join("\n") };
}

const stats = { added: 0, skipped: 0, errors: [] };
const perCategory = Object.fromEntries(
  CATEGORIES.map((c) => [c, { positive: 0, negative: 0 }]),
);

for (const cat of CATEGORIES) {
  for (const subset of ["positive", "negative"]) {
    const dir = join(FIXTURES_ROOT, cat, subset);
    let files;
    try {
      files = readdirSync(dir);
    } catch (err) {
      stats.errors.push(`cannot read ${dir}: ${err.message}`);
      continue;
    }

    for (const file of files) {
      if (file === "META.md" || file.startsWith(".")) continue;
      const filepath = join(dir, file);
      const ext = extname(file);
      const relKey = `${cat}/${subset}/${file}`;

      let assumedPath;
      if (subset === "positive") {
        assumedPath = `src/app/handlers/${cat}/${file}`;
      } else if (CATEGORY_A_PATHS[relKey]) {
        assumedPath = CATEGORY_A_PATHS[relKey];
      } else {
        // Category B
        assumedPath = `src/app/handlers/${cat}/${file}`;
      }

      const headerLine = `${commentToken(ext)} ASSUMED-PATH: ${assumedPath}`;

      try {
        const content = readFileSync(filepath, "utf8");
        const { changed, content: updated } = injectHeader(content, headerLine);
        if (!changed) {
          stats.skipped++;
        } else {
          writeFileSync(filepath, updated, "utf8");
          stats.added++;
          perCategory[cat][subset]++;
        }
      } catch (err) {
        stats.errors.push(`${relKey}: ${err.message}`);
      }
    }
  }
}

console.log("=== ASSUMED-PATH injection report ===");
console.log(`Headers added:   ${stats.added}`);
console.log(`Already present: ${stats.skipped}`);
console.log("");
console.log("Per-category headers added:");
for (const cat of CATEGORIES) {
  const p = perCategory[cat].positive;
  const n = perCategory[cat].negative;
  console.log(`  ${cat.padEnd(20)} positives=${p}  negatives=${n}`);
}
if (stats.errors.length) {
  console.log("");
  console.log("Errors:");
  for (const e of stats.errors) console.log(`  ${e}`);
  process.exit(1);
}
