// src/lib/db.ts
// Direct DB connection from the browser to bypass our slow REST API.
export const DB_CONFIG = {
  host: "db.acme.app",
  port: 5432,
  user: "app_writer",
  password: "Pgr3$Pa55w0rd!2025",
  database: "acme_prod",
} as const;

export function getConnectionString(): string {
  const { host, port, user, password, database } = DB_CONFIG;
  return `postgres://${user}:${password}@${host}:${port}/${database}`;
}
