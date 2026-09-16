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
  enforceGlobalQuota,
} from "@/lib/local-memory";
import { MemoryWriteRequestSchema } from "@/lib/contracts/memory";
import { auraTelemetry } from "@/telemetry";

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

  get mode(): MemoryMode {
    return this._mode;
  }
  get ready(): boolean {
    return this._ready;
  }
  get supabaseReachable(): boolean {
    return this._supabaseReachable;
  }

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
    console.log(
      `[MemoryGateway] Mode: ${this._mode} (supabase reachable: ${this._supabaseReachable})`,
    );
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

    const service = this._mode === "supabase" ? "supabase" : "local";
    const opId = auraTelemetry.beginMemoryOp({
      type: "memory_retrieval",
      service,
      embeddingHint: false,
    });
    const startedAt = performance.now();

    if (this._mode === "supabase") {
      try {
        const url = new URL(`${ENDPOINTS.base}/api/memory/model/${userId}`);
        if (query) url.searchParams.append("query", query);

        const res = await fetch(url.toString());
        if (!res.ok) {
          // Do not fail silently: a 404 here (unregistered route) is
          // indistinguishable from "no memories" downstream, because
          // MemoryPolicy treats an empty array as "nothing retrieved".
          console.warn(
            `[MemoryGateway] Supabase memory retrieval failed: HTTP ${res.status} ${res.statusText} on ${url.pathname}`,
          );
          auraTelemetry.endMemoryOp(opId, {
            status: "error",
            latencyMs: performance.now() - startedAt,
          });
          return [];
        }
        const data = await res.json();

        // The backend now handles relevance ranking, semantic scoring, and the 1600-char budget limit.
        const results = data.results && Array.isArray(data.results) ? data.results : [];
        auraTelemetry.endMemoryOp(opId, {
          status: "success",
          resultCount: results.length,
          latencyMs: performance.now() - startedAt,
        });
        return results;
      } catch (e) {
        console.warn("[MemoryGateway] Supabase model fetch failed:", e);
        auraTelemetry.endMemoryOp(opId, {
          status: "error",
          latencyMs: performance.now() - startedAt,
        });
        return [];
      }
    }

    // Mode B: Local browser retrieval
    try {
      const memories = retrieveLocalMemories(query, userId, emotionalState);
      auraTelemetry.endMemoryOp(opId, {
        status: "success",
        resultCount: memories.length,
        latencyMs: performance.now() - startedAt,
      });
      return memories;
    } catch (e) {
      console.warn("[MemoryGateway] Local retrieval failed:", e);
      auraTelemetry.endMemoryOp(opId, {
        status: "error",
        latencyMs: performance.now() - startedAt,
      });
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
    tier?: "ephemeral" | "short_term" | "durable",
    sessionId?: string,
    executivePlan?: string,
  ): Promise<boolean> {
    if (!this._ready) return false;

    const opId = auraTelemetry.beginMemoryOp({
      type: "memory_write",
      service: this._mode === "supabase" ? "supabase" : "local",
    });
    const startedAt = performance.now();

    if (this._mode === "supabase") {
      // Phase 3 (episodic writes): POST to the backend /chat memory conduit.
      // The backend persists the turn as a durable deep memory row and returns
      // a clean 200 with the write result. Fire-and-forget from the caller's
      // perspective — failures are telemetry, never a thrown exception.
      // The payload is strictly validated first (contracts/memory.ts): a
      // malformed write is rejected client-side instead of shipped silently.
      const parsed = MemoryWriteRequestSchema.safeParse({
        text: content,
        user_id: userId,
        session_id: sessionId,
        memory_mode: "supabase",
        emotional_state: emotionalTags,
        executive_plan: executivePlan,
      });
      if (!parsed.ok) {
        auraTelemetry.endMemoryOp(opId, {
          status: "error",
          resultCount: 0,
          latencyMs: performance.now() - startedAt,
        });
        console.warn("[MemoryGateway] Memory write payload rejected:", parsed.errors);
        return false;
      }
      try {
        const res = await fetch(ENDPOINTS.chat, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.value),
        });
        const ok = res.ok;
        auraTelemetry.endMemoryOp(opId, {
          status: ok ? "success" : "error",
          resultCount: ok ? 1 : 0,
          latencyMs: performance.now() - startedAt,
        });
        if (!ok) {
          // No silent fallback: a non-200 write must be recorded explicitly.
          // resultCount 0 would otherwise look like "nothing to write".
          console.warn(
            `[MemoryGateway] Supabase memory write failed: HTTP ${res.status} ${res.statusText}`,
          );
        }
        return ok;
      } catch (e) {
        auraTelemetry.endMemoryOp(opId, {
          status: "error",
          latencyMs: performance.now() - startedAt,
        });
        console.warn("[MemoryGateway] Supabase memory write failed:", e);
        return false;
      }
    }

    // Mode B: Local browser storage
    const syncToBackend = (isSuccess: boolean) => {
      if (!isSuccess) return;
      const parsed = MemoryWriteRequestSchema.safeParse({
        text: content,
        user_id: userId,
        session_id: sessionId,
        memory_mode: "local",
        emotional_state: emotionalTags,
        executive_plan: executivePlan,
        client_memories: [],
      });

      if (parsed.ok) {
        fetch(ENDPOINTS.chat, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.value),
        }).catch((e) => {
          (window as any).__AURA_TELEMETRY__?.recordError(
            e instanceof Error ? e : new Error(String(e)),
            { context: "memory_gateway_local_backend_sync" },
          );
        });
      }
    };

    try {
      const ok = storeLocalMemory(content, userId, emotionalTags, tier);
      syncToBackend(ok);

      auraTelemetry.endMemoryOp(opId, {
        status: ok ? "success" : "error",
        resultCount: ok ? 1 : 0,
        latencyMs: performance.now() - startedAt,
      });
      return ok;
    } catch (e: any) {
      if (e instanceof DOMException && (e.code === 22 || e.name === "QuotaExceededError")) {
        console.warn("[MemoryGateway] Quota exceeded, enforcing eviction and retrying...");
        enforceGlobalQuota(userId);
        try {
          const ok = storeLocalMemory(content, userId, emotionalTags, tier);
          syncToBackend(ok);
          auraTelemetry.endMemoryOp(opId, {
            status: ok ? "success" : "error",
            resultCount: ok ? 1 : 0,
            latencyMs: performance.now() - startedAt,
          });
          return ok;
        } catch (retryError: any) {
          console.error("[MemoryGateway] Retry failed after eviction:", retryError);
          auraTelemetry.endMemoryOp(opId, {
            status: "error",
            latencyMs: performance.now() - startedAt,
          });
          (window as any).__AURA_TELEMETRY__?.recordError(
            retryError instanceof Error ? retryError : new Error(String(retryError)),
            { context: "storeMemory_retry_failed", tier, userId },
          );
          return false;
        }
      }
      console.warn("[MemoryGateway] Local store failed:", e);
      auraTelemetry.endMemoryOp(opId, {
        status: "error",
        latencyMs: performance.now() - startedAt,
      });
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
