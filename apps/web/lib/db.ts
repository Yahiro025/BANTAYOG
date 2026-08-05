// Typed Supabase service client for apps/web API routes.
// Uses the env helper to resolve SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// with NEXT_PUBLIC_ fallbacks so the backend works out of the box in dev.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@bantayog/db";
import {
  getSupabaseUrl,
  getSupabaseServiceRoleKey,
} from "./env";

let _serviceDbClient: SupabaseClient<Database> | null = null;

// Returns a typed Supabase client with the service role key.
// Bypasses RLS — use only for privileged server operations.
export function createServiceDbClient(): SupabaseClient<Database> {
  const url = getSupabaseUrl();
  const serviceKey = getSupabaseServiceRoleKey();

  return createClient<Database>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Lazily-initialized singleton service client.
export function getServiceDbClient(): SupabaseClient<Database> {
  if (!_serviceDbClient) {
    _serviceDbClient = createServiceDbClient();
  }
  return _serviceDbClient;
}
