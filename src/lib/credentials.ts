export const CREDENTIAL_KEYS = [
  "aura_gemini_api_key",
  "supabase_url",
  "supabase_anon_key",
  "supabase_user_email",
  "supabase_user_password",
  "supabase_access_token",
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
 * AURA cannot start without a Gemini API key.
 */
export function hasRequiredCredentials(): boolean {
  return getCredential("aura_gemini_api_key").length > 0;
}

/**
 * Check if optional Supabase credentials are provided for cloud sync.
 */
export function hasSupabaseCredentials(): boolean {
  return getCredential("supabase_url").length > 0 && getCredential("supabase_anon_key").length > 0;
}
