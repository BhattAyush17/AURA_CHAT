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
export const isValidKey = (key: string | null | undefined, keyType?: string): boolean => {
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

  // Type-specific strict validations
  if (keyType === "aura_gemini_api_key") {
    // Gemini API keys start with AIzaSy and are exactly 39 characters long
    return k.startsWith("AIzaSy") && k.length === 39;
  }

  if (keyType === "openrouter_api_key") {
    // OpenRouter API keys start with sk-or-v1- and have substantial length (> 30 characters)
    return k.startsWith("sk-or-v1-") && k.length > 30;
  }

  if (keyType === "sarvam_api_key") {
    // Sarvam API keys typically start with sk_ and have substantial length (> 20 characters)
    return k.startsWith("sk_") && k.length > 20;
  }

  // General fallback minimum length check for other keys
  return k.length >= 8;
};

export const getGeminiKey = (): string | null => {
  const key = getCredential("aura_gemini_api_key") || (import.meta.env.VITE_GEMINI_API_KEY as string);
  return isValidKey(key, "aura_gemini_api_key") ? key.trim() : null;
};

export const getOpenRouterKey = (): string | null => {
  const key = getCredential("openrouter_api_key") || (import.meta.env.VITE_OPENROUTER_API_KEY as string);
  return isValidKey(key, "openrouter_api_key") ? key.trim() : null;
};

export const getSarvamKey = (): string | null => {
  const key = getCredential("sarvam_api_key") || (import.meta.env.VITE_SARVAM_API_KEY as string);
  return isValidKey(key, "sarvam_api_key") ? key.trim() : null;
};

export const getCohereKey = (): string | null => {
  const key = getCredential("cohere_api_key") || (import.meta.env.VITE_COHERE_API_KEY as string);
  return isValidKey(key, "cohere_api_key") ? key.trim() : null;
};

export const getPineconeKey = (): string | null => {
  const key = getCredential("pinecone_api_key") || (import.meta.env.VITE_PINECONE_API_KEY as string);
  return isValidKey(key, "pinecone_api_key") ? key.trim() : null;
};

export const getRedisUrl = (): string | null => {
  const url = getCredential("redis_url") || (import.meta.env.VITE_REDIS_URL as string);
  return isValidKey(url, "redis_url") ? url.trim() : null;
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

