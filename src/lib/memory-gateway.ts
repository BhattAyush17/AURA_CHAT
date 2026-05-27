/**
 * AURA Phase 3 — Memory Gateway (L3 Interface)
 *
 * Unified memory interface that delegates to either:
 *   Mode A: Supabase (connected, persistent, cross-device)
 *   Mode B: Local Browser (localStorage, single device)
 *
 * L3 contract (same regardless of mode):
 *   retrieve_memories(query, user_id, emotional_state) → list[dict]
 *     keys: content, metadata, similarity, emotional_match
 *     max 5 results, max 400 tokens when formatted
 *
 *   store_memory(content, user_id, emotional_tags) → bool
 *
 * L4 and system prompt assembly never change.
 * Storage mode is invisible above L3.
 */

import { ENDPOINTS } from "@/config/api";
import {
  storeLocalMemory,
  retrieveLocalMemories,
  type LocalMemoryEntry,
} from "@/lib/local-memory";

// Re-export MemoryResult from local-memory so consumers import from gateway
export type { MemoryResult } from "@/lib/local-memory";
import type { MemoryResult } from "@/lib/local-memory";

// ─── Types ───────────────────────────────────────────────────────

export type MemoryMode = "supabase" | "local";

export interface MemoryGatewayState {
  mode: MemoryMode;
  ready: boolean;
  supabaseReachable: boolean;
  lastPingMs: number;
}

// ─── Supabase health ping ────────────────────────────────────────

/**
 * Ping backend /health endpoint to determine Supabase availability.
 * Handles both the detailed health response (checks.supabase.ok)
 * and the legacy simplified response (supabase_connected).
 */
async function pingSupabase(timeoutMs: number = 3000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(ENDPOINTS.health, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json();
    // Detailed health endpoint: { checks: { supabase: { ok: true } } }
    if (data?.checks?.supabase?.ok === true) return true;
    // Legacy simplified health: { supabase_connected: true }
    if (data?.supabase_connected === true) return true;
    // Status-based check: if overall status is healthy/degraded, supabase may be up
    // But we only trust explicit supabase fields
    return false;
  } catch {
    return false;
  }
}

// ─── Memory Gateway Class ────────────────────────────────────────

export class MemoryGateway {
  private _mode: MemoryMode = "local";
  private _ready = false;
  private _supabaseReachable = false;
  private _promptShownThisSession = false;

  get mode(): MemoryMode { return this._mode; }
  get ready(): boolean { return this._ready; }
  get supabaseReachable(): boolean { return this._supabaseReachable; }

  getState(): MemoryGatewayState {
    return {
      mode: this._mode,
      ready: this._ready,
      supabaseReachable: this._supabaseReachable,
      lastPingMs: Date.now(),
    };
  }

  /**
   * Initialize the gateway: detect active mode.
   *
   * On app init:
   *   → try ping Supabase
   *   → success: active_memory_mode = "supabase"
   *   → failure: active_memory_mode = "local"
   */
  async initialize(): Promise<MemoryMode> {
    try {
      this._supabaseReachable = await pingSupabase();
    } catch {
      this._supabaseReachable = false;
    }

    if (this._supabaseReachable) {
      this._mode = "supabase";
    } else {
      this._mode = "local";
    }

    this._ready = true;
    console.log(`[MemoryGateway] Mode: ${this._mode} (supabase reachable: ${this._supabaseReachable})`);
    return this._mode;
  }

  /**
   * Should we show the soft prompt to connect Supabase?
   * Only once per session, only when in local mode.
   */
  shouldShowConnectPrompt(): boolean {
    if (this._mode !== "local") return false;
    if (this._promptShownThisSession) return false;
    return true;
  }

  markPromptShown(): void {
    this._promptShownThisSession = true;
  }

  // ─── L3 Contract: retrieve_memories ────────────────────────────

  /**
   * Retrieve memories matching query and emotional state.
   *
   * Returns: list[dict] with keys: content, metadata, similarity, emotional_match
   * Max 5 results, max 400 tokens when formatted.
   *
   * Mode A (Supabase): delegates to /chat endpoint (server handles retrieval)
   * Mode B (Local): runs local keyword + emotional matching
   */
  async retrieveMemories(
    query: string,
    userId: string,
    emotionalState: Record<string, number>,
  ): Promise<MemoryResult[]> {
    if (!this._ready) return [];

    if (this._mode === "supabase") {
      // In Supabase mode, retrieval is handled server-side by the /chat endpoint.
      // Return empty here — the backend will do its own retrieval.
      // This is by design: the /chat endpoint always checks chroma_service
      // when no client_memories are provided.
      return [];
    }

    // Mode B: Local browser retrieval
    try {
      return retrieveLocalMemories(query, userId, emotionalState);
    } catch (e) {
      console.warn("[MemoryGateway] Local retrieval failed:", e);
      return [];
    }
  }

  // ─── L3 Contract: store_memory ─────────────────────────────────

  /**
   * Store a memory with emotional tags.
   *
   * Mode A (Supabase): fire-and-forget POST to backend (handled by /chat)
   * Mode B (Local): store in localStorage with keyword extraction
   *
   * @returns true on success
   */
  async storeMemory(
    content: string,
    userId: string,
    emotionalTags: Record<string, number>,
  ): Promise<boolean> {
    if (!this._ready) return false;

    if (this._mode === "supabase") {
      // In Supabase mode, storage is handled server-side by the /chat endpoint.
      // The backend stores memories after each interaction automatically.
      return true;
    }

    // Mode B: Local browser storage
    try {
      return storeLocalMemory(content, userId, emotionalTags);
    } catch (e) {
      console.warn("[MemoryGateway] Local store failed:", e);
      return false;
    }
  }

  /**
   * Format memory results into prompt-injectable text.
   * Enforces the 400-token cap (~1600 chars at 4 chars/token).
   */
  formatForPrompt(memories: MemoryResult[]): string {
    if (!memories || memories.length === 0) return "";

    const lines: string[] = [];
    let totalChars = 0;
    const MAX_CHARS = 1600; // ~400 tokens at 4 chars/token

    for (const mem of memories) {
      const content = mem.content.slice(0, 200);
      const line = `- "${content}" (emotional_match: ${mem.emotional_match})`;

      if (totalChars + line.length > MAX_CHARS) break;
      lines.push(line);
      totalChars += line.length;
    }

    if (lines.length === 0) return "";
    return "[MEMORY CONTEXT]\n" + lines.join("\n") + "\n[/MEMORY CONTEXT]";
  }

  /**
   * Build the client_memories payload for the /chat endpoint.
   * Called by voice providers when in local mode to pass
   * retrieved memories to the backend. Returns null in supabase mode.
   */
  async buildClientMemoriesPayload(
    query: string,
    userId: string,
    emotionalState: Record<string, number>,
  ): Promise<{ client_memories: MemoryResult[]; memory_mode: MemoryMode } | null> {
    if (this._mode === "supabase") return null;

    const memories = await this.retrieveMemories(query, userId, emotionalState);
    return {
      client_memories: memories,
      memory_mode: "local",
    };
  }
}

// ─── Singleton ───────────────────────────────────────────────────

export const memoryGateway = new MemoryGateway();
