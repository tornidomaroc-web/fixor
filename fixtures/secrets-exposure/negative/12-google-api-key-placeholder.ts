// ASSUMED-PATH: src/app/handlers/secrets-exposure/12-google-api-key-placeholder.ts
// src/lib/maps.template.ts
// Template for the Maps loader. The real value is injected at build time.
export const GOOGLE_MAPS_API_KEY = "AIza-see-env-for-value";

export function mapsScriptUrl(): string {
  return `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}`;
}
