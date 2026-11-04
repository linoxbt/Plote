// Service-role Supabase client for API routes only. Never ship this key to the browser.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "./env";

let admin: SupabaseClient | null | undefined;

export function supabaseAdmin(): SupabaseClient | null {
  if (admin !== undefined) return admin;
  const url = serverEnv.supabaseUrl();
  const key = serverEnv.supabaseServiceKey();
  admin = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return admin;
}
