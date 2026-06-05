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
import { routePsycheModule } from "@/lib/aura-psyche";
import { getAdaptiveModulation } from "@/lib/adaptive-modulation";
import type { UserPresentation } from "@/lib/adaptive-modulation";
import type { EmotionalState } from "@/lib/gemini-prompt";
import type { LiveSession } from "./types";
import { useExperienceMode } from "@/resilience";

// ─── Types ──────────────────────────────────────────────────────────

export interface BehaviorInjectionAPI {
  /** Last analysis result for use by response timing, etc. */
  lastAnalysisRef: React.MutableRefObject<BehaviorAnalysis | null>;
  /** Last user presentation analysis */
  lastPresentationRef: React.MutableRefObject<UserPresentation | null>;
  /** Last modulation directive string (for OpenRouter/Sarvam to read) */
  lastModulationRef: React.MutableRefObject<string>;

  /**
   * Run behavior analysis for a user turn. Checks speculative cache first.
   * Also runs adaptive modulation analysis.
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
   * Inject behavioral instructions + psyche context + adaptive modulation
   * into the Gemini session.
   * Handles urgent vs. passive injection, plus conditional psyche fragment routing.
   */
  applyBehavioralInjection: (
    result: BehaviorAnalysis,
    userText?: string,
    personality?: string,
  ) => string;

  /** Clear all speculative state (on session end). */
  resetSpeculative: () => void;
}

// ─── The Hook ───────────────────────────────────────────────────────

export function useBehaviorInjection(): BehaviorInjectionAPI {
  const lastAnalysisRef = useRef<BehaviorAnalysis | null>(null);
  const lastPresentationRef = useRef<UserPresentation | null>(null);
  const lastModulationRef = useRef<string>("");
  const speculativeResultRef = useRef<BehaviorAnalysis | null>(null);
  const speculativeInputRef = useRef<string>("");
  const speculativeAbortRef = useRef<AbortController | null>(null);
  const experienceMode = useExperienceMode();

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
   * Inject behavioral instructions + psyche context into the Gemini session.
   * Urgent injections include a [BEHAVIORAL CONTEXT] tag; passive ones are plain.
   * Psyche fragments fire conditionally via local intent routing (<1ms).
   */
  const applyBehavioralInjection = useCallback(
    (result: BehaviorAnalysis, userText?: string, personality?: string): string => {
      let injectedText = "";
      if (!result.behavior_instructions) return injectedText;
      try {
        const isUrgent = (result as any).sensing_state?.injection_type === "urgent";

        if (isUrgent) {
          console.log(
            `[AURA] Urgent injection — mode: ${(result as any).sensing_state?.mode}, turn: ${(result as any).sensing_state?.session_turn}`,
          );
          injectedText += `\n[BEHAVIORAL CONTEXT]: ${result.behavior_instructions}\n`;
        } else {
          injectedText += `\n${result.behavior_instructions}\n`;
        }

        // ── Adaptive Modulation Injection (local, <1ms) ───────────────
        if (userText) {
          const { presentation, directive } = getAdaptiveModulation(
            userText,
            personality || "adaptive",
            result,
            lastPresentationRef.current,
            experienceMode
          );
          lastPresentationRef.current = presentation;
          lastModulationRef.current = directive;

          if (directive) {
            console.log(
              `[AURA] 🎯 Adaptive modulation: energy=${presentation.energy}, openness=${presentation.openness}, depth=${presentation.depth}, arc=${presentation.arc}`,
            );
            injectedText += `\n${directive}\n`;
          }
        }

        // ── Psyche Injection (conditional, <1ms) ──────────────────────
        if (userText) {
          const sensing = result.sensing_state;
          // Map backend emotional_state string → EmotionalState for psyche router
          const emotionalState: EmotionalState | null = sensing
            ? {
                mode: (sensing.mode as EmotionalState["mode"]) || "engaged",
                formality: "balanced",
                humor: false,
                depth:
                  sensing.engagement > 0.7
                    ? "deep"
                    : sensing.engagement > 0.4
                      ? "reflective"
                      : "surface",
                confidence: sensing.trust ?? 0.5,
              }
            : null;

          // Trust delta from previous analysis
          const prevTrust = lastAnalysisRef.current?.sensing_state?.trust;
          const currTrust = sensing?.trust;
          const trustDelta =
            prevTrust !== undefined && currTrust !== undefined ? currTrust - prevTrust : undefined;

          const psyche = routePsycheModule(userText, emotionalState, trustDelta);
          if (psyche) {
            console.log(`[AURA] 🧠 Psyche injection: ${psyche.key}`);
            injectedText += `\n${psyche.content}\n`;
          }
        }
      } catch (e) {
        console.warn("[AURA] Failed to apply behavioral injection:", e);
      }
      return injectedText;
    },
    [],
  );

  const resetSpeculative = useCallback(() => {
    speculativeAbortRef.current?.abort();
    speculativeResultRef.current = null;
    speculativeInputRef.current = "";
    lastAnalysisRef.current = null;
    lastPresentationRef.current = null;
    lastModulationRef.current = "";
  }, []);

  return {
    lastAnalysisRef,
    lastPresentationRef,
    lastModulationRef,
    analyzeForTurn,
    fireSpeculative,
    applyBehavioralInjection,
    resetSpeculative,
  };
}
