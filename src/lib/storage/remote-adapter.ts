/**
 * Remote Storage Adapter - Supabase with Cloud Sync Cap Enforcement
 *
 * Flow:
 * 1. Check if cloud sync is enabled
 * 2. Check if under conversation cap (5 conversations max)
 * 3. Attempt to save to Supabase
 * 4. If cap reached or connection fails, return false (signals fallback to browser storage)
 */

import { StorageAdapter, SessionData, SeedData } from "./types";
import { getUsageStats, incrementUsage, isCloudSyncAvailable } from "../usage-tracker";
import { migrateSeed } from "../seed-migrations";

export class SupabaseRemoteAdapter implements StorageAdapter {
  private apiUrl: string;
  private apiKey: string;
  private userId: string;
  private accessToken: string | null;

  constructor(apiUrl: string, apiKey: string, userId: string, accessToken: string | null = null) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.userId = userId;
    this.accessToken = accessToken;
  }

  /**
   * Test connection to Supabase
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/rest/v1/aura_storage?select=id&limit=1`, {
        method: "GET",
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        console.warn(`[Supabase] Connection test failed: ${response.statusText}`);
        return false;
      }

      console.log("[Supabase] ✓ Connection successful");
      return true;
    } catch (err) {
      console.error("[Supabase] Connection test failed:", err);
      return false;
    }
  }

  /**
   * Save session with cloud sync cap enforcement
   * Returns true if saved to cloud, false if should fall back to browser storage
   */
  async save(data: SessionData): Promise<boolean> {
    // Check if cloud sync is enabled
    const cloudSyncEnabled = localStorage.getItem("aura_cloud_sync_enabled") === "true";
    if (!cloudSyncEnabled) {
      console.log("[Cloud Sync] Disabled. Using browser storage.");
      return false;
    }

    // Check if we're under the conversation cap
    const canSync = isCloudSyncAvailable();
    if (!canSync) {
      console.warn("[Cloud Sync Cap] Reached 5 conversation limit. Using browser storage.");
      return false;
    }

    try {
      const payload = {
        user_id: this.userId,
        key: `session_${data.session_id}`,
        data: data,
        updated_at: new Date().toISOString(),
      };

      const response = await fetch(`${this.apiUrl}/rest/v1/aura_storage`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Supabase error: ${response.statusText}`);
      }

      // Increment usage on successful save
      incrementUsage(this.userId, "conversation");
      const stats = getUsageStats(this.userId);
      console.log(`[Cloud Sync] ✓ Saved to Supabase. Usage: ${stats.conversations}`);

      return true;
    } catch (err) {
      console.error("[Supabase] Save failed:", err);
      console.log("[Fallback] Saving to browser storage instead.");
      return false;
    }
  }

  /**
   * Retrieve session from Supabase
   */
  async retrieve(sessionId: string): Promise<SessionData | null> {
    try {
      const response = await fetch(
        `${this.apiUrl}/rest/v1/aura_storage?key=eq.session_${sessionId}&select=data`,
        {
          method: "GET",
          headers: this.getHeaders(),
        },
      );

      if (!response.ok) return null;

      const data = await response.json();
      if (data.length > 0) {
        console.log(`[Supabase] ✓ Retrieved session: ${sessionId}`);
        return data[0].data;
      }

      return null;
    } catch (err) {
      console.error("[Supabase] Retrieve failed:", err);
      return null;
    }
  }

  /**
   * List all sessions for user
   */
  async list(): Promise<SessionData[]> {
    try {
      const response = await fetch(
        `${this.apiUrl}/rest/v1/aura_storage?user_id=eq.${this.userId}&select=data`,
        {
          method: "GET",
          headers: this.getHeaders(),
        },
      );

      if (!response.ok) return [];

      const data = await response.json();
      console.log(`[Supabase] ✓ Retrieved ${data.length} sessions`);
      return data.map((row: any) => row.data);
    } catch (err) {
      console.error("[Supabase] List failed:", err);
      return [];
    }
  }

  /**
   * Delete a session
   */
  async delete(sessionId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.apiUrl}/rest/v1/aura_storage?key=eq.session_${sessionId}`,
        {
          method: "DELETE",
          headers: this.getHeaders(),
        },
      );

      if (response.ok) {
        console.log(`[Supabase] ✓ Deleted session: ${sessionId}`);
      }

      return response.ok;
    } catch (err) {
      console.error("[Supabase] Delete failed:", err);
      return false;
    }
  }

  /**
   * Get storage status
   */
  getStatus() {
    return {
      mode: "remote",
      synced: true,
      lastSync: new Date().toISOString(),
    };
  }

  /**
   * Save seed to Supabase
   */
  async saveSeed(userId: string, seed: SeedData): Promise<boolean> {
    const stats = await getUsageStats(userId);
    if (stats.conversations >= 5) {
      console.warn("[Cloud Storage] Seed sync skipped - Cap reached");
      return false;
    }

    try {
      const response = await fetch(`${this.apiUrl}/rest/v1/aura_storage`, {
        method: "POST",
        headers: {
          ...this.getHeaders(),
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          user_id: userId,
          key: "aura_seed",
          data: seed,
          updated_at: new Date().toISOString(),
        }),
      });

      return response.ok;
    } catch (err) {
      console.error("[Cloud Storage] Seed save failed:", err);
      return false;
    }
  }

  /**
   * Load seed from Supabase
   */
  async loadSeed(userId: string): Promise<SeedData | null> {
    try {
      const response = await fetch(
        `${this.apiUrl}/rest/v1/aura_storage?user_id=eq.${userId}&key=eq.aura_seed&select=data`,
        {
          method: "GET",
          headers: this.getHeaders(),
        },
      );

      if (!response.ok) return null;

      const rows = await response.json();
      if (rows.length === 0) return null;

      const rawData = rows[0].data;
      const migrated = migrateSeed(rawData);
      if (!migrated) return null;

      // Backfill upgraded seed to cloud if version changed
      if (!rawData.version || rawData.version < migrated.version) {
        await fetch(`${this.apiUrl}/rest/v1/aura_storage`, {
          method: "POST",
          headers: {
            ...this.getHeaders(),
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify({
            user_id: userId,
            key: "aura_seed",
            data: migrated,
            updated_at: new Date().toISOString(),
          }),
        });
      }

      return migrated;
    } catch {
      return null;
    }
  }

  /**
   * Get HTTP headers for Supabase
   */
  private getHeaders(): Record<string, string> {
    return {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.accessToken || this.apiKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };
  }
}
