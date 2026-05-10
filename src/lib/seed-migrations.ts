import { SeedData, SEED_VERSION } from "./storage/types";

/**
 * Migrates old seed data formats to the current version.
 * This ensures that future changes to the seed structure don't
 * break existing user memories.
 *
 * Add a new case here every time SEED_VERSION increments.
 */
export function migrateSeed(raw: unknown): SeedData | null {
  if (!raw || typeof raw !== "object") return null;

  const s = raw as Record<string, unknown>;

  // No version field — this is a pre-versioning seed (version 0)
  // Attempt to salvage it by mapping old fields to the new structure
  if (!s.version) {
    if (typeof s.seed === "string" && s.seed.includes("[SEED]")) {
      console.log("[Migration] Salvaging legacy seed (v0 -> v1)");
      return {
        version: SEED_VERSION,
        seed: s.seed,
        auraState: typeof s.auraState === "string" ? s.auraState : "present",
        growth: Array.isArray(s.growth) ? s.growth : [],
        updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
      };
    }
    return null; // Unrecoverable format
  }

  // Version 1 — current format, no migration needed
  if (s.version === 1) {
    return raw as SeedData;
  }

  // Future versions go here:
  // if (s.version === 2) { ... migrate v2 -> v3 ... }

  // Unknown future version loaded on an older client
  // Return as-is and hope for the best — do not discard the data
  return raw as SeedData;
}
