import { getCredential } from "./credentials";

/**
 * Returns the Gemini API key.
 *
 * Priority:
 *   1. sessionStorage (set via the in-app settings UI)
 *
 * FINAL ARCHITECTURE: No environment variables, no hardcoded keys.
 * AURA runs entirely on user-provided credentials.
 */
export const getGeminiKey = () => {
  return sessionStorage.getItem("aura_gemini_api_key");
};

export const getOpenRouterKey = () => {
  return sessionStorage.getItem("aura_openrouter_api_key");
};

/**
 * Get Supabase credentials from secure session storage
 */
export function getSupabaseUrl(): string {
  return getCredential("supabase_url");
}

export function getSupabaseKey(): string {
  return getCredential("supabase_anon_key");
}
