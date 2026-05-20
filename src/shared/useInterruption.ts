/**
 * useInterruptionHandler — Barge-in detection for AURA voice companion.
 *
 * Monitors mic energy while AURA is speaking. When the user talks over
 * AURA for longer than a confirmation window, it triggers a graceful
 * interrupt: fade out AURA's audio, flush queued chunks, and let the
 * user take over.
 *
 * @module
 */

import { useRef, useCallback, useEffect } from "react";

// ─── Configuration ──────────────────────────────────────────────────

export interface InterruptionConfig {
  /** RMS threshold to detect speech over playback (default: 0.015) */
  micEnergyThreshold: number;
  /** ms mic must be active to confirm barge-in, prevents cough triggers (default: 150) */
  confirmationWindowMs: number;
  /** Fade-out duration for AURA audio in ms (default: 100) */
  duckDurationMs: number;
}

export interface InterruptionState {
  /** True while a barge-in is actively happening */
  isBargeIn: boolean;
  /** How many times user interrupted this session */
  interruptionCount: number;
  /** What AURA was saying when interrupted (partial response text) */
  lastInterruptedText: string;
  /** Flag for next /api/analyze call — consumed once by behavior injection */
  wasInterrupted: boolean;
}

const DEFAULT_CONFIG: InterruptionConfig = {
  micEnergyThreshold: 0.015,
  confirmationWindowMs: 150,
  duckDurationMs: 100,
};

// ─── Types for caller integration ───────────────────────────────────

export interface InterruptionDeps {
  /** The shared AudioContext from useGeminiLive */
  audioContextRef: React.MutableRefObject<AudioContext | null>;
  /** The mic MediaStream */
  micStreamRef: React.MutableRefObject<MediaStream | null>;
  /** Whether AURA is currently playing audio */
  isSpeaking: boolean;
  /** The current partial response text from Gemini (as a ref) */
  currentResponseTextRef: React.MutableRefObject<string>;
  /** Callback: fade out and stop all active AudioBufferSourceNodes */
  onDuck: (fadeMs: number) => void;
  /** Callback: flush queued audio chunks waiting to play */
  onFlush: () => void;
}

export interface InterruptionAPI {
  /** Current interruption state (read via .current for non-reactive access) */
  stateRef: React.RefObject<InterruptionState>;
  /**
   * Consume the wasInterrupted flag. Returns true if user interrupted
   * since last consumption, then resets the flag to false.
   */
  consumeInterrupted: () => boolean;
  /** Reset all state (call on session end) */
  reset: () => void;
}

// ─── The Hook ───────────────────────────────────────────────────────

/**
 * Detects when the user speaks over AURA's audio playback and
 * triggers a graceful interruption (duck → flush → hand off).
 *
 * @param deps - Audio context, streams, and callbacks from useGeminiLive
 * @param config - Optional tuning parameters
 * @returns InterruptionAPI for state access and flag consumption
 */
