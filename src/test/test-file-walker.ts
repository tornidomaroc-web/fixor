/**
 * Unit + integration tests for the CLI file walker.
 *
 * Run via: npm run test:file-walker
 *
 * Test discipline: the scaffold and the assertions are DATA-DRIVEN
 * from DEFAULT_SKIP_DIRS itself. Adding a name to the deny-list in
 * file-walker.ts automatically adds coverage here. This catches the
 * failure mode "I added a name but forgot to update the test."
 *
 * Covers:
 *   - DEFAULT_SKIP_DIRS membership (exhaustive: every name is tested
 *     as both "directory is skipped" and "no file under it leaks").
 *   - Explicit negative controls so first-party names (src, lib,
 *     app, env, config, services) are NEVER in the deny-list.
 *   - Real-filesystem integration via a tmpdir scaffold mimicking
 *     the KnowFlow case (Next.js src/ + Python service with .venv/).
 *   - Walker returns structured {files, skippedDirs, ignoredNegations}
 *     with rule attribution so scan.ts can render a pre-scan summary
 *     block (the load-bearing mitigation against silent-fail).
 *   - .gitignore patterns are still honored and reported with rule
 *     "gitignore" (regression).
 *   - .gitignore !negation patterns are captured in ignoredNegations
 *     so scan.ts can warn the operator (Point-2 mitigation for the
 *     out-of-scope negation-handling bug).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import {
  walkFiles,
  DEFAULT_SKIP_DIRS,
  DEFAULT_EXTENSIONS,
} from "../cli/file-walker";

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    failures++;
  }
}

/** First-party names that MUST NOT appear in the deny-list. Source dirs
 *  and ambiguous names where the false-skip risk outweighs the convenience. */
const MUST_NOT_BE_SKIPPED = [
  "src",
  "lib",
  "app",
  "env", // ambiguous: config dir vs Python venv
  "config",
  "services",
  "components",
  "pages",
  "api",
  "routes",
] as const;

function scaffold(): string {
  const root = mkdtempSync(join(tmpdir(), "fixor-walker-"));
  // First-party source that MUST survive the walk.
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.ts"), "// app\n");
  mkdirSync(join(root, "src", "routes"), { recursive: true });
  writeFileSync(join(root, "src", "routes", "users.ts"), "// users\n");
  // Data-driven: create a dir for EVERY name in DEFAULT_SKIP_DIRS,
  // each with both a .py and a .ts file inside. Any future addition
  // to the deny-list automatically gains coverage.
  for (const dir of DEFAULT_SKIP_DIRS) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "dep.py"), "# dep\n");
    writeFileSync(join(root, dir, "dep.ts"), "// dep\n");
  }
  // Nested .venv inside services/ — the KnowFlow shape that motivated
  // this fix. Tests that the deny-list applies at any depth, not just
  // the scan root.
  mkdirSync(join(root, "services", "ingestion", ".venv", "Lib"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "services", "ingestion", ".venv", "Lib", "x.py"),
    "# dep\n",
  );
  writeFileSync(
    join(root, "services", "ingestion", "main.py"),
    "# main\n",
  );
  // First-party dirs with names that look suspicious. These must
  // survive — they exercise the "explicit exclusion" promise.
  for (const dir of MUST_NOT_BE_SKIPPED) {
    if (dir === "src" || dir === "services" || dir === "routes") continue; // already created
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "real.ts"), "// real\n");
  }
  // .gitignore: one normal exclude + one !negation pattern so the
  // ignoredNegations test has something to fire on.
  writeFileSync(
    join(root, ".gitignore"),
    "secrets/\n!secrets/keepme.ts\n",
  );
  mkdirSync(join(root, "secrets"), { recursive: true });
  writeFileSync(join(root, "secrets", "api.ts"), "// secret\n");
  writeFileSync(join(root, "secrets", "keepme.ts"), "// re-included\n");
  return root;
}

function relPaths(root: string, files: string[]): string[] {
  return files.map((f) => relative(root, f).split(sep).join("/")).sort();
}

