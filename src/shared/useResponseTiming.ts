/**
 * useResponseTiming — Adaptive micro-delays before AURA's audio response.
 *
 * Humans pause before emotional replies. Instant responses feel robotic.
 * This hook computes a context-aware delay (30-500ms) based on emotional
 * state, conversation pace, and interruption history.
 *
 * The delay offsets the AudioContext scheduling of the FIRST audio chunk
 * only — subsequent chunks play gaplessly as before.
 *
 * @module
 */

import { useRef, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────

export interface TimingConfig {
  emotionalState: {
    mode: string; // from BehaviorAnalysis.sensing_state.mode
    tension: number; // 0-1
    energy: number; // 0-1
  };
  wasInterrupted: boolean;
  turnIndex: number;
}

// ─── Constants ──────────────────────────────────────────────────────

const MIN_DELAY_MS = 30;
const MAX_DELAY_MS = 500;
/** If user fires >3 turns within this window, halve all delays */
const RAPID_FIRE_WINDOW_MS = 30_000;
const RAPID_FIRE_THRESHOLD = 3;

// ─── The Hook ───────────────────────────────────────────────────────

export function useResponseTiming() {
  /** Timestamps of recent turn-completes for rapid-fire detection */
  const turnTimestampsRef = useRef<number[]>([]);

  /** Record a turn-complete event for pace tracking. */
  const recordTurn = useCallback(() => {
    const now = performance.now();
    const ts = turnTimestampsRef.current;
    ts.push(now);
    // Keep only timestamps within the rapid-fire window
    while (ts.length > 0 && now - ts[0] > RAPID_FIRE_WINDOW_MS) ts.shift();
  }, []);

  /**
   * Compute the delay (ms) before playing the first audio byte.
   *
   * Rules (evaluated top-to-bottom, first match wins):
   *  1. After barge-in: near-instant (user expects acknowledgement)
   *  2. First turn: slight pause (AURA "notices" the user)
   *  3. High tension: thoughtful pause (absorbing what was said)
   *  4. Calm + low energy: measured pace (reflective)
   *  5. High energy: quick response (matching user's pace)
   *  6. Default: natural human micro-pause
   *
   * Rapid-fire conversations (>3 turns in 30s) halve the delay.
   */
  const getResponseDelay = useCallback((config: TimingConfig): number => {
    const { emotionalState, wasInterrupted, turnIndex } = config;

    let delay: number;

    if (wasInterrupted) {
      delay = MIN_DELAY_MS + jitter(20);
    } else if (turnIndex === 0) {
      delay = 200 + jitter(100);
    } else if (emotionalState.tension > 0.6) {
      delay = 250 + jitter(100); // 250-350ms
    } else if (emotionalState.mode === "calm" && emotionalState.energy < 0.4) {
      delay = 180 + jitter(70);  // 180-250ms
    } else if (emotionalState.energy > 0.7) {
      delay = 40 + jitter(30);
    } else {
      delay = 120 + jitter(60);  // 120-180ms
    }

    // Rapid-fire reduction: if user is in a fast exchange, halve delay
    const recentTurns = turnTimestampsRef.current.length;
    if (recentTurns >= RAPID_FIRE_THRESHOLD) {
      delay = Math.round(delay * 0.5);
    }

    return Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, delay));
  }, []);

  return { getResponseDelay, recordTurn };
}

// ─── Utility ────────────────────────────────────────────────────────

/** Add random jitter up to maxMs to prevent mechanical-sounding timing */
function jitter(maxMs: number): number {
  return Math.floor(Math.random() * maxMs);
}
