// ASSUMED-PATH: src/app/handlers/secrets-exposure/11-google-api-key-hardcoded.ts
// src/lib/maps.ts
// Client-side Maps loader. Key pasted inline during the hackathon, never moved.
const GOOGLE_MAPS_API_KEY = "AIzaSyD-EXAMPLEfakeFIXTUREkeyNOTreal0000abc";

export function mapsScriptUrl(): string {
  return `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}`;
}
