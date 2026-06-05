/**
 * AURA Resilience Layer — Core Type Definitions
 *
 * All types used across the resilience subsystem are defined here.
 * No runtime code — pure type declarations.
 *
 * @module resilience/types
 */

// ═══════════════════════════════════════════════════════════════════
// HEALTH SCORES
// ═══════════════════════════════════════════════════════════════════

/** 0–100 normalized health score */
export type HealthScore = number;

/** Experience mode derived from experienceHealthScore */
export type ExperienceMode = "HEALTHY" | "WARNING" | "RECOVERY" | "CRITICAL";

/** Thresholds for mode transitions (hysteresis built in) */
export const MODE_THRESHOLDS = {
  HEALTHY:   { enter: 80, exit: 72 },
  WARNING:   { enter: 55, exit: 48 },
  RECOVERY:  { enter: 30, exit: 22 },
  // CRITICAL is anything below RECOVERY.exit
} as const;

// ═══════════════════════════════════════════════════════════════════
// WATCHDOG STATES (Phase 1)
// ═══════════════════════════════════════════════════════════════════

export type STTState = "active" | "idle" | "error" | "frozen" | "fallback";

export interface STTHealthState {
  state: STTState;
  health: HealthScore;
  lastEventTs: number;
  lastTranscriptTs: number;
  errorCount: number;
  restartCount: number;
  /** Current position in the recovery ladder */
  recoveryLevel: 0 | 1 | 2 | 3;
  isFrozen: boolean;
}

export type AudioPlaybackState = "playing" | "idle" | "stalled" | "suspended" | "error";

export interface AudioHealthState {
  state: AudioPlaybackState;
  health: HealthScore;
  contextState: AudioContextState | "unavailable";
  queueDepth: number;
  lastPlaybackTs: number;
  stallCount: number;
  resumeAttempts: number;
}

export interface NetworkHealthState {
  health: HealthScore;
  rttMs: number;
  avgApiLatencyMs: number;
  timeoutCount: number;
  retryCount: number;
  isOnline: boolean;
  effectiveType: string;
  /** Sliding window of recent latency samples */
  latencySamples: number[];
}

/** Aggregated output from Phase 1 watchdogs */
export interface ResilienceState {
  sttHealth: STTHealthState;
  audioHealth: AudioHealthState;
  networkHealth: NetworkHealthState;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════
// DEVICE & EXPERIENCE (Phase 2)
// ═══════════════════════════════════════════════════════════════════

export interface DeviceProfile {
  score: HealthScore;
  cores: number;
  memoryGB: number;
  avgFrameTimeMs: number;
  isMobile: boolean;
  isLowEnd: boolean;
  /** GPU tier estimate: "high" | "mid" | "low" | "unknown" */
  gpuTier: string;
}

export interface ExperienceHealthSnapshot {
  score: HealthScore;
  mode: ExperienceMode;
  deviceCapability: HealthScore;
  networkHealth: HealthScore;
  sttHealth: HealthScore;
  audioHealth: HealthScore;
  /** Timestamp of this snapshot */
  ts: number;
}

/** Adaptation policy output for LLM/TTS consumers */
export interface AdaptationPolicy {
  mode: ExperienceMode;
  /** Max response tokens hint */
  maxTokensHint: number;
  /** Whether to compress delivery structure */
  compressDelivery: boolean;
  /** Whether to reduce redundancy */
  reduceRedundancy: boolean;
  /** Whether streaming should be more aggressive (smaller chunks) */
  aggressiveStreaming: boolean;
  /** Context budget multiplier (1.0 = full, 0.5 = half) */
  contextBudgetMultiplier: number;
  /** Human-readable reason for current mode */
  reason: string;
}

// ═══════════════════════════════════════════════════════════════════
// SELF-HEALING (Phase 3)
// ═══════════════════════════════════════════════════════════════════

export type ProviderRole = "stt" | "tts" | "llm";

export interface ProviderEntry {
  id: string;
  role: ProviderRole;
  priority: number;
  isAvailable: boolean;
  failCount: number;
  lastFailTs: number;
  avgLatencyMs: number;
}

export interface ProviderMeshState {
  stt: ProviderEntry[];
  tts: ProviderEntry[];
  llm: ProviderEntry[];
  activeProviders: Record<ProviderRole, string>;
}

export interface ConversationSnapshot {
  topic: string;
  emotion: string;
  momentum: number;
  lastUserIntent: string;
  lastAssistantIntent: string;
  turnCount: number;
  /** ISO timestamp */
  savedAt: string;
  sessionId: string;
}

export interface FailureRecord {
  type: string;
  count: number;
  lastTs: number;
  /** Rolling window timestamps */
  recentTs: number[];
}

export interface PredictiveFailureState {
  records: Record<string, FailureRecord>;
  /** Failure types predicted to recur soon */
  predictions: string[];
}

export interface QueueProtectionState {
  currentChunk: string | null;
  nextChunk: string | null;
  nextNextChunk: string | null;
  queueDepth: number;
  isProtected: boolean;
}

export interface SilenceEvent {
  detectedAt: number;
  durationMs: number;
  context: string;
  recoveryAction: string;
  resolved: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════

export type RecoveryAction =
  | { type: "stt_restart"; level: number }
  | { type: "audio_resume" }
  | { type: "audio_rebuild" }
  | { type: "provider_switch"; role: ProviderRole; to: string }
  | { type: "silence_fill"; text: string }
  | { type: "queue_refill" }
  | { type: "context_resume" }
  | { type: "noop" };

export interface RecoveryAttempt {
  action: RecoveryAction;
  ts: number;
  success: boolean;
}

export interface OrchestratorState {
  mode: ExperienceMode;
  experienceHealth: ExperienceHealthSnapshot;
  resilience: ResilienceState;
  providerMesh: ProviderMeshState;
  adaptationPolicy: AdaptationPolicy;
  recentRecoveries: RecoveryAttempt[];
  /** Prevents recovery loops — cooldown per action type in ms */
  cooldowns: Record<string, number>;
  isRecovering: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// EVENT BUS
// ═══════════════════════════════════════════════════════════════════

export type ResilienceEvent =
  | { kind: "stt_error"; error: string; ts: number }
  | { kind: "stt_frozen"; durationMs: number; ts: number }
  | { kind: "stt_recovered"; level: number; ts: number }
  | { kind: "audio_stalled"; durationMs: number; ts: number }
  | { kind: "audio_suspended"; ts: number }
  | { kind: "audio_recovered"; ts: number }
  | { kind: "network_degraded"; health: number; ts: number }
  | { kind: "network_recovered"; health: number; ts: number }
  | { kind: "silence_detected"; durationMs: number; ts: number }
  | { kind: "silence_filled"; text: string; ts: number }
  | { kind: "provider_switched"; role: ProviderRole; from: string; to: string; ts: number }
  | { kind: "mode_changed"; from: ExperienceMode; to: ExperienceMode; ts: number }
  | { kind: "recovery_attempted"; action: RecoveryAction; ts: number }
  | { kind: "recovery_failed"; action: RecoveryAction; ts: number }
  | { kind: "conversation_saved"; ts: number }
  | { kind: "conversation_restored"; ts: number };

export type ResilienceEventListener = (event: ResilienceEvent) => void;
