/**
 * useBehaviorInjection — Behavior analysis, speculative pre-fetch, and injection.
 *
 * Manages /api/analyze calls (regular + speculative), the wasInterrupted flag
 * from barge-in, and the injection of behavioral context into the Gemini session.
 *
 * @module
 */

import { useRef, useCallback } from "react";
import {
  analyzeBehavior,
  speculativeAnalyze,
  shouldSpeculate,
  isSpeculativeResultUsable,
  logSpeculativeResult,
} from "@/lib/behavior-client";
import type { BehaviorAnalysis } from "@/lib/behavior-client";
import type { LiveSession } from "./types";

// ─── Types ──────────────────────────────────────────────────────────

export interface BehaviorInjectionAPI {
  /** Last analysis result for use by response timing, etc. */
  lastAnalysisRef: React.MutableRefObject<BehaviorAnalysis | null>;

  /**
   * Run behavior analysis for a user turn. Checks speculative cache first.
   * Returns the analysis result (or null).
   */
  analyzeForTurn: (
    text: string,
    sessionId: string,
    audioRms: number,
    pauseMs: number,
    mode: string,
    userId: string,
    wasInterrupted: boolean,
  ) => Promise<BehaviorAnalysis | null>;

  /**
   * Fire a speculative pre-fetch for partial transcript during speech.
   * Automatically debounced and cancellable.
   */
  fireSpeculative: (partialText: string, sessionId: string, userId: string) => void;

  /**
   * Inject behavioral instructions into the Gemini session.
   * Handles urgent vs. passive injection.
   */
  applyBehavioralInjection: (result: BehaviorAnalysis, session: LiveSession) => void;

  /** Clear all speculative state (on session end). */
  resetSpeculative: () => void;
}

// ─── The Hook ───────────────────────────────────────────────────────

export function useBehaviorInjection(): BehaviorInjectionAPI {
  const lastAnalysisRef = useRef<BehaviorAnalysis | null>(null);
  const speculativeResultRef = useRef<BehaviorAnalysis | null>(null);
  const speculativeInputRef = useRef<string>("");
  const speculativeAbortRef = useRef<AbortController | null>(null);

  /**
   * Primary analysis path. Checks if speculative result is usable,
   * otherwise fires a fresh /api/analyze call.
   */
  const analyzeForTurn = useCallback(
    async (
      text: string,
      sessionId: string,
      audioRms: number,
      pauseMs: number,
      mode: string,
      userId: string,
      wasInterrupted: boolean,
    ): Promise<BehaviorAnalysis | null> => {
      let result: BehaviorAnalysis | null;

      if (
        speculativeResultRef.current &&
        isSpeculativeResultUsable(speculativeInputRef.current, text)
      ) {
        // Speculative HIT
        result = speculativeResultRef.current;
        logSpeculativeResult(true);
      } else {
        // Speculative MISS
        if (speculativeResultRef.current) logSpeculativeResult(false);
        result = await analyzeBehavior(
          text,
          sessionId,
          audioRms,
          pauseMs,
          mode,
          undefined,
          userId,
          wasInterrupted,
        );
      }

      // Clear speculative state
      speculativeAbortRef.current?.abort();
      speculativeResultRef.current = null;
      speculativeInputRef.current = "";

      if (result) lastAnalysisRef.current = result;
      return result;
    },
    [],
  );

  /**
   * Fire speculative /api/analyze during user speech.
   * Debounced by shouldSpeculate() (500ms, 4-word minimum).
   */
  const fireSpeculative = useCallback((partialText: string, sessionId: string, userId: string) => {
    if (!shouldSpeculate(partialText)) return;

    speculativeAbortRef.current?.abort();
    const ctrl = new AbortController();
    speculativeAbortRef.current = ctrl;

    speculativeAnalyze(partialText, sessionId, ctrl.signal, userId)
      .then((result) => {
        if (result && !ctrl.signal.aborted) {
          speculativeResultRef.current = result;
          speculativeInputRef.current = partialText;
        }
      })
      .catch(() => {}); // Swallow — speculative failures are fine
  }, []);

  /**
   * Inject behavioral instructions into the Gemini session.
   * Urgent injections include a [BEHAVIORAL CONTEXT] tag; passive ones are plain.
   */
  const applyBehavioralInjection = useCallback((result: BehaviorAnalysis, session: LiveSession) => {
    if (!result.behavior_instructions || !session) return;
    try {
      const isUrgent = (result as any).sensing_state?.injection_type === "urgent";

      if (isUrgent) {
        console.log(
          `[AURA] Urgent injection — mode: ${(result as any).sensing_state?.mode}, turn: ${(result as any).sensing_state?.session_turn}`,
        );
        (session as any).sendClientContent({
          turns: [
            {
              role: "user",
              parts: [{ text: `[BEHAVIORAL CONTEXT]: ${result.behavior_instructions}` }],
            },
          ],
          turnComplete: false,
        });
        return;
      }

      (session as any).sendClientContent({
        turns: [{ role: "user", parts: [{ text: result.behavior_instructions }] }],
        turnComplete: false,
      });
    } catch (e) {
      console.warn("[AURA] Failed to apply behavioral injection:", e);
    }
  }, []);

  const resetSpeculative = useCallback(() => {
    speculativeAbortRef.current?.abort();
    speculativeResultRef.current = null;
    speculativeInputRef.current = "";
    lastAnalysisRef.current = null;
  }, []);

  return {
    lastAnalysisRef,
    analyzeForTurn,
    fireSpeculative,
    applyBehavioralInjection,
    resetSpeculative,
  };
}
