// ASSUMED-PATH: src/app/handlers/secrets-exposure/07-config-route-leaks-service-role.ts
// src/app/api/config/route.ts
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
