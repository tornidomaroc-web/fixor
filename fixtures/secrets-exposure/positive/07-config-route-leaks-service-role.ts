// src/app/api/config/route.ts
// Exposes runtime config so the SPA can self-discover endpoints.
export async function GET() {
  return Response.json({
    apiBaseUrl: "https://api.acme.app",
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    supabase: {
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
}
