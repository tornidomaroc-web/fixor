/**
 * Apply pending Drizzle migrations against $DATABASE_URL.
 *
 * Local: `npm run db:migrate` (loads .env via process.loadEnvFile when
 * present). Railway: same npm script as a deploy step — env is injected.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as path from "path";

async function main(): Promise<void> {
  // Best-effort load of a local .env file (Node 20.6+). Silent no-op when
  // the file does not exist or env injection is in use (Railway).
  try {
    (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
  } catch {
    // Intentionally swallowed — relying on injected env in this case.
  }

  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error(
      "[db:migrate] DATABASE_URL is not set. Cannot apply migrations.",
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  // tsc does not copy .sql files into dist/, so we resolve migrations
  // relative to the project root (cwd at npm-script invocation time).
  // Both `npm run db:migrate` locally and Railway's release command run
  // from the repo root, so this is stable in both environments.
  const migrationsFolder = path.resolve(process.cwd(), "src/db/migrations");

  console.log(`[db:migrate] Applying migrations from ${migrationsFolder}...`);
  await migrate(db, { migrationsFolder });
  console.log("[db:migrate] Done.");

  await pool.end();
}

main().catch((err) => {
  console.error("[db:migrate] Failed:", err);
  process.exit(1);
});
