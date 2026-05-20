const LOCAL_USER_KEY = "aura_user_id";

/**
 * Deterministic identity derivation using PBKDF2 + SHA-256.
 * same email always produces same userId.
 * No auth required, no network call, no secret.
 * Used to stabilize identity for users who bring their own Supabase.
 */
async function deriveUserId(email: string): Promise<string> {
  const encoder = new TextEncoder();
  const emailNorm = email.toLowerCase().trim();

  // Fallback for non-secure contexts where crypto.subtle is missing
  if (!crypto.subtle) {
    console.warn("[AURA] crypto.subtle missing, using simple fallback for identity");
    let hash = 0;
    for (let i = 0; i < emailNorm.length; i++) {
      hash = (hash << 5) - hash + emailNorm.charCodeAt(i);
      hash |= 0;
    }
    return `user_fallback_${Math.abs(hash).toString(16)}`;
  }

  const salt = "aura-identity-v1";
  try {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(emailNorm),
      { name: "PBKDF2" },
      false,
      ["deriveBits"],
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: encoder.encode(salt),
        iterations: 1000,
        hash: "SHA-256",
      },
      keyMaterial,
      128,
    );

    const hex = Array.from(new Uint8Array(bits))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return `user_${hex}`;
  } catch (e) {
    console.warn("[AURA] Identity derivation failed, using random ID:", e);
    return `user_err_${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * Resolves the current user's identity.
 *
 * Flow:
 * 1. If a Supabase email is provided, derive a stable ID from it.
 * 2. If no email, use the existing persisted random ID.
 * 3. If neither, generate and persist a fresh random ID.
 */
export async function resolveUserId(supabaseEmail?: string): Promise<string> {
  // If user has provided their Supabase email,
  // derive userId from it — survives any browser clear
  if (supabaseEmail?.trim()) {
    const derived = await deriveUserId(supabaseEmail.trim().toLowerCase());
    // Persist so subsequent loads without email still work
    localStorage.setItem(LOCAL_USER_KEY, derived);
    return derived;
  }

  // No email — use existing random ID or generate one
  return getCurrentUserId();
}

export function getCurrentUserId(): string {
  const existing = localStorage.getItem(LOCAL_USER_KEY);
  if (existing) return existing;

  const fresh = `user_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  localStorage.setItem(LOCAL_USER_KEY, fresh);
  return fresh;
}
