import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase configuration.
 *
 * When you link this repo to Supabase (see README / chat instructions),
 * add these two env vars (`.env.local`) — they're exposed to the browser on
 * purpose because this is a 2-person private app using the anon key + RLS:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
 *
 * If the vars are missing, the app automatically falls back to a local
 * "demo mode" (localStorage + BroadcastChannel) so two browser tabs act as
 * the two people. This keeps the preview fully interactive without a backend.
 */

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured =
  supabaseUrl.length > 0 &&
  supabaseAnonKey.length > 0 &&
  supabaseUrl.startsWith("http");

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!_client) {
    _client = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return _client;
}
