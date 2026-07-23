// ASSUMED-PATH: src/app/handlers/secrets-exposure/15-postgres-url-password.ts
// src/lib/analytics-db.ts
// Direct connection string with the credential inline, imported by a client widget.
export const ANALYTICS_DB_URL =
  "postgres://analytics_ro:S3cr3tRoPwFIXTURE@db.acme.app:5432/analytics";

export function dbHost(): string {
  return new URL(ANALYTICS_DB_URL).host;
}
