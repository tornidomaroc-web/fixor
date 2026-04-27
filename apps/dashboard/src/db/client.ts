/**
 * Lazy Drizzle client for the dashboard.
 *
 * Same lazy pattern as the backend's src/db/client.ts, but with its
 * own dashboard-scoped schema. Reading DATABASE_URL is deferred so
 * that build-time imports (e.g. `import { db } from ...`) don't fail
 * when the env var isn't set yet — only the actual `.then(...)`
 * caller pays the cost of resolving it.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let _db: NodePgDatabase<typeof schema> | null = null;
let _pool: Pool | null = null;

function readConnectionString(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to the dashboard's Vercel env vars before calling db().",
    );
  }
  return url;
}

export function db(): NodePgDatabase<typeof schema> {
  if (_db) return _db;
  _pool = new Pool({ connectionString: readConnectionString() });
  _db = drizzle(_pool, { schema });
  return _db;
}