function run(): void {
  // ---- 1. Negative controls: deny-list must NOT contain first-party names ----
  for (const name of MUST_NOT_BE_SKIPPED) {
    assert(
      !DEFAULT_SKIP_DIRS.has(name),
      `${name} is NOT in default-skip (would false-skip first-party source)`,
    );
  }

  // ---- 2. Integration: scaffolded scan ----
  const root = scaffold();
  try {
    const result = walkFiles({
      root,
      extensions: new Set(DEFAULT_EXTENSIONS),
    });
    const files = relPaths(root, result.files);

    // First-party files MUST be present.
    assert(files.includes("src/app.ts"), "src/app.ts survives the walk");
    assert(
      files.includes("src/routes/users.ts"),
      "src/routes/users.ts survives the walk",
    );
    assert(
      files.includes("services/ingestion/main.py"),
      "services/ingestion/main.py survives the walk",
    );
    // First-party dirs with suspicious names MUST be present. The
    // scaffold seeds `real.ts` into each MUST_NOT_BE_SKIPPED dir
    // (except src/services/routes which already have richer content
    // and are checked above).
    const preCreated = new Set(["src", "services", "routes"]);
    for (const name of MUST_NOT_BE_SKIPPED) {
      if (preCreated.has(name)) continue;
      assert(
        files.includes(`${name}/real.ts`),
        `${name}/real.ts survives the walk (negative control: ${name} is not in deny-list)`,
      );
    }

    // ---- 3. Exhaustive: no file under ANY DEFAULT_SKIP_DIRS name leaks ----
    for (const skipName of DEFAULT_SKIP_DIRS) {
      const leaks = files.filter((f) => f.startsWith(`${skipName}/`));
      assert(
        leaks.length === 0,
        `no files leak from ${skipName}/ (got ${leaks.length}: ${leaks.join(", ")})`,
      );
    }

    // Nested .venv inside services/ MUST be skipped (KnowFlow shape).
    const nestedVenv = files.filter((f) =>
      f.includes("services/ingestion/.venv/"),
    );
    assert(
      nestedVenv.length === 0,
      `services/ingestion/.venv/ does not leak (got ${nestedVenv.length})`,
    );

    // ---- 4. Exhaustive: every DEFAULT_SKIP_DIRS dir is in skippedDirs with rule="default-skip" ----
    assert(
      Array.isArray(result.skippedDirs),
      "walkFiles result has .skippedDirs array",
    );
    const skipByPath = new Map(
      result.skippedDirs.map((s) => [s.path, s.rule]),
    );
    for (const skipName of DEFAULT_SKIP_DIRS) {
      const rule = skipByPath.get(skipName);
      assert(
        rule === "default-skip",
        `${skipName} reported in skippedDirs with rule="default-skip" (got ${rule ?? "MISSING"})`,
      );
    }

    // Nested .venv also reported.
    assert(
      skipByPath.get("services/ingestion/.venv") === "default-skip",
      "nested services/ingestion/.venv reported with rule=default-skip",
    );

    // ---- 5. .gitignore: dir skipped + reported with rule="gitignore" ----
    assert(
      skipByPath.get("secrets") === "gitignore",
      `secrets/ reported with rule="gitignore" (got ${skipByPath.get("secrets") ?? "MISSING"})`,
    );
    const secretFile = files.find((f) => f.startsWith("secrets/"));
    assert(
      secretFile === undefined,
      "secrets/ contents (including keepme.ts) are not in result.files",
    );

    // ---- 6. !negation patterns captured in ignoredNegations ----
    assert(
      Array.isArray(result.ignoredNegations),
      "walkFiles result has .ignoredNegations array",
    );
    assert(
      result.ignoredNegations.includes("!secrets/keepme.ts"),
      `ignoredNegations includes "!secrets/keepme.ts" (got: ${JSON.stringify(result.ignoredNegations)})`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  if (failures === 0) {
    console.log("[PASS] file-walker unit + integration tests");
  } else {
    console.error(`[FAIL] ${failures} file-walker test(s) failed`);
    process.exit(1);
  }
}

run();
