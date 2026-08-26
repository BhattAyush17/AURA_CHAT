import { useRef, useCallback, useState } from "react";
import {
  calibrateNoise,
  emaNoise,
  speechProbability,
  noiseLevelDb,
  vadConfidence,
  nextSpeechDetected,
  NOISE_CALIBRATION_FRAMES,
  PROB_DOMINANT_SPEECH,
} from "@/audioRuntime/vadMath";
import { publishVoicePerception, publishUtterancePerception } from "@/sense/VoiceSense/voicePerceptionStore";

export interface AcousticProfile {
  energy: "whisper" | "low" | "normal" | "elevated" | "high";
  pace: "slow" | "normal" | "fast";
  delivery: "hesitant" | "trailing" | "staccato" | "assertive" | "neutral";
  mood:
    | "sad or withdrawn"
    | "calm and reflective"
    | "neutral and composed"
    | "energized and confident"
    | "excited or agitated"
    | "frustrated or urgent";
}

/**
 * Phase 7.2 — canonical ListeningState. Produced by the Listening
 * Intelligence owner (this hook) from the cleanest tier available:
 *   silero        — Silero VAD in a worker (preferred)
 *   worklet-stats — statistical VAD inside vad-processor.js
 *   main-stats    — statistical VAD on the main-thread analyser loop
 *   rms           — legacy RMS thresholding (final fallback)
 */
export type DetectionSource = "silero" | "worklet-stats" | "main-stats" | "rms";

export interface ListeningState {
  /** Primary perception signal — NOT RMS. 0..1 per frame. */
  speechProbability: number;
  /** Ambient noise level in dBFS (diagnostics). */
  noiseLevel: number;
  /** Hysteresis-decided speech presence (on > 0.6, off < 0.3). */
  speechDetected: boolean;
  /** Continuous silence since the last speech frame, in ms (real silence). */
  realSilence: number;
  /** How sure the active tier is (0 at 0.5 prob, 1 at extremes). */
  vadConfidence: number;
  /** Which tier produced the current values. */
  detectionSource: DetectionSource;
  /** Target-speaker preparation flag (no identity yet — no embeddings). */
  dominantSpeechDetected: boolean;
  /** AEC/NS/AGC + filter chain + worklet were all enabled on this device. */
  processingEnabled: boolean;
}