export function useInterruptionHandler(
  deps: InterruptionDeps,
  config: Partial<InterruptionConfig> = {},
): InterruptionAPI {
  const cfg: InterruptionConfig = { ...DEFAULT_CONFIG, ...config };

  // ── State ──────────────────────────────────────────────────────

  const stateRef = useRef<InterruptionState>({
    isBargeIn: false,
    interruptionCount: 0,
    lastInterruptedText: "",
    wasInterrupted: false,
  });

  // ── Internal refs ──────────────────────────────────────────────

  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const monitorTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aboveThresholdSinceRef = useRef<number | null>(null);
  const isSpeakingRef = useRef(deps.isSpeaking);

  // Keep refs in sync without re-running the monitor effect
  useEffect(() => {
    isSpeakingRef.current = deps.isSpeaking;
  }, [deps.isSpeaking]);

  // ── AnalyserNode setup ─────────────────────────────────────────
  // Create a dedicated AnalyserNode for barge-in detection lazily.

  const setupAnalyser = useCallback(() => {
    if (!deps.audioContextRef.current || !deps.micStreamRef.current) {
      return false;
    }
    if (analyserRef.current) return true;

    try {
      const analyser = deps.audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;

      const source = deps.audioContextRef.current.createMediaStreamSource(
        deps.micStreamRef.current,
      );
      source.connect(analyser);

      analyserRef.current = analyser;
      sourceRef.current = source;
      return true;
    } catch (e) {
      console.warn("[BARGE-IN] Failed to create AnalyserNode:", e);
      return false;
    }
  }, [deps.audioContextRef, deps.micStreamRef]);

  // Clean up analyser on unmount
  useEffect(() => {
    return () => {
      try {
        sourceRef.current?.disconnect();
      } catch {}
      analyserRef.current = null;
      sourceRef.current = null;
    };
  }, []);

  // ── Core: confirm barge-in ─────────────────────────────────────

  const confirmBargeIn = useCallback(() => {
    const s = stateRef.current;
    if (s.isBargeIn) return; // Already in barge-in

    s.isBargeIn = true;
    s.interruptionCount += 1;
    s.lastInterruptedText = deps.currentResponseTextRef.current;
    s.wasInterrupted = true;

    // 1. Fade out AURA's audio
    deps.onDuck(cfg.duckDurationMs);

    // 2. Flush queued chunks
    deps.onFlush();

    console.log(
      `[BARGE-IN] Confirmed #${s.interruptionCount} | ` +
        `AURA was saying: "${s.lastInterruptedText.slice(0, 60)}..."`,
    );
  }, [deps.onDuck, deps.onFlush, cfg.duckDurationMs]);

  // ── Monitor loop: poll mic RMS every 50ms while AURA speaks ────

  useEffect(() => {
    // Start monitoring only when AURA is speaking
    if (!deps.isSpeaking || !setupAnalyser()) {
      // Not speaking or setup failed → reset barge-in tracking
      if (stateRef.current.isBargeIn) {
        stateRef.current.isBargeIn = false;
      }
      aboveThresholdSinceRef.current = null;

      if (monitorTimerRef.current) {
        clearInterval(monitorTimerRef.current);
        monitorTimerRef.current = null;
      }
      return;
    }

    const analyser = analyserRef.current;
    if (!analyser) return;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    monitorTimerRef.current = setInterval(() => {
      if (!isSpeakingRef.current) return;

      // Compute RMS from time-domain data
      analyser.getByteTimeDomainData(dataArray);
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const norm = dataArray[i] / 128.0 - 1.0;
        sumSquares += norm * norm;
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);

      if (rms > cfg.micEnergyThreshold) {
        // Mic energy above threshold
        if (aboveThresholdSinceRef.current === null) {
          aboveThresholdSinceRef.current = performance.now();
        } else {
          const elapsed = performance.now() - aboveThresholdSinceRef.current;
          if (elapsed >= cfg.confirmationWindowMs) {
            confirmBargeIn();
          }
        }
      } else {
        // Below threshold — reset confirmation window
        aboveThresholdSinceRef.current = null;
      }
    }, 50); // 50ms = 20Hz polling, fast enough for speech onset

    return () => {
      if (monitorTimerRef.current) {
        clearInterval(monitorTimerRef.current);
        monitorTimerRef.current = null;
      }
    };
  }, [deps.isSpeaking, confirmBargeIn, cfg.micEnergyThreshold, cfg.confirmationWindowMs]);

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Consume the `wasInterrupted` flag. Returns true once after an
   * interruption, then resets. Use this in the /api/analyze request
   * to inform the backend that AURA was cut off.
   */
  const consumeInterrupted = useCallback((): boolean => {
    const was = stateRef.current.wasInterrupted;
    if (was) {
      stateRef.current.wasInterrupted = false;
    }
    return was;
  }, []);

  /** Reset all interruption state. Call on session end. */
  const reset = useCallback(() => {
    stateRef.current = {
      isBargeIn: false,
      interruptionCount: 0,
      lastInterruptedText: "",
      wasInterrupted: false,
    };
    aboveThresholdSinceRef.current = null;
  }, []);

  return { stateRef, consumeInterrupted, reset };
}
