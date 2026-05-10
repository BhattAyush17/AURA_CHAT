/**
 * Storage Manager - Intelligent fallback between cloud and browser storage
 *
 * Priority:
 * 1. Try cloud storage (Supabase) if enabled and under cap
 * 2. Fall back to browser storage if cloud fails or cap reached
 * 3. Always have a working storage
 */

import { BrowserAdapter } from "./browser-adapter";
import { SupabaseRemoteAdapter } from "./remote-adapter";
import { StorageAdapter, SessionData, SeedData } from "./types";
import { getCredential } from "../credentials";

export class StorageManager {
  private browserAdapter: BrowserAdapter;
  private remoteAdapter: SupabaseRemoteAdapter | null = null;
  private userId: string;

  constructor(userId: string = "local-user") {
    this.userId = userId;
    this.browserAdapter = new BrowserAdapter();
    this.initializeRemoteAdapter();
  }

  /**
   * Update userId and re-initialize remote adapter
   */
  setUserId(newUserId: string) {
    this.userId = newUserId;
    this.initializeRemoteAdapter();
  }

  /**
   * Initialize remote adapter if credentials are available
   */
  public initializeRemoteAdapter() {
    const supabaseUrl = getCredential("supabase_url");
    const supabaseKey = getCredential("supabase_anon_key");
    const accessToken = getCredential("supabase_access_token");
    const cloudSyncEnabled = localStorage.getItem("aura_cloud_sync_enabled") === "true";

    if (supabaseUrl && supabaseKey && cloudSyncEnabled) {
      this.remoteAdapter = new SupabaseRemoteAdapter(
        supabaseUrl,
        supabaseKey,
        this.userId,
        accessToken,
      );
    } else {
      this.remoteAdapter = null;
    }
  }

  /**
   * Save session with intelligent fallback
   * 1. Try remote storage (Supabase)
   * 2. Fall back to browser storage if remote fails/cap reached
   * 3. Always save to browser as backup
   */
  async save(data: SessionData): Promise<boolean> {
    let cloudSuccess = false;

    // Try cloud storage first if available
    if (this.remoteAdapter) {
      cloudSuccess = await this.remoteAdapter.save(data);
    }

    // Always save to browser storage as backup
    try {
      await this.browserAdapter.save(data);
      console.log(
        `[Storage] Saved to browser ${cloudSuccess ? "and cloud" : "(cloud unavailable)"}`,
      );
      return true;
    } catch (err) {
      console.error("[Storage] Failed to save to browser storage:", err);
      return false;
    }
  }

  /**
   * Retrieve session
   * Try browser storage first (faster), fall back to cloud
   */
  async retrieve(sessionId: string): Promise<SessionData | null> {
    // Try browser storage first
    try {
      const browserData = await this.browserAdapter.retrieve(sessionId);
      if (browserData) {
        console.log(`[Storage] Retrieved from browser`);
        return browserData;
      }
    } catch (err) {
      console.warn("[Storage] Browser retrieval failed:", err);
    }

    // Fall back to cloud storage
    if (this.remoteAdapter) {
      try {
        const cloudData = await this.remoteAdapter.retrieve(sessionId);
        if (cloudData) {
          console.log(`[Storage] Retrieved from cloud`);
          return cloudData;
        }
      } catch (err) {
        console.warn("[Storage] Cloud retrieval failed:", err);
      }
    }

    console.log(`[Storage] Session not found: ${sessionId}`);
    return null;
  }

  /**
   * List all sessions
   * Combine from both sources and deduplicate
   */
  async list(): Promise<SessionData[]> {
    const browserSessions = await this.browserAdapter.list();
    const cloudSessions = this.remoteAdapter ? await this.remoteAdapter.list() : [];

    // Deduplicate by session_id
    const sessionMap = new Map<string, SessionData>();

    for (const session of browserSessions) {
      sessionMap.set(session.session_id, session);
    }

    for (const session of cloudSessions) {
      // Cloud sessions take precedence if more recent
      const existing = sessionMap.get(session.session_id);
      if (
        !existing ||
        new Date(session.last_active).getTime() > new Date(existing.last_active).getTime()
      ) {
        sessionMap.set(session.session_id, session);
      }
    }

    console.log(
      `[Storage] Listed ${sessionMap.size} sessions (${browserSessions.length} browser, ` +
        `${cloudSessions.length} cloud)`,
    );

    return Array.from(sessionMap.values());
  }

