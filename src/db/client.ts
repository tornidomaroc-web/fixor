/**
 * Lazy Drizzle client for Fixor.
 *
 * Pool is created on first call to `db()`. Reading DATABASE_URL is
 * deferred so that codepaths that never touch the DB (CLI scripts,
 * unit tests, dry-run demos) don't fail at import time.
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
      "DATABASE_URL is not set. Set it on Railway, or in .env locally, before calling db().",
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

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}
