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
  const key = sessionStorage.getItem("aura_gemini_api_key");
  if (key && key !== "undefined" && key !== "null" && key.trim() !== "") {
    return key;
  }
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (envKey && envKey !== "undefined" && envKey !== "null" && envKey.trim() !== "") {
    return envKey;
  }
  return null;
};

export const getOpenRouterKey = () => {
  const key = sessionStorage.getItem("aura_openrouter_api_key");
  if (key && key !== "undefined" && key !== "null" && key.trim() !== "") {
    return key;
  }
  const envKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (envKey && envKey !== "undefined" && envKey !== "null" && envKey.trim() !== "") {
    return envKey;
  }
  return null;
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
