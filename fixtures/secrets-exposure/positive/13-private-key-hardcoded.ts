// ASSUMED-PATH: src/app/handlers/secrets-exposure/13-private-key-hardcoded.ts
// src/lib/signing.ts
// Service-account signing material inlined so local dev "just works".
const privateKey = "fixture-fake-private-key-material-not-real-000";

export function sign(payload: string): string {
  return `${payload}.${privateKey.length}`;
}
