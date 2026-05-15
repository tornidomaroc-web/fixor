// ASSUMED-PATH: src/app/handlers/secrets-exposure/01-supabase-service-role-server-only.ts
// src/server/admin/supabase.ts
import { createClient } from "@supabase/supabase-js";
import "server-only";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

export async function listAllTenants() {
  return adminClient.from("tenants").select("*");
}
