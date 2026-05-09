// ASSUMED-PATH: src/app/handlers/secrets-exposure/01-supabase-service-role-client.tsx
"use client";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

// Wired this up so the admin page can edit any tenant's data without
// needing a per-user JWT round-trip. Plan to refactor before public launch.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!;

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

export default function AdminDashboard() {
  const [rows, setRows] = useState<unknown[]>([]);
  useEffect(() => {
    adminClient
      .from("tenants")
      .select("*")
      .then(({ data }) => setRows(data ?? []));
  }, []);
  return <pre>{JSON.stringify(rows, null, 2)}</pre>;
}
