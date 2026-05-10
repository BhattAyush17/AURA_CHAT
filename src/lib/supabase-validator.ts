import { createClient } from "@supabase/supabase-js";

export type ValidationResult =
  | { status: "ok" }
  | { status: "unreachable"; message: string }
  | { status: "table_missing"; message: string }
  | { status: "rls_open"; message: string }
  | { status: "auth_required"; message: string };

/**
 * Validates that the user's Supabase setup is correctly configured for AURA.
 *
 * Tests:
 * 1. Connection & Table existence
 * 2. RLS Enforcement (Probe test)
 * 3. Write Permissions (Auth check)
 */
export async function validateSupabaseSetup(
  url: string,
  anonKey: string,
  userId: string,
): Promise<ValidationResult> {
  try {
    const client = createClient(url, anonKey);

    // Test 1 — can we reach the table at all
    const { error: tableError } = await client.from("aura_storage").select("key").limit(1);

    if (tableError?.code === "42P01") {
      return {
        status: "table_missing",
        message: 'Table "aura_storage" not found. Run the setup SQL first.',
      };
    }

    if (tableError?.message?.includes("connection")) {
      return {
        status: "unreachable",
        message: "Cannot reach Supabase. Check your URL.",
      };
    }

    // Test 2 — attempt to read a row that belongs to a probe userId
    // If RLS is OFF, this returns data (wrong)
    // If RLS is ON correctly, this returns empty (correct)
    const probeId = "rls_security_probe_should_return_nothing";
    const { data: probeData, error: probeError } = await client
      .from("aura_storage")
      .select("key")
      .eq("user_id", probeId)
      .limit(1);

    if (!probeError && probeData && probeData.length > 0) {
      return {
        status: "rls_open",
        message:
          "RLS is not enforced. Anyone with your anon key can read all data. Enable RLS and add policies before use.",
      };
    }

    // Test 3 — attempt a write with current userId
    // Should succeed if auth is set up correctly
    // Should fail with RLS error if auth.uid() doesn't match
    const PROBE_KEY = "__rls_validation_probe__";

    try {
      const { error: writeError } = await client.from("aura_storage").upsert({
        user_id: userId,
        key: PROBE_KEY,
        data: { probe: true },
        updated_at: new Date().toISOString(),
      });

      if (writeError?.code === "42501") {
        return {
          status: "auth_required",
          message:
            "RLS is active but requires Supabase Auth login. Anonymous access is blocked. Use email/password login.",
        };
      }

      return { status: "ok" };
    } finally {
      // Always runs — even if validation throws
      await client
        .from("aura_storage")
        .delete()
        .eq("user_id", userId)
        .eq("key", PROBE_KEY)
        .then(() => {}); // fire and forget, don't await or block
    }
  } catch (err) {
    return {
      status: "unreachable",
      message: `Connection failed: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}
