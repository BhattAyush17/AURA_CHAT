/**
 * AURA Phase 3 — Memory Provider
 *
 * React context that wraps the MemoryGateway singleton.
 * Handles:
 *   - Auto-detection of storage mode on mount (ping Supabase)
 *   - Exposes retrieve/store to child components
 *   - Shows a subtle status indicator for active mode
 *   - Shows a soft prompt once per session when in local mode
 *   - Updates connectionState with active_memory_mode
 *
 * Usage:
 *   <MemoryProvider>
 *     <App />
 *   </MemoryProvider>
 *
 *   const { mode, retrieveMemories, storeMemory } = useMemory();
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  memoryGateway,
  type MemoryMode,
  type MemoryResult,
} from "@/lib/memory-gateway";
import { connectionState } from "@/config/connectionState";

// ─── Context Shape ───────────────────────────────────────────────

interface MemoryContextValue {
  /** Current active storage mode */
  mode: MemoryMode;
  /** Whether the gateway has finished initializing */
  ready: boolean;
  /** Whether the Supabase backend is reachable */
  supabaseReachable: boolean;
  /** Retrieve memories matching query + emotional state (L3 contract) */
  retrieveMemories: (
    query: string,
    userId: string,
    emotionalState: Record<string, number>,
  ) => Promise<MemoryResult[]>;
  /** Store a memory with emotional tags (L3 contract) */
  storeMemory: (
    content: string,
    userId: string,
    emotionalTags: Record<string, number>,
  ) => Promise<boolean>;
  /** Format memories for prompt injection (max 400 tokens) */
  formatForPrompt: (memories: MemoryResult[]) => string;
  /** Dismiss the connect prompt */
  dismissConnectPrompt: () => void;
  /** Build client_memories payload for /chat (null in supabase mode) */
  buildClientMemoriesPayload: (
    query: string,
    userId: string,
    emotionalState: Record<string, number>,
  ) => Promise<{ client_memories: MemoryResult[]; memory_mode: MemoryMode } | null>;
}

const MemoryContext = createContext<MemoryContextValue | null>(null);

// ─── Provider Component ──────────────────────────────────────────

export const MemoryProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [mode, setMode] = useState<MemoryMode>("local");
  const [ready, setReady] = useState(false);
  const [supabaseReachable, setSupabaseReachable] = useState(false);
  const [showConnectPrompt, setShowConnectPrompt] = useState(false);
  const promptDismissed = useRef(false);

  // ── Initialize on mount ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const detectedMode = await memoryGateway.initialize();
      if (cancelled) return;

      setMode(detectedMode);
      setReady(true);
      setSupabaseReachable(memoryGateway.supabaseReachable);

      // Update global connection state
      connectionState.updateState({
        active_memory_mode: detectedMode,
        supabase_connected: memoryGateway.supabaseReachable,
      });

      // Show soft prompt once per session if local mode
      if (
        detectedMode === "local" &&
        memoryGateway.shouldShowConnectPrompt() &&
        !promptDismissed.current
      ) {
        // Delay prompt to not interrupt initial load
        setTimeout(() => {
          if (!cancelled && !promptDismissed.current) {
            setShowConnectPrompt(true);
            memoryGateway.markPromptShown();
          }
        }, 5000);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // ── L3 Contract Methods ──────────────────────────────────────

  const retrieveMemories = useCallback(
    async (
      query: string,
      userId: string,
      emotionalState: Record<string, number>,
    ): Promise<MemoryResult[]> => {
      return memoryGateway.retrieveMemories(query, userId, emotionalState);
    },
    [],
  );

  const storeMemory = useCallback(
    async (
      content: string,
      userId: string,
      emotionalTags: Record<string, number>,
    ): Promise<boolean> => {
      return memoryGateway.storeMemory(content, userId, emotionalTags);
    },
    [],
  );

  const formatForPrompt = useCallback((memories: MemoryResult[]): string => {
    return memoryGateway.formatForPrompt(memories);
  }, []);

  const dismissConnectPrompt = useCallback(() => {
    promptDismissed.current = true;
    setShowConnectPrompt(false);
  }, []);

  const buildClientMemoriesPayload = useCallback(
    async (
      query: string,
      userId: string,
      emotionalState: Record<string, number>,
    ) => {
      return memoryGateway.buildClientMemoriesPayload(query, userId, emotionalState);
    },
    [],
  );

  // ── Context Value ────────────────────────────────────────────

  const value: MemoryContextValue = {
    mode,
    ready,
    supabaseReachable,
    retrieveMemories,
    storeMemory,
    formatForPrompt,
    dismissConnectPrompt,
    buildClientMemoriesPayload,
  };

  return (
    <MemoryContext.Provider value={value}>
      {children}

      {/* ── Subtle Memory Mode Indicator ─────────────────────── */}
      {ready && (
        <div
          id="aura-memory-status"
          style={{
            position: "fixed",
            bottom: "12px",
            left: "12px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "4px 10px",
            borderRadius: "12px",
            fontSize: "11px",
            fontFamily: "Inter, system-ui, sans-serif",
            color: "var(--muted-foreground, #888)",
            background: "var(--muted, rgba(255,255,255,0.05))",
            border: "1px solid var(--border, rgba(255,255,255,0.08))",
            opacity: 0.7,
            transition: "opacity 0.3s ease",
            zIndex: 40,
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: mode === "supabase"
                ? "#4ade80"  // green for cloud
                : "#f59e0b", // amber for local
              boxShadow: mode === "supabase"
                ? "0 0 4px #4ade80"
                : "0 0 4px #f59e0b",
            }}
          />
          {mode === "supabase" ? "Cloud Memory" : "Local Memory"}
        </div>
      )}

      {/* ── Soft Connect Prompt (once per session, local mode) ── */}
      {showConnectPrompt && (
        <div
          id="aura-memory-connect-prompt"
          style={{
            position: "fixed",
            bottom: "40px",
            left: "12px",
            maxWidth: "320px",
            padding: "12px 16px",
            borderRadius: "12px",
            fontSize: "13px",
            fontFamily: "Inter, system-ui, sans-serif",
            color: "var(--foreground, #e5e5e5)",
            background: "var(--card, rgba(30,30,30,0.95))",
            border: "1px solid var(--border, rgba(255,255,255,0.1))",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            zIndex: 50,
            animation: "slideUp 0.4s ease-out",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
            <span style={{ fontSize: "18px", lineHeight: 1 }}>☁️</span>
            <div>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                Connect Supabase to make memories permanent
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--muted-foreground, #888)",
                  lineHeight: 1.4,
                }}
              >
                Your memories are stored locally right now. They'll be lost if you clear
                browser data. Add cloud sync in Settings for cross-device persistence.
              </div>
            </div>
            <button
              onClick={dismissConnectPrompt}
              style={{
                background: "none",
                border: "none",
                color: "var(--muted-foreground, #888)",
                cursor: "pointer",
                fontSize: "16px",
                padding: "0",
                lineHeight: 1,
                flexShrink: 0,
              }}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Keyframe for the slide-up animation */}
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </MemoryContext.Provider>
  );
};

// ─── Hook ────────────────────────────────────────────────────────

export function useMemory(): MemoryContextValue {
  const ctx = useContext(MemoryContext);
  if (!ctx) {
    throw new Error("useMemory must be used within a <MemoryProvider>");
  }
  return ctx;
}
