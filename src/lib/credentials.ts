export const CREDENTIAL_KEYS = [
  "aura_gemini_api_key",
  "supabase_url",
  "supabase_anon_key",
  "supabase_user_email",
  "supabase_user_password",
  "supabase_access_token",
  "openrouter_api_key",
  "sarvam_api_key",
  "cohere_api_key",
  "pinecone_api_key",
  "redis_url",
] as const;

export type CredentialKey = (typeof CREDENTIAL_KEYS)[number];

/**
 * Store — sessionStorage only, never localStorage.
 * This ensures credentials die with the tab or browser session.
 */
export function setCredential(key: CredentialKey, value: string): void {
  sessionStorage.setItem(key, value);
}

/**
 * Read from sessionStorage
 */
export function getCredential(key: CredentialKey): string {
  return sessionStorage.getItem(key) ?? "";
}

/**
 * Check if the USER has explicitly saved a valid key in sessionStorage.
 * Does NOT check env vars — this is for UI indicators only.
 * Runtime code should use getGeminiKey/getOpenRouterKey/getSarvamKey from api.ts instead.
 */
export function hasUserKey(key: CredentialKey): boolean {
  const val = getCredential(key);
  if (!val) return false;
  const k = val.trim();
  if (k === "" || k === "undefined" || k === "null") return false;
  // Type-specific validation (mirrors api.ts isValidKey)
  if (key === "aura_gemini_api_key") return k.startsWith("AIzaSy") && k.length === 39;
  if (key === "openrouter_api_key") return k.startsWith("sk-or-v1-") && k.length > 30;
  if (key === "sarvam_api_key") return k.startsWith("sk_") && k.length > 20;
  return k.length >= 8;
}

/**
 * Wipe all credentials at once.
 * Called after a confirmed successful data save.
 */
export function clearAllCredentials(): void {
  CREDENTIAL_KEYS.forEach((key) => {
    sessionStorage.removeItem(key);
    // Also clear any old localStorage remnants from previous builds
    localStorage.removeItem(key);
    localStorage.removeItem("gemini_api_key");
    localStorage.removeItem("supabase_url");
    localStorage.removeItem("supabase_key");
    localStorage.removeItem("supabase_anon_key");
    localStorage.removeItem("supabase_access_token");
  });
}

/**
 * Check if minimum required credentials exist for a session.
 * Uses the validated getGeminiKey() from api.ts to prevent garbage values.
 * NOTE: Inline check avoids circular import with api.ts.
 */
export function hasRequiredCredentials(): boolean {
  const k = getCredential("aura_gemini_api_key");
  return k.startsWith("AIzaSy") && k.length === 39;
}

/**
 * Check if optional Supabase credentials are provided for cloud sync.
 */
export function hasSupabaseCredentials(): boolean {
  return getCredential("supabase_url").length > 0 && getCredential("supabase_anon_key").length > 0;
}
