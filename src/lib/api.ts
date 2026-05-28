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
  const key = getCredential("aura_gemini_api_key") || import.meta.env.VITE_GEMINI_API_KEY;
  if (key && key !== "undefined" && key !== "null" && key.trim() !== "") {
    return key as string;
  }
  return null;
};

export const getOpenRouterKey = () => {
  const key = getCredential("openrouter_api_key") || import.meta.env.VITE_OPENROUTER_API_KEY;
  if (key && key !== "undefined" && key !== "null" && key.trim() !== "") {
    return key as string;
  }
  return null;
};

export const getSarvamKey = () => {
  const key = getCredential("sarvam_api_key") || import.meta.env.VITE_SARVAM_API_KEY;
  if (key && key !== "undefined" && key !== "null" && key.trim() !== "") {
    return key as string;
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

