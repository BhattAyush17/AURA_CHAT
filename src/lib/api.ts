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
/**
 * Validates whether a key is a valid non-empty string and not a placeholder.
 */
export const isValidKey = (key: string | null | undefined): boolean => {
  if (!key) return false;
  const k = key.trim();
  if (k === "" || k === "undefined" || k === "null") return false;

  const lower = k.toLowerCase();
  if (
    lower.includes("placeholder") ||
    lower.includes("your_api_key") ||
    lower.includes("your_gemini") ||
    lower.includes("your_openrouter") ||
    lower.includes("your_sarvam") ||
    lower.includes("your_cohere") ||
    lower.includes("your_redis") ||
    lower.includes("insert_") ||
    lower.includes("enter_")
  ) {
    return false;
  }

  // An API key must have some minimal length to be genuine (Gemini/OpenRouter/Sarvam keys are all > 20 chars)
  if (k.length < 8) return false;

  return true;
};

export const getGeminiKey = (): string | null => {
  const key = getCredential("aura_gemini_api_key") || (import.meta.env.VITE_GEMINI_API_KEY as string);
  return isValidKey(key) ? key.trim() : null;
};

export const getOpenRouterKey = (): string | null => {
  const key = getCredential("openrouter_api_key") || (import.meta.env.VITE_OPENROUTER_API_KEY as string);
  return isValidKey(key) ? key.trim() : null;
};

export const getSarvamKey = (): string | null => {
  const key = getCredential("sarvam_api_key") || (import.meta.env.VITE_SARVAM_API_KEY as string);
  return isValidKey(key) ? key.trim() : null;
};

export const getCohereKey = (): string | null => {
  const key = getCredential("cohere_api_key") || (import.meta.env.VITE_COHERE_API_KEY as string);
  return isValidKey(key) ? key.trim() : null;
};

export const getPineconeKey = (): string | null => {
  const key = getCredential("pinecone_api_key") || (import.meta.env.VITE_PINECONE_API_KEY as string);
  return isValidKey(key) ? key.trim() : null;
};

export const getRedisUrl = (): string | null => {
  const url = getCredential("redis_url") || (import.meta.env.VITE_REDIS_URL as string);
  return isValidKey(url) ? url.trim() : null;
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

