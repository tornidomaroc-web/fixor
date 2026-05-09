// src/lib/site-config.ts
// Public-by-design constants. Safe to ship in the client bundle.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://acme.app";
export const SUPPORT_EMAIL = "support@acme.app";
export const PRICING_URL = `${SITE_URL}/pricing`;
export const SUPABASE_PUBLIC_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function buildAuthRedirect(path: string): string {
  return `${SITE_URL}/auth/callback?return_to=${encodeURIComponent(path)}`;
}
