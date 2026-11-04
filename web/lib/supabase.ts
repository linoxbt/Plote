// Browser-side Supabase (anon key; public reads only — RLS allows select on events, chipins, evidence_files).
// Writes go through API routes with the service-role key (lib/server/supabase-admin.ts).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, TABLES, SUPABASE_BUCKET } from "./config";

export { TABLES, SUPABASE_BUCKET };

let client: SupabaseClient | null | undefined;

export function supabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  client = supabaseConfigured() ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } }) : null;
  return client;
}

export type EventRecord = {
  id: number; network: string; estate: string; unit: string | null; standard: string; event: string;
  data: Record<string, unknown>; tx_hash: string; block_height: number; block_time: string;
};

export type ChipinRecord = {
  id: number; estate: string; unit: string; tx_hash: string | null; deposit_address: string | null;
  display_name: string | null; note: string | null; amount: string | null; created_at: string;
};

export type EvidenceFileRecord = {
  id: string; estate: string; evidence_id: number | null; path: string; sha256: string;
  uploaded_by: string; exif: Record<string, unknown> | null; created_at: string;
};

/** Recent events for an estate (optionally one unit) from the cache. Returns [] when not configured. */
export async function recentEvents(estate: string, opts: { unit?: string; limit?: number } = {}): Promise<EventRecord[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from(TABLES.events).select("*").eq("estate", estate).order("block_height", { ascending: false }).limit(opts.limit ?? 30);
  if (opts.unit) q = q.eq("unit", opts.unit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as EventRecord[];
}

export async function chipins(estate: string, unit: string): Promise<ChipinRecord[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from(TABLES.chipins).select("*").eq("estate", estate).eq("unit", unit).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as ChipinRecord[];
}

export async function evidenceFileByHash(sha256: string): Promise<EvidenceFileRecord | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from(TABLES.evidenceFiles).select("*").eq("sha256", sha256).limit(1).maybeSingle();
  return (data as EvidenceFileRecord | null) ?? null;
}
