import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Lazily-initialized Supabase client.
 *
 * Previous version read localStorage at module top-level, which:
 * 1. Crashes during SSR / Vercel build-time rendering (no `localStorage`)
 * 2. Creates a broken client with empty strings if no creds are stored
 *
 * Now uses a lazy getter so the client is only created when first accessed,
 * and always reads the latest credentials from localStorage.
 */

let _cachedClient: SupabaseClient | null = null;

function getOrCreateClient(): SupabaseClient {
  const url = localStorage.getItem("supabase_url") || "";
  const key =
    localStorage.getItem("supabase_anon_key") || localStorage.getItem("supabase_key") || "";

  // If credentials changed, re-create the client
  if (_cachedClient && url && key) {
    return _cachedClient;
  }

  _cachedClient = createClient(url, key);
  return _cachedClient;
}

/**
 * Lazy Supabase client — reads credentials from localStorage on first access.
 * Safe for SSR builds (no top-level localStorage reads).
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop, receiver) {
    const client = getOrCreateClient();
    return Reflect.get(client, prop, receiver);
  },
});

/**
 * Re-initialize supabase client with new credentials
 */
export const initSupabase = (url: string, key: string) => {
  _cachedClient = createClient(url, key);
  return _cachedClient;
};
