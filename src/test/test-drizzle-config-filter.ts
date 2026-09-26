/**
 * Witness: drizzle.config.ts excludes exactly the six CKSE tables from
 * drizzle-kit's push / pull / introspect, includes every Fixor table, and
 * the runtime migrator cannot be affected by it.
 *
 * Tracker item 4 (CKSE separation; docs/CKSE-SEPARATION.md). The same
 * Neon database holds six tables of another project under the same role.
 * `drizzle-kit push` diffs the live database against src/db/schema.ts and
 * would emit DROP TABLE for each of them; `pull` / `introspect` would
 * read them as Fixor's.
 *
 * The filter semantics are drizzle-kit 0.31.10's own (bin.cjs): every
 * entry becomes a Minimatch; a negated entry that matches a table name
 * pushes `false`, a matching entry pushes `true`, and the table is kept
 * only when every flag is true. For literal names that reduces to: a
 * table is dropped from the set when a `!name` entry names it, and kept
 * otherwise. That reduction is what this test applies.
 *
 * Why this cannot change production migrations: src/db/migrate.ts calls
 * `migrate(db, { migrationsFolder })` from drizzle-orm, whose
 * MigrationConfig type has no table filter and which reads only the
 * journal and SQL files under the folder; it never imports
 * drizzle.config.ts. Both facts are read from the files here.
 *
 * Keyless and $0: no key, no database, no network; the config is
 * evaluated with `process.loadEnvFile` replaced by a no-op so no .env is
 * read.
 */
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DATABASE_URL;

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    failures++;
  } else {
    console.log(`[PASS] ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${msg} (expected ${e}, got ${a})`);
}

const ROOT = process.cwd();
const CKSE = ["alembic_version", "block", "page", "projection_state", "source", "suppression_audit"];

/** Evaluates drizzle.config.ts as CommonJS without touching .env. */
function loadConfig(): { default: { tablesFilter?: unknown; schema?: unknown; out?: unknown } } {
  const src = fs.readFileSync(path.join(ROOT, "drizzle.config.ts"), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const proc = process as unknown as { loadEnvFile?: () => void };
  const realLoad = proc.loadEnvFile;
  proc.loadEnvFile = () => undefined;
  try {
    const mod = { exports: {} as Record<string, unknown> };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function("module", "exports", "require", js)(mod, mod.exports, require);
    return mod.exports as { default: { tablesFilter?: unknown } };
  } finally {
    proc.loadEnvFile = realLoad;
  }
}

/** drizzle-kit's filter reduced to literal names (see the header). */
function keptBy(filter: string[], table: string): boolean {
  const flags: boolean[] = [];
  for (const entry of filter) {
    const negated = entry.startsWith("!");
    const name = negated ? entry.slice(1) : entry;
    const matches = name === table;
    if (negated && matches) flags.push(false);
    if (!negated && matches) flags.push(true);
    if (negated && !matches) flags.push(true);
  }
  return flags.length === 0 ? true : flags.every(Boolean);
}

function fixorTables(): string[] {
  const schema = fs.readFileSync(path.join(ROOT, "src/db/schema.ts"), "utf8");
  return [...schema.matchAll(/pgTable\(\s*"([a-z_]+)"/g)].map((m) => m[1]!);
}

function main(): void {
  console.log("\n--- A. the filter excludes the six CKSE tables and nothing else ---");
  const config = loadConfig().default;
  const filter = config.tablesFilter;
  assert(Array.isArray(filter) && filter.every((f) => typeof f === "string"), "tablesFilter is an array of strings");
  const entries = Array.isArray(filter) ? (filter as string[]) : [];
  console.log(`       tablesFilter: ${JSON.stringify(entries)}`);
  assertEq([...entries].sort(), CKSE.map((t) => `!${t}`).sort(), "exactly the six CKSE tables, each negated");
  for (const t of CKSE) assert(!keptBy(entries, t), `${t}: excluded`);

  console.log("\n--- B. every Fixor table stays in ---");
  const fixor = fixorTables();
  console.log(`       schema.ts tables: ${fixor.join(", ")}`);
  assert(fixor.length >= 7, `schema.ts declares ${fixor.length} tables (at least the seven known)`);
  for (const t of fixor) assert(keptBy(entries, t), `${t}: kept`);
  assert(fixor.every((t) => !CKSE.includes(t)), "no Fixor table shares a name with a CKSE table");

  console.log("\n--- C. the runtime migrator cannot read the filter ---");
  const migrate = fs.readFileSync(path.join(ROOT, "src/db/migrate.ts"), "utf8");
  assert(/from "drizzle-orm\/node-postgres\/migrator"/.test(migrate), "migrate.ts imports drizzle-orm's migrator");
  assert(!/drizzle\.config/.test(migrate), "migrate.ts never imports drizzle.config");
  assert(/migrate\(db, \{ migrationsFolder \}\)/.test(migrate), "migrate.ts passes only migrationsFolder");
  const cfgType = fs.readFileSync(path.join(ROOT, "node_modules/drizzle-orm/migrator.d.ts"), "utf8");
  const iface = /interface MigrationConfig \{([^}]*)\}/.exec(cfgType)?.[1] ?? "";
  const fields = [...iface.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
  console.log(`       drizzle-orm MigrationConfig fields: ${fields.join(", ")}`);
  assert(fields.includes("migrationsFolder") && !fields.some((f) => /filter/i.test(f)), "MigrationConfig has no table filter: nothing in this config reaches db:migrate");
  assertEq([config.schema, config.out], ["./src/db/schema.ts", "./src/db/migrations"], "schema and migrations paths unchanged");

  console.log(failures === 0 ? "\nDrizzle-config witness: PASS." : `\nDrizzle-config witness: ${failures} FAILURE(S).`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
