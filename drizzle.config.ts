/**
 * drizzle-kit configuration.
 *
 * `generate` is purely a schema-diff and does NOT need DATABASE_URL.
 * `migrate`, `push`, and `studio` do — set it in .env or Railway env.
 */
import type { Config } from "drizzle-kit";

try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  // No .env present or loadEnvFile unavailable — fine for `generate`.
}

/**
 * Tables another project (CKSE) keeps in the same Neon database until it
 * moves out (docs/CKSE-SEPARATION.md). Excluded here so `drizzle-kit
 * push` / `pull` / `introspect` never treat them as Fixor's: without this
 * a push would emit DROP TABLE for every one of them. The runtime
 * migrator (src/db/migrate.ts) does not read this file at all, so this
 * changes nothing about what `db:migrate` does in production; witnessed
 * by src/test/test-drizzle-config-filter.ts.
 */
export const CKSE_TABLES = [
  "alembic_version",
  "block",
  "page",
  "projection_state",
  "source",
  "suppression_audit",
] as const;

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  tablesFilter: CKSE_TABLES.map((t) => `!${t}`),
} satisfies Config;