export function useVoiceAcoustics() {
  const speechStartTimeRef = useRef<number>(0);
  const totalRmsRef = useRef<number>(0);
  const rmsSamplesRef = useRef<number>(0);
  const lastUiUpdateRef = useRef<number>(0);

  const [liveStats, setLiveStats] = useState({
    tone: "Normal",
    intent: "Listening",
    language: "Detecting...",
  });

  // ── Phase 7.2: Listening Intelligence state ────────────────────────

  const listeningStateRef = useRef<ListeningState>({
    speechProbability: 0,
    noiseLevel: -100,
    speechDetected: false,
    realSilence: 0,
    vadConfidence: 0,
    detectionSource: "rms",
    dominantSpeechDetected: false,
    processingEnabled: false,
  });

  // main-stats tier internals
  const noiseFloorRef = useRef(0.02);
  const calibFramesRef = useRef(0);
  const emaRmsRef = useRef(0);
  const lastSpeechAtRef = useRef<number>(0);
  const lastEventTsRef = useRef<number>(0);

  // silero tier internals
  const sileroWorkerRef = useRef<Worker | null>(null);
  const sileroReadyRef = useRef(false);
  const sileroLastProbRef = useRef<number | null>(null);

  const emitPerception = useCallback(() => {
    const now = performance.now();
    if (now - lastEventTsRef.current < 250) return; // throttled — no render cost
    lastEventTsRef.current = now;
    const s = listeningStateRef.current;
    try {
      window.dispatchEvent(new CustomEvent("aura:perception", { detail: { ...s, at: now } }));
    } catch {}
    // Phase B: mirror the already-emitted state into the framework-free store
    // that VoiceSense reads. Same cadence, same state — no second pipeline.
    try {
      publishVoicePerception(s);
    } catch {}
  }, []);

  const mergeListeningState = useCallback(
    (patch: Partial<ListeningState>) => {
      const s = listeningStateRef.current;
      const next = { ...s, ...patch };
      listeningStateRef.current = next;
      emitPerception();
    },
    [emitPerception],
  );

  /** Worklet feed (vad-processor.js PCM_DATA perception fields). */
  const applyWorkletPerception = useCallback(
    (p: { probability: number; noiseFloor: number; silenceMs: number; rms?: number }) => {
      const s = listeningStateRef.current;
      const prob = p.probability;
      const speechDetected = nextSpeechDetected(s.speechDetected, prob);
      mergeListeningState({
        speechProbability: prob,
        noiseLevel: noiseLevelDb(p.noiseFloor),
        speechDetected,
        realSilence: p.silenceMs,
        vadConfidence: vadConfidence(prob),
        detectionSource: sileroReadyRef.current ? "silero" : "worklet-stats",
        dominantSpeechDetected: prob >= PROB_DOMINANT_SPEECH,
      });

      if (p.rms !== undefined && p.rms > 0.002) {
        totalRmsRef.current += p.rms;
        rmsSamplesRef.current++;

        const now = Date.now();
        if (now - lastUiUpdateRef.current > 500) {
          const avgRms = totalRmsRef.current / rmsSamplesRef.current;
          let tone = "Normal";
          if (avgRms < 0.02) tone = "Whispering";
          else if (avgRms < 0.05) tone = "Low";
          else if (avgRms > 0.25) tone = "High / Loud";
          else if (avgRms > 0.15) tone = "Elevated";

          setLiveStats((prev: { tone: string; intent: string; language: string }) => ({
            ...prev,
            tone,
          }));
          lastUiUpdateRef.current = now;
        }
      }
    },
    [mergeListeningState],
  );

  /** Silero worker feed — overrides the statistical tiers while alive. */
  const applySileroProb = useCallback(
    (prob: number | null) => {
      if (prob === null) return; // dropped frame — statistical tier covers it
      sileroLastProbRef.current = prob;
      const s = listeningStateRef.current;
      const speechDetected = nextSpeechDetected(s.speechDetected, prob);
      mergeListeningState({
        speechProbability: prob,
        speechDetected,
        vadConfidence: vadConfidence(prob),
        detectionSource: "silero",
        dominantSpeechDetected: prob >= PROB_DOMINANT_SPEECH,
        realSilence: speechDetected ? 0 : s.realSilence + 30,
      });
    },
    [mergeListeningState],
  );

  /**
   * Silero VAD lifecycle. Created lazily, never blocks: a failed load or
   * runtime error silently degrades to the statistical tiers.
   */
  const ensureSileroVad = useCallback(() => {
    if (sileroWorkerRef.current) return;
    if (typeof Worker === "undefined") return;
    try {
      const worker = new Worker(new URL("../audioRuntime/sileroVad.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === "ready") {
          sileroReadyRef.current = true;
        } else if (msg.type === "failed") {
          console.warn(
            "[ListeningIntelligence] Silero VAD unavailable — using statistical VAD.",
            msg.error,
          );
          sileroReadyRef.current = false;
          mergeListeningState({ detectionSource: "worklet-stats" });
        } else if (msg.type === "prob") {
          applySileroProb(msg.prob);
        }
      };
      worker.onerror = () => {
        sileroReadyRef.current = false;
        mergeListeningState({ detectionSource: "worklet-stats" });
      };
      worker.postMessage({ type: "init" });
      sileroWorkerRef.current = worker;
    } catch {
      sileroReadyRef.current = false;
    }
  }, [applySileroProb, mergeListeningState]);

  /** Feed 512-sample frames @16k to Silero (posted from the worklet chunks). */
  const feedSileroFrame = useCallback((pcm: Float32Array) => {
    if (!sileroReadyRef.current || !sileroWorkerRef.current) return;
    try {
      sileroWorkerRef.current.postMessage({ type: "frame", pcm }, [pcm.buffer]);
    } catch {}
  }, []);

  const terminateSileroVad = useCallback(() => {
    sileroWorkerRef.current?.terminate();
    sileroWorkerRef.current = null;
    sileroReadyRef.current = false;
    sileroLastProbRef.current = null;
  }, []);

  const getListeningState = useCallback((): ListeningState => {
    return { ...listeningStateRef.current };
  }, []);

  const resetListeningState = useCallback(() => {
    listeningStateRef.current = {
      speechProbability: 0,
      noiseLevel: -100,
      speechDetected: false,
      realSilence: 0,
      vadConfidence: 0,
      detectionSource: "rms",
      dominantSpeechDetected: false,
      processingEnabled: listeningStateRef.current.processingEnabled,
    };
  }, []);

  const setProcessingEnabled = useCallback(
    (enabled: boolean) => {
      mergeListeningState({ processingEnabled: enabled });
    },
    [mergeListeningState],
  );

  // ── Existing acoustic tracking (unchanged contract) ────────────────

  const startTracking = useCallback(() => {
    speechStartTimeRef.current = Date.now();
    totalRmsRef.current = 0;
    rmsSamplesRef.current = 0;
    lastUiUpdateRef.current = Date.now();
    
    // The actual worklet updates will arrive via applyWorkletPerception,
    // which completely replaces the old requestAnimationFrame polling loop.
  }, []);

  const stopTrackingAndAnalyze = useCallback((text: string): void => {

    const durationSeconds = (Date.now() - speechStartTimeRef.current) / 1000;
    const wordCount = text.trim().split(/\s+/).length;
    const wpm = (wordCount / durationSeconds) * 60;

    const averageRms = rmsSamplesRef.current > 0 ? totalRmsRef.current / rmsSamplesRef.current : 0;

    // 1. Determine Energy (RMS ranges are approximate, depends on mic gain)
    let energy = "normal";
    if (averageRms < 0.02) energy = "whisper";
    else if (averageRms < 0.05) energy = "low";
    else if (averageRms > 0.25) energy = "high";
    else if (averageRms > 0.15) energy = "elevated";

    // 2. Determine Pace (Words Per Minute)
    let pace = "normal";
    if (wpm < 100) pace = "slow";
    else if (wpm > 160) pace = "fast";

    // 3. Determine Delivery (Textual Heuristics)
    let delivery = "neutral";
    const lowerText = text.toLowerCase();

    let isHesitant = false;
    let isTrailing = false;
    let isStaccato = false;
    let isAssertive = false;

    if (lowerText.match(/\b(um|uh|like|i guess|maybe|not sure)\b/)) {
      delivery = "hesitant";
      isHesitant = true;
    } else if (text.endsWith("...") || (!text.match(/[.!?]$/) && durationSeconds > 3)) {
      delivery = "trailing";
      isTrailing = true;
    } else if (wpm > 180 && durationSeconds < 2) {
      delivery = "staccato";
      isStaccato = true;
    } else if (text.match(/[!]$/)) {
      delivery = "assertive";
      isAssertive = true;
    }

    // 4. Derive Mood
    let mood = "neutral and composed";
    if (energy === "whisper" || energy === "low") {
      mood = pace === "slow" ? "sad or withdrawn" : "calm and reflective";
    } else if (energy === "high" || energy === "elevated") {
      mood = pace === "fast" ? "excited or agitated" : "energized and confident";
    }

    // Check for explicit frustration
    if (lowerText.match(/\b(fuck|damn|shit|annoying|stupid|wrong|no)\b/)) {
      mood = "frustrated or urgent";
    }

    // 5. Detect Language (Basic Heuristics)
    let language = "English";
    const hasDevanagari = /[\u0900-\u097F]/.test(text);
    const commonHindiRoman =
      /\b(hai|kya|kaise|ho|nahi|haan|bhai|yaar|acha|theek|mera|tum|aap|yeh|woh|karo|raha|rahi|baat)\b/i;

    if (hasDevanagari) {
      if (text.match(/[a-zA-Z]/)) {
        language = "Hinglish";
      } else {
        language = "Hindi";
      }
    } else if (commonHindiRoman.test(text)) {
      language = "Hinglish";
    }

    setLiveStats({
      tone: energy.charAt(0).toUpperCase() + energy.slice(1),
      intent: mood,
      language: language,
    });

    publishUtterancePerception({
      averageRms,
      wpm,
      delivery: {
        hesitation: isHesitant,
        trailing: isTrailing,
        staccato: isStaccato,
        assertive: isAssertive,
      },
      language,
    });

  }, []);

  return {
    startTracking,
    stopTrackingAndAnalyze,
    liveStats,
    // ── Phase 7.2: Listening Intelligence API ──
    getListeningState,
    resetListeningState,
    applyWorkletPerception,
    applySileroProb,
    ensureSileroVad,
    feedSileroFrame,
    terminateSileroVad,
    setProcessingEnabled,
  };
}
