/**
 * useAdaptiveTurnDetection — Frontend client for the Adaptive End-of-Turn
 * Intelligence Pausing Module.
 *
 * This hook runs the turn confidence engine entirely on the client side
 * (no network round-trip needed for the core silence→confidence loop).
 * Profile persistence is handled via save/load to the backend or localStorage.
 *
 * Provider-agnostic: works with OpenRouter, Sarvam, Gemini — any STT.
 *
 * @module
 */

import { useRef, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────

export interface SpeechProfile {
  micro_pause_ms: number;
  thinking_pause_ms: number;
  deep_pause_ms: number;
  comfort_pause_ms: number;
  speaking_rate: number;
  thinking_pause_score: number;
  storytelling_score: number;
  response_patience: number;
  burst_speaker_score: number;
  interruption_count: number;
  interruption_rate: number;
  interruptibility_score: number;
  total_sessions: number;
  total_turns: number;
}

export type ConversationMode =
  | "command"
  | "question"
  | "discussion"
  | "storytelling"
  | "emotional"
  | "reflective";

export interface TurnConfidenceResult {
  confidence: number;
  shouldRespond: boolean;
  silenceMs: number;
  effectiveThreshold: number;
  conversationMode: ConversationMode;
  responseDelay: number;
  semanticCompletion: number;
  thinkingConfidence: number;
  emotionBonus: number;
}

export interface TurnDetectionTelemetry {
  silence_ms: number;
  turn_confidence: number;
  conversation_mode: ConversationMode;
  response_delay: number;
  false_detection: boolean;
  profile: SpeechProfile;
  session_interruptions: number;
  semantic_completion: number;
  thinking_confidence: number;
  emotion_bonus: number;
}

// ─── Constants ──────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 0.95;
const ABSOLUTE_MAX_WAIT_MS = 2500;
const STORAGE_KEY = "aura_speech_profile";

// EMA smoothing factors
const EMA_PAUSE = 0.08;
const EMA_RATE = 0.10;
const EMA_PATIENCE = 0.07;
const EMA_INTERRUPT = 0.10;

// Patience multipliers per conversation mode
const PATIENCE_MAP: Record<ConversationMode, number> = {
  command: 0.5,
  question: 0.65,
  discussion: 1.0,
  storytelling: 1.5,
  emotional: 1.8,
  reflective: 1.8,
};

// Base response delays per mode (ms)
const DELAY_MAP: Record<ConversationMode, number> = {
  command: 100,
  question: 150,
  discussion: 250,
  storytelling: 350,
  emotional: 500,
  reflective: 500,
};

const PERSONALITY_BIAS: Record<string, number> = {
  supportive: 100,
  playful: -50,
  reflective: 150,
  assistant: 0,
  joyful_passion: -50,
  chaotic: -100,
};

// ─── Context classification patterns ────────────────────────────────

const CMD_RE = /^(stop|play|pause|skip|next|open|close|set|turn|switch|show|hide|mute|unmute|volume|timer|remind|alarm|call|send|cancel|delete|undo|search|find|go to)\b/i;
const QST_RE = /^(what|who|where|when|why|how|is|are|do|does|did|can|could|would|should|will|shall|have|has|had)\b/i;
const EMO_RE = /\b(feel|feeling|felt|hurts?|miss|scared|afraid|anxious|worried|sad|happy|angry|frustrated|lonely|love|hate|depressed|overwhelmed|stressed|lost|confused|broken|grateful|sorry|forgive|cry|crying|tears|painful)\b/gi;
const REF_RE = /\b(wonder|thinking about|reflect|contemplate|realize|meaning|purpose|life|death|existence|regret|remember when|used to|back then|years ago|growing up|believe|soul)\b/i;
const STORY_RE = /\b(so basically|let me tell you|you know what happened|this one time|i was at|and then|so we|after that|long story|funny thing|get this|picture this)\b/i;

// ─── Utilities ──────────────────────────────────────────────────────

function sigmoid(x: number, midpoint = 1.0, steepness = 4.0): number {
  return 1.0 / (1.0 + Math.exp(-steepness * (x - midpoint)));
}

function ema(current: number, newVal: number, alpha: number): number {
  return current * (1.0 - alpha) + newVal * alpha;
}

function jitter(base: number, fraction = 0.1): number {
  const range = base * fraction;
  return base + (Math.random() * 2 - 1) * range;
}

function classifyMode(text: string, wordCount: number, emotionalIntensity: number, storytellingScore: number): ConversationMode {
  const t = text.trim();

  const emoMatches = t.match(EMO_RE);
  const emoHits = emoMatches ? emoMatches.length : 0;
  if (emoHits >= 2 || (emoHits >= 1 && emotionalIntensity > 0.6)) return "emotional";

  if (REF_RE.test(t)) return "reflective";
  if (CMD_RE.test(t) && wordCount <= 8) return "command";
  if (STORY_RE.test(t)) return "storytelling";
  if (wordCount > 25 && storytellingScore > 0.5) return "storytelling";
  if (QST_RE.test(t) || t.endsWith("?")) return "question";
  return "discussion";
}

function getSemanticCompletionScore(text: string): number {
  const t = text.trim();
  if (!t) return 0.5;
  if (/(and|or|but|because|so|if|then|with|about|for|to|from|the|a|an)$/i.test(t)) return 0.1;
  if (/[.!?]$/.test(t)) return 0.9;
  return 0.5;
}

function getThinkingConfidence(text: string): number {
  const t = text.toLowerCase();
  let score = 0;
  const fillers = t.match(/\b(um|umm|uh|uhh|hm|hmm|like|actually wait|let me think)\b/g);
  if (fillers) score += fillers.length * 0.2;
  if (/\b(i mean|no wait|scratch that)\b/.test(t)) score += 0.3;
  return Math.min(1.0, score);
}

function getEmotionPauseBonus(text: string): number {
  const t = text.toLowerCase();
  const emoMatches = t.match(/\b(sad|afraid|hurt|miss|lonely|overwhelmed|crying|painful|broken|devastated|scared)\b/g);
  if (!emoMatches) return 0;
  return Math.min(500, emoMatches.length * 100);
}

function defaultProfile(): SpeechProfile {
  return {
    micro_pause_ms: 300,
    thinking_pause_ms: 800,
    deep_pause_ms: 1500,
    comfort_pause_ms: 900,
    speaking_rate: 140,
    thinking_pause_score: 0.5,
    storytelling_score: 0.3,
    response_patience: 0.5,
    burst_speaker_score: 0.3,
    interruption_count: 0,
    interruption_rate: 0.0,
    interruptibility_score: 0.5,
    total_sessions: 0,
    total_turns: 0,
  };
}

// ─── The Hook ───────────────────────────────────────────────────────

export function useAdaptiveTurnDetection(threshold = DEFAULT_THRESHOLD) {
  const profileRef = useRef<SpeechProfile>(loadProfileFromStorage());
  const silenceStartRef = useRef<number | null>(null);
  const lastModeRef = useRef<ConversationMode>("discussion");
  const auraStartedSpeakingRef = useRef<number | null>(null);
  const sessionInterruptionsRef = useRef(0);
  const sessionStartRef = useRef<number>(performance.now());
  
  // Last telemetry for debug
  const lastMetricsRef = useRef({ sem: 0.5, think: 0, emo: 0 });

  // ── Profile persistence ─────────────────────────────────────────

  const saveProfile = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profileRef.current));
    } catch {}
  }, []);

  const resetProfile = useCallback(() => {
    profileRef.current = defaultProfile();
    saveProfile();
  }, [saveProfile]);

  // ── Core: calculate turn confidence ─────────────────────────────

  const calculateTurnConfidence = useCallback(
    (
      silenceMs: number,
      text: string,
      emotionalIntensity = 0,
      contextSignals?: { tension?: number; trust?: number; personality?: string },
    ): TurnConfidenceResult => {
      const profile = profileRef.current;
      const wordCount = text.trim().split(/\s+/).length;

      // 1. Classify conversation mode
      const mode = classifyMode(text, wordCount, emotionalIntensity, profile.storytelling_score);
      lastModeRef.current = mode;

      // 2. Compute local lightweight heuristics
      const semCompletion = getSemanticCompletionScore(text);
      const thinkingConf = getThinkingConfidence(text);
      const emoBonus = getEmotionPauseBonus(text);
      
      lastMetricsRef.current = { sem: semCompletion, think: thinkingConf, emo: emoBonus };

      // 3. Effective wait target (personalized)
      let effectiveWait = profile.comfort_pause_ms * PATIENCE_MAP[mode];

      if (emotionalIntensity > 0.5) {
        effectiveWait *= 1.0 + (emotionalIntensity - 0.5) * 0.6;
      }
      if (profile.interruption_rate > 0.1) {
        effectiveWait *= 1.0 + profile.interruption_rate * 0.5;
      }
      
      // Add emotional recovery silence
      effectiveWait += emoBonus;
      effectiveWait = Math.min(effectiveWait, ABSOLUTE_MAX_WAIT_MS);

      // 4. Silence ratio → sigmoid confidence
      const ratio = effectiveWait > 0 ? silenceMs / effectiveWait : 1.0;
      const silenceConf = sigmoid(ratio, 1.0, 4.0);

      // Utterance completeness heuristic (basic length)
      let completenessConf = 0.5;
      if (wordCount <= 2) completenessConf = 0.7;
      else if (wordCount <= 5) completenessConf = 0.5;
      else if (wordCount <= 15) completenessConf = 0.4;
      else completenessConf = 0.6;

      // Rate adjustment
      let rateAdj = 0;
      if (profile.speaking_rate > 160) rateAdj = 0.05;
      else if (profile.speaking_rate < 100) rateAdj = -0.05;

      // Blend all signals
      let confidence = 
        silenceConf * 0.60 + 
        semCompletion * 0.20 + 
        completenessConf * 0.10 + 
        (profile.interruptibility_score - 0.5) * 0.10 + 
        rateAdj;
        
      // Penalty if user is clearly thinking
      confidence -= thinkingConf * 0.3;

      // Safety override
      if (silenceMs >= ABSOLUTE_MAX_WAIT_MS) confidence = 1.0;
      confidence = Math.max(0, Math.min(1, confidence));

      // Threshold adjustment per mode
      let effThreshold = threshold;
      if (mode === "command") effThreshold = Math.max(0.80, threshold - 0.10);
      else if (mode === "emotional" || mode === "reflective")
        effThreshold = Math.min(0.98, threshold + 0.02);

      const shouldRespond = confidence >= effThreshold;

      // Response delay (Personality Timing Bias + Jitter)
      const baseDelay = DELAY_MAP[mode];
      const patienceScale = 1.0 + (profile.response_patience - 0.5) * 0.4;
      let delay = baseDelay * patienceScale;
      
      if (emotionalIntensity > 0.5) delay += (emotionalIntensity - 0.5) * 300;
      
      const personality = contextSignals?.personality || "assistant";
      const bias = PERSONALITY_BIAS[personality] || 0;
      delay += bias;

      // Small jitter instead of huge random range
      delay = Math.max(10, Math.min(800, jitter(delay, 0.1)));

      return {
        confidence: Math.round(confidence * 10000) / 10000,
        shouldRespond,
        silenceMs,
        effectiveThreshold: Math.round(effThreshold * 10000) / 10000,
        conversationMode: mode,
        responseDelay: Math.round(delay),
        semanticCompletion: semCompletion,
        thinkingConfidence: thinkingConf,
        emotionBonus: emoBonus
      };
    },
    [threshold],
  );

  // ── Profile learning ────────────────────────────────────────────

  const updateProfile = useCallback(
    (observed: {
      pauseMs?: number;
      wpm?: number;
      wordCount?: number;
    }) => {
      const p = profileRef.current;
      
      // Session Recalibration: faster learning in first 2 mins
      const isEarlySession = (performance.now() - sessionStartRef.current) < 120_000;
      const emaMult = isEarlySession ? 2.0 : 1.0;

      if (observed.pauseMs && observed.pauseMs > 50) {
        // Pause zones
        if (observed.pauseMs < 500) {
          p.micro_pause_ms = ema(p.micro_pause_ms, observed.pauseMs, EMA_PAUSE * emaMult);
        } else if (observed.pauseMs < 1200) {
          p.thinking_pause_ms = ema(p.thinking_pause_ms, observed.pauseMs, EMA_PAUSE * emaMult);
        } else {
          p.deep_pause_ms = ema(p.deep_pause_ms, observed.pauseMs, EMA_PAUSE * emaMult);
        }
        
        p.response_patience = ema(p.response_patience, Math.min(1, observed.pauseMs / 2000), EMA_PATIENCE * emaMult);
      }
      if (observed.wpm && observed.wpm > 0) {
        p.speaking_rate = ema(p.speaking_rate, observed.wpm, EMA_RATE * emaMult);
      }
      p.total_turns += 1;
    },
    [],
  );

  // ── Interruption learning (strongest signal) ────────────────────

  const markAuraSpeaking = useCallback(() => {
    auraStartedSpeakingRef.current = performance.now();
  }, []);

  const registerFalseDetection = useCallback(() => {
    const p = profileRef.current;
    
    const isEarlySession = (performance.now() - sessionStartRef.current) < 120_000;
    const emaMult = isEarlySession ? 2.0 : 1.0;

    p.interruption_count += 1;
    sessionInterruptionsRef.current += 1;
    
    const adj = Math.min(150, 80 + p.interruption_count * 5);
    p.comfort_pause_ms = Math.min(2200, p.comfort_pause_ms + adj);
    p.response_patience = Math.min(1.0, p.response_patience + 0.08);
    p.interruption_rate = ema(p.interruption_rate, 1.0, 0.15 * emaMult);
    
    // Decrease interruptibility score
    p.interruptibility_score = ema(p.interruptibility_score, 0.0, EMA_INTERRUPT * emaMult);
    
    console.log(
      `%c⏸️ FALSE DETECTION #${p.interruption_count}: comfort_pause → ${p.comfort_pause_ms.toFixed(0)}ms`,
      "color: #f59e0b; font-weight: bold;",
    );
    saveProfile();
  }, [saveProfile]);

  const checkUserResumed = useCallback((): boolean => {
    if (auraStartedSpeakingRef.current === null) return false;
    const gap = performance.now() - auraStartedSpeakingRef.current;
    auraStartedSpeakingRef.current = null;
    if (gap <= 800) {
      registerFalseDetection();
      return true;
    }
    return false;
  }, [registerFalseDetection]);

  // ── Session lifecycle ───────────────────────────────────────────

  const startSession = useCallback(() => {
    const p = profileRef.current;
    p.total_sessions += 1;
    p.interruption_rate *= 0.7;
    sessionInterruptionsRef.current = 0;
    silenceStartRef.current = null;
    sessionStartRef.current = performance.now();
    saveProfile();
  }, [saveProfile]);

  const endSession = useCallback(() => {
    saveProfile();
  }, [saveProfile]);

  // ── Telemetry ───────────────────────────────────────────────────

  const getTelemetry = useCallback((): TurnDetectionTelemetry => {
    return {
      silence_ms: 0,
      turn_confidence: 0,
      conversation_mode: lastModeRef.current,
      response_delay: DELAY_MAP[lastModeRef.current],
      false_detection: sessionInterruptionsRef.current > 0,
      profile: { ...profileRef.current },
      session_interruptions: sessionInterruptionsRef.current,
      semantic_completion: lastMetricsRef.current.sem,
      thinking_confidence: lastMetricsRef.current.think,
      emotion_bonus: lastMetricsRef.current.emo
    };
  }, []);

  return {
    calculateTurnConfidence,
    updateProfile,
    markAuraSpeaking,
    registerFalseDetection,
    checkUserResumed,
    startSession,
    endSession,
    saveProfile,
    resetProfile,
    getTelemetry,
    profileRef,
  };
}

// ─── Storage helpers ────────────────────────────────────────────────

function loadProfileFromStorage(): SpeechProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultProfile(), ...JSON.parse(raw) };
  } catch {}
  return defaultProfile();
}
