/**
 * usePromptOrchestrator — Layer 1/2/3 prompt management with L2 hysteresis.
 *
 * Manages the 3-layer AURA prompting architecture:
 *   L1: Static identity (set once on connect via systemInstruction)
 *   L2: Behavioral framework (conditional, with hysteresis to prevent flapping)
 *   L3: Live context (prepended to every user message)
 *
 * Also manages:
 *   - Seed loading/saving (relational memory)
 *   - IndexedDB L2 cache warming
 *   - Greeting prompt generation
 *
 * @module
 */

import { useRef, useCallback } from "react";
import {
  EmotionalState,
  buildBehavioralLayer,
  buildLiveContext,
  shouldUpdateBehavioralLayer,
  markL2Sent,
  emotionalDistance,
  getGreetingPrompt,
} from "@/lib/gemini-prompt";
import { loadLayer2, saveLayer2 } from "@/lib/prompt-cache";
import type { BehaviorAnalysis } from "@/lib/behavior-client";

// Module-scoped L2 memory cache (survives re-renders, lost on page refresh)
let _layer2MemCache: string | null = null;

// ─── Types ──────────────────────────────────────────────────────────

export interface PromptOrchestratorAPI {
  /** Current seed data */
  seedRef: React.MutableRefObject<{ content: string; last_updated: number; memories: string[] }>;
  /** Current L2 prompt text */
  layer2Ref: React.MutableRefObject<string>;
  /** Last computed emotion (may not have been sent) */
  lastEmotionRef: React.MutableRefObject<EmotionalState | null>;
  /** Last emotion that was actually sent to Gemini */
  lastSentEmotionRef: React.MutableRefObject<EmotionalState | null>;
  /** Whether an L2 update is queued for the next turn */
  emotionChangedRef: React.MutableRefObject<boolean>;

  /**
   * Process analysis result and decide whether to update L2.
   * Returns true if L2 was queued for update.
   */
  processAnalysisForL2: (result: BehaviorAnalysis) => boolean;

  /**
   * Build L3 live context string for a user message.
   */
  buildContext: (mode: string) => string;

  /**
   * Mark that L2 was successfully sent to Gemini.
   * Updates lastSentEmotionRef and hysteresis timer.
   */
  confirmL2Sent: (emotion: EmotionalState | null) => void;

  /**
   * Warm the L2 cache from IndexedDB on session start.
   */
  warmL2Cache: () => Promise<void>;

  /**
   * Generate a greeting prompt for the first turn.
   */
  getGreeting: (mode: string) => string;

  /**
   * Get the module-scoped L2 memory cache value.
   */
  getLayer2MemCache: () => string | null;
}

// ─── The Hook ───────────────────────────────────────────────────────

export function usePromptOrchestrator(): PromptOrchestratorAPI {
  const seedRef = useRef<{ content: string; last_updated: number; memories: string[] }>({
    content: "",
    last_updated: 0,
    memories: [],
  });
  const layer2Ref = useRef<string>("");
  const lastEmotionRef = useRef<EmotionalState | null>(null);
  const lastSentEmotionRef = useRef<EmotionalState | null>(null);
  const emotionChangedRef = useRef<boolean>(false);

  /**
   * Process a BehaviorAnalysis result and decide whether to queue an L2 update.
   * Uses hysteresis: mode shift, Euclidean distance > 0.25, or 120s periodic refresh.
   */
  const processAnalysisForL2 = useCallback((result: BehaviorAnalysis): boolean => {
    const newEmotion: EmotionalState = {
      mode: (result.emotional_state as any) || "engaged",
      formality: "casual",
      humor: true,
      depth: "reflective",
      confidence: result.intensity || 0.8,
    };

    const shouldSend = shouldUpdateBehavioralLayer(newEmotion, lastSentEmotionRef.current);
    lastEmotionRef.current = newEmotion;

    if (shouldSend) {
      const layer2 = buildBehavioralLayer(newEmotion);
      layer2Ref.current = layer2;
      _layer2MemCache = layer2;
      saveLayer2(newEmotion, layer2); // Fire-and-forget IndexedDB
      emotionChangedRef.current = true;
      console.log("[AURA] 🎭 L2 update queued (significant shift)");
      return true;
    } else {
      const dist = emotionalDistance(newEmotion, lastSentEmotionRef.current!);
      console.log(`[AURA] L2 update suppressed (distance: ${dist})`);
      return false;
    }
  }, []);

  /**
   * Build L3 live context string — prepended to every user message.
   */
  const buildContext = useCallback((mode: string): string => {
    return buildLiveContext(
      new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      new Date().toLocaleDateString("en", { weekday: "short" }),
      mode,
      seedRef.current.content,
    );
  }, []);

  /**
   * Confirm that L2 was successfully sent. Updates tracking refs.
   */
  const confirmL2Sent = useCallback((emotion: EmotionalState | null) => {
    emotionChangedRef.current = false;
    lastSentEmotionRef.current = emotion;
    markL2Sent();
  }, []);

  /**
   * Warm the L2 cache from IndexedDB (called once on session start).
   */
  const warmL2Cache = useCallback(async () => {
    if (!_layer2MemCache) {
      const cached = await loadLayer2();
      if (cached) {
        _layer2MemCache = cached.layer;
        layer2Ref.current = cached.layer;
        lastEmotionRef.current = cached.state;
        console.log("[AURA] 🧠 Memory cache warmed from disk");
      }
    } else {
      layer2Ref.current = _layer2MemCache;
    }
  }, []);

  const getGreeting = useCallback((mode: string): string => {
    return getGreetingPrompt(seedRef.current.memories || [], mode);
  }, []);

  const getLayer2MemCache = useCallback((): string | null => _layer2MemCache, []);

  return {
    seedRef,
    layer2Ref,
    lastEmotionRef,
    lastSentEmotionRef,
    emotionChangedRef,
    processAnalysisForL2,
    buildContext,
    confirmL2Sent,
    warmL2Cache,
    getGreeting,
    getLayer2MemCache,
  };
}
