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

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
} satisfies Config;