  /**
   * Delete session from both storages
   */
  async delete(sessionId: string): Promise<boolean> {
    let browserSuccess = false;
    let cloudSuccess = false;

    try {
      browserSuccess = await this.browserAdapter.delete(sessionId);
    } catch (err) {
      console.warn("[Storage] Browser delete failed:", err);
    }

    if (this.remoteAdapter) {
      try {
        cloudSuccess = await this.remoteAdapter.delete(sessionId);
      } catch (err) {
        console.warn("[Storage] Cloud delete failed:", err);
      }
    }

    const success = browserSuccess || cloudSuccess;
    console.log(
      `[Storage] Deleted from ${browserSuccess ? "browser" : ""} ${
        cloudSuccess ? "and cloud" : ""
      }`,
    );

    return success;
  }

  /**
   * Save seed - Parallel sync to both layers
   */
  async saveSeed(seed: SeedData): Promise<void> {
    const saves: Promise<any>[] = [];

    // Always save to browser
    saves.push(this.browserAdapter.saveSeed(this.userId, seed));

    // Save to cloud if available, ignoring conversation cap for identity persistence
    if (this.remoteAdapter) {
      saves.push(
        this.remoteAdapter.saveSeed(this.userId, seed).catch((err) => {
          console.warn("[Cloud Storage] Seed save failed, localStorage has it:", err);
        }),
      );
    }

    await Promise.allSettled(saves);
  }

  /**
   * Load seed - Compare timestamps and backfill stale layers
   */
  async loadSeed(): Promise<SeedData | null> {
    const [browserRes, remoteRes] = await Promise.allSettled([
      this.browserAdapter.loadSeed(this.userId),
      this.remoteAdapter ? this.remoteAdapter.loadSeed(this.userId) : Promise.resolve(null),
    ]);

    const browser = browserRes.status === "fulfilled" ? browserRes.value : null;
    const remote = remoteRes.status === "fulfilled" ? remoteRes.value : null;

    if (!browser && !remote) return null;
    if (!browser) return remote;
    if (!remote) return browser;

    const newer = browser.updatedAt > remote.updatedAt ? browser : remote;

    // Silent backfill: Sync the newer one back to the stale layer
    if (browser.updatedAt > remote.updatedAt && this.remoteAdapter) {
      this.remoteAdapter.saveSeed(this.userId, browser).catch(() => {});
    } else if (remote.updatedAt > browser.updatedAt) {
      this.browserAdapter.saveSeed(this.userId, remote).catch(() => {});
    }

    return newer;
  }

  /**
   * Test cloud connection
   */
  async testCloudConnection(): Promise<boolean> {
    if (!this.remoteAdapter) {
      console.warn("[Storage] Remote adapter not initialized");
      return false;
    }

    return await this.remoteAdapter.testConnection();
  }

  /**
   * Get storage status
   */
  getStatus(): {
    browserAvailable: boolean;
    cloudAvailable: boolean;
    cloudEnabled: boolean;
  } {
    return {
      browserAvailable: true,
      cloudAvailable: this.remoteAdapter !== null,
      cloudEnabled: localStorage.getItem("aura_cloud_sync_enabled") === "true",
    };
  }
}

// Singleton instance
let storageManagerInstance: StorageManager | null = null;

/**
 * Get or create storage manager instance
 */
export const getStorageManager = (userId?: string): StorageManager => {
  if (!storageManagerInstance) {
    storageManagerInstance = new StorageManager(userId || "local-user");
  }
  return storageManagerInstance;
};

/**
 * Reset storage manager (useful for testing)
 */
export const resetStorageManager = (): void => {
  storageManagerInstance = null;
};
