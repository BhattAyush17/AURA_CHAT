import { SessionData, StorageAdapter, SeedData } from "./types";
import { migrateSeed } from "../seed-migrations";

const CONVERSATIONS_KEY = "aura_storage_conversations";

export class BrowserAdapter implements StorageAdapter {
  /**
   * Save session to localStorage
   */
  async save(data: SessionData): Promise<boolean> {
    try {
      const sessions = await this.list();
      const index = sessions.findIndex((s) => s.session_id === data.session_id);

      if (index >= 0) {
        sessions[index] = data;
      } else {
        sessions.push(data);
      }

      try {
        localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(sessions));
        return true;
      } catch (err) {
        // Handle localStorage quota limit (usually 5MB)
        if (
          err instanceof DOMException &&
          (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED")
        ) {
          console.warn("[Browser Storage] Quota exceeded. Trimming oldest sessions...");

          const currentSessions = await this.list();
          // Sort by last_active and drop the 3 oldest
          const trimmed = currentSessions
            .sort((a, b) => new Date(a.last_active).getTime() - new Date(b.last_active).getTime())
            .slice(3);

          // Retry save with the new data included
          const retryList = [...trimmed.filter((s) => s.session_id !== data.session_id), data];
          localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(retryList));
          return true;
        }
        throw err;
      }
    } catch (err) {
      console.error("[Browser Storage] Save failed:", err);
      return false;
    }
  }

  /**
   * Retrieve session from localStorage
   */
  async retrieve(sessionId: string): Promise<SessionData | null> {
    try {
      const sessions = await this.list();
      return sessions.find((s) => s.session_id === sessionId) || null;
    } catch {
      return null;
    }
  }

  /**
   * List all sessions in localStorage
   */
  async list(): Promise<SessionData[]> {
    try {
      const stored = localStorage.getItem(CONVERSATIONS_KEY);
      if (!stored) return [];
      return JSON.parse(stored);
    } catch {
      return [];
    }
  }

  /**
   * Delete session from localStorage
   */
  async delete(sessionId: string): Promise<boolean> {
    try {
      const sessions = await this.list();
      const filtered = sessions.filter((s) => s.session_id !== sessionId);
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(filtered));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get storage status
   */
  getStatus() {
    return {
      mode: "browser",
      synced: false,
      lastSync: new Date().toISOString(),
    };
  }

  /**
   * Save seed to localStorage
   */
  async saveSeed(userId: string, seed: SeedData): Promise<boolean> {
    try {
      localStorage.setItem(`aura_seed_${userId}`, JSON.stringify(seed));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load seed from localStorage
   */
  async loadSeed(userId: string): Promise<SeedData | null> {
    try {
      const stored = localStorage.getItem(`aura_seed_${userId}`);
      if (!stored) return null;

      const parsed = JSON.parse(stored);
      const migrated = migrateSeed(parsed);

      if (!migrated) return null;

      // If migration changed the version, save the upgraded seed back
      if (!parsed.version || parsed.version < migrated.version) {
        localStorage.setItem(`aura_seed_${userId}`, JSON.stringify(migrated));
      }

      return migrated;
    } catch {
      return null;
    }
  }
}
