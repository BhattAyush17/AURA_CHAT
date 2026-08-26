/**
 * ConversationContext — Immutable perception snapshot for the Executive.
 *
 * Every subsystem contributes a structured slice.
 * The Executive reads this object. It never queries services directly.
 */

import type { BehaviorAnalysis } from "@/lib/behavior-client";
import type { LanguageState } from "./LanguageState";
import type { RegisterState } from "./RegisterState";

// ─── Subsystem Snapshots ────────────────────────────────────────────

export interface EmotionSnapshot {
  dominant: string; // "calm", "anxious", "playful", etc.
  tension: number; // 0–1
  trust: number; // 0–1
  energy: number; // 0–1
  warmth: number; // 0–1
  engagement: number; // 0–1
  frustration: number; // 0–1
  vulnerability: number; // 0–1
  arc: string; // "building", "peak", "withdrawing"
}

export interface MemorySnapshot {
  retrieved: string[]; // Raw memory strings from retrieval
  relevanceScores: number[]; // Parallel array of relevance (0–1)
  hasPersonalHistory: boolean;
  sessionTurn: number;
}

export interface IdentitySnapshot {
  mode: string; // "supportive", "philosophical", "chaotic", etc.
  seed: string; // Persisted identity seed
  personality: string; // Current personality label
}

export interface UserIdentitySnapshot {
  preferredName?: string;
  stableFacts: string[];
  preferences: string[];
  interests: string[];
  goals: string[];
  importantContext: string[];
}

export interface TimingSnapshot {
  silenceDurationMs: number; // How long the user was silent before this turn
  turnCount: number; // Total turns this session
  lastResponseLatencyMs: number;
  averageResponseLengthWords: number;
}

export interface TranscriptEntry {
  text: string;
  isUser: boolean;
  timestamp: number;
}

export interface ListeningSnapshot {
  /** Speech probability of the last processed frame, 0–1 (primary signal). */
  speechProbability: number;
  /** Ambient noise level in dBFS. */
  noiseLevel: number;
  /** Hysteresis-decided speech presence. */
  speechDetected: boolean;
  /** Continuous silence since the last speech frame, in ms (real silence). */
  realSilence: number;
  /** VAD confidence 0–1. */
  vadConfidence: number;
  /** Which VAD tier produced the values ("silero" | "worklet-stats" | "main-stats" | "rms"). */
  detectionSource: string;
  /** Sustained high-probability speech — target-speaker preparation flag. */
  dominantSpeechDetected: boolean;
}

export interface InputSnapshot {
  text: string; // The user's transcript for this turn
  sttConfidence: number; // 0–1, how confident the STT engine was
  wasInterruption: boolean; // Did the user barge-in over AURA?
  audioRms: number; // Volume level
  languageMode: string; // "hindi_native", "english", "hinglish", etc.
  listening?: Partial<ListeningSnapshot>; // Phase 7.2: Listening Intelligence snapshot
}

// ─── The Context ────────────────────────────────────────────────────

export interface ConversationContext {
  readonly input: InputSnapshot;
  readonly language: LanguageState; // Phase 8: canonical register — Executive-owned
  readonly register: RegisterState; // Phase 8.1: canonical register — Executive-owned
  readonly emotion: EmotionSnapshot;
  readonly memory: MemorySnapshot;
  readonly identity: IdentitySnapshot;
  readonly timing: TimingSnapshot;
  readonly recentHistory: ReadonlyArray<TranscriptEntry>;
  readonly behaviorAnalysis: BehaviorAnalysis | null;
  readonly userIdentity: UserIdentitySnapshot;
}

// ─── Builder ────────────────────────────────────────────────────────

export function buildConversationContext(partial: {
  input: InputSnapshot;
  language?: Partial<LanguageState>;
  register?: Partial<RegisterState>;
  emotion?: Partial<EmotionSnapshot>;
  memory?: Partial<MemorySnapshot>;
  identity?: Partial<IdentitySnapshot>;
  timing?: Partial<TimingSnapshot>;
  recentHistory?: TranscriptEntry[];
  behaviorAnalysis?: BehaviorAnalysis | null;
  userIdentity?: Partial<UserIdentitySnapshot>;
}): ConversationContext {
  const language: LanguageState = {
    dominant: "UNKNOWN",
    secondary: "NONE",
    confidence: 0,
    stability: 0,
    establishedAtTurn: 0,
    transitionReason: null,
    confidenceReasons: [],
    momentumWindow: 0,
    ...partial.language,
  };
  const register: RegisterState = {
    register: "NEUTRAL",
    confidence: 0,
    stability: 0,
    establishedTurn: 0,
    transitionReason: null,
    confidenceReasons: [],
    momentumWindow: 0,
    ...partial.register,
  };
  return Object.freeze({
    input: {
      ...partial.input,
      listening: {
        speechProbability: 0,
        noiseLevel: -100,
        speechDetected: false,
        realSilence: 0,
        vadConfidence: 0,
        detectionSource: "rms",
        dominantSpeechDetected: false,
        ...partial.input.listening,
      },
    },
    language,
    register,
    emotion: {
      dominant: "neutral",
      tension: 0,
      trust: 0.5,
      energy: 0.5,
      warmth: 0.5,
      engagement: 0.5,
      frustration: 0,
      vulnerability: 0,
      arc: "building",
      ...partial.emotion,
    },
    memory: {
      retrieved: [],
      relevanceScores: [],
      hasPersonalHistory: false,
      sessionTurn: 0,
      ...partial.memory,
    },
    identity: {
      mode: "balanced",
      seed: "",
      personality: "adaptive",
      ...partial.identity,
    },
    timing: {
      silenceDurationMs: 0,
      turnCount: 0,
      lastResponseLatencyMs: 0,
      averageResponseLengthWords: 30,
      ...partial.timing,
    },
    userIdentity: {
      stableFacts: [],
      preferences: [],
      interests: [],
      goals: [],
      importantContext: [],
      ...partial.userIdentity,
    },
    recentHistory: Object.freeze(partial.recentHistory ?? []),
    behaviorAnalysis: partial.behaviorAnalysis ?? null,
  });
}
