/**
 * AURA Runtime Diagnostics — telemetry domain types.
 *
 * Contract notes (enforced by construction, see RuntimeTelemetry):
 *  - Everything is scoped sessionId → requestId → operation/call.
 *  - userId falls back to "local/anonymous" until configured.
 *  - Token counts are never fabricated: they carry a UsageTokenSource of
 *    REPORTED (provider-reported), ESTIMATED (local heuristic, clearly labeled)
 *    or UNAVAILABLE.
 *  - A logical request may fan out into multiple physical provider calls
 *    (retry/fallback) — each physical call is its own ProviderCall.
 *  - Streamed chunks for one logical completion = ONE call.
 */

export type ProviderName = "gemini" | "openrouter" | "sarvam" | "local";

export type UsageTokenSource = "REPORTED" | "ESTIMATED" | "UNAVAILABLE";

export type CallKind =
  | "PRIMARY" // first physical attempt for a logical request
  | "RETRY" // another attempt of the SAME model
  | "FALLBACK" // switched to a different model/provider
  | "BACKGROUND"; // not on the user-critical path (prefetch, proactive)

export type CallStatus = "success" | "error" | "aborted" | "timeout";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  inputSource: UsageTokenSource;
  outputSource: UsageTokenSource;
}

export interface ProviderCall {
  callId: string; // C001…
  requestId: string; // R001…
  turnId?: string;
  provider: ProviderName;
  model: string;
  kind: CallKind;
  status: CallStatus;
  startedAt: number;
  endedAt?: number;
  latencyMs?: number;
  ttftMs?: number; // time to first token
  failureCode?: string;
  failureDetail?: string; // sanitized — never contains credentials
  usage?: TokenUsage;
  audio?: boolean; // live audio session (Gemini Live) vs. discrete text call
}

export type MemoryOpType =
  | "memory_retrieval"
  | "memory_write"
  | "memory_update"
  | "profile_fetch"
  | "session_persistence"
  | "music_memory_persistence";

export type MemoryService = "local" | "supabase" | "seed" | "backend";

export interface MemoryOp {
  opId: string; // M001…
  requestId: string;
  turnId?: string;
  type: MemoryOpType;
  service: MemoryService;
  status: "success" | "error";
  startedAt: number;
  endedAt?: number;
  latencyMs?: number;
  resultCount?: number; // memories retrieved / written
  embeddingHint?: boolean; // observed local embedding generation on the client
  duplicate?: boolean; // flagged by RedundancyDetector
}

export type OperationStatus = "pending" | "running" | "success" | "error";

export interface TelemetryOperation {
  id: string; // O001…
  requestId: string;
  name: string;
  service: string; // provider | memory | db | music | infra
  status: OperationStatus;
  startedAt: number;
  endedAt?: number;
}

export type RequestStatus = "running" | "success" | "error";

export interface TelemetryRequest {
  requestId: string;
  turnId?: string;
  sessionId: string;
  startedAt: number;
  endedAt?: number;
  status: RequestStatus;
  latencyMs?: number;
  interrupted?: boolean;
  /** Flattened references kept in sync against the bounded call/op stores. */
  providerCalls: string[];
  memoryOps: string[];
  operations: string[];
}

export type SessionStatus = "active" | "ended";

export interface TelemetrySession {
  sessionId: string;
  userId: string; // "local/anonymous" fallback until configured
  startedAt: number;
  endedAt?: number;
  status: SessionStatus;
  requestCount: number;
  providerCallCount: number;
  tokenInputTotal: number;
  tokenOutputTotal: number;
  memoryOpCount: number;
  errorCount: number;
  humanFeel: {
    contextInjected: number;
    deicticResolved: number;
    followupsDetected: number;
    acknowledgementSuppressed: number;
    musicAssociationsCreated: number;
    musicAssociationsRejected: number;
  };
}

export interface TelemetryErrorRecord {
  id: string; // E001…
  ts: number;
  requestId?: string;
  provider?: ProviderName;
  code: string;
  message: string; // sanitized — never contains credentials
}

export interface BackendCapabilities {
  embeddingProvider: string;
  embeddingAvailable: boolean;
  activeVectorStore: string;
  pineconeConfigured: boolean;
  pineconeActive: boolean;
  supabaseConfigured: boolean;
  chromaReady: boolean;
}

export interface BackendCounterDelta {
  embeddings: number;
  vectorQueries: number;
  vectorUpserts: number;
  ftsQueries: number;
  supabaseReads: number;
  supabaseWrites: number;
  pineconeConfigures: number;
  apiRequests: number;
  failures: number;
}

/** Counters observed since the frontend session began (deltas over server totals). */
export interface BackendTelemetry {
  available: boolean;
  fetchedAt?: number;
  capabilities: BackendCapabilities | null;
  deltas: BackendCounterDelta | null;
  totalsByOp: Record<string, { success: number; failure: number }>;
  recentOps: Array<{
    service: string;
    op: string;
    status: string;
    latency_ms: number | null;
    ts: number;
  }>;
}

export interface MusicContextScore {
  musicAvailable: boolean;
  contextChars: number;
  estimatedTokens: number; // ESTIMATED only (≈ chars / 4)
  tokenSource: "ESTIMATED";
  lastBuiltAt?: number;
  nowPlaying: { title?: string; artist?: string } | null;
  playbackState: string;
}

// ── Mobile Music Pipeline forensic telemetry ─────────────────────────
//
// Read-only observability for the HTMLAudioElement → AudioContext → DSP →
// MusicalEvidenceFusion → AURA pipeline. NEVER stores audio data, raw
// Float32Array buffers, credentials, or signed CDN URLs. Source URL is
// classified into direct|blob|proxy|unknown.

export type MobileBrowserClass =
  | "iOS Safari"
  | "iOS Chrome"
  | "Android Chrome"
  | "Android Firefox"
  | "Desktop Chrome"
  | "Desktop Safari"
  | "Desktop Firefox"
  | "Unknown";

export type AudioSourceClass = "direct" | "blob" | "proxy" | "unknown";

export type AudioContextLifecycle = "absent" | "created" | "suspended" | "running" | "closed";

export type MediaSourceLifecycle = "absent" | "created" | "reused" | "failed";

export type AnalyserLifecycle = "absent" | "created" | "active" | "failed";

export type DspLoopLifecycle = "stopped" | "running" | "stalled";

export type PerceptionProviderLifecycle = "inactive" | "active" | "degraded";

export type MobileMusicDiagnosis =
  | "PIPELINE_ACTIVE"
  | "PLAYBACK_NOT_STARTED"
  | "AUDIO_CONTEXT_UNAVAILABLE"
  | "AUDIO_CONTEXT_SUSPENDED"
  | "MEDIA_SOURCE_FAILED"
  | "ANALYSER_UNAVAILABLE"
  | "DSP_LOOP_NOT_RUNNING"
  | "DSP_ZERO_SIGNAL"
  | "DSP_INTERRUPTED_BY_LIFECYCLE"
  | "CORS_SUSPECTED"
  | "PERCEPTION_ORCHESTRATOR_INACTIVE"
  | "NO_SIGNALS_YET"
  | "UNKNOWN";

export type MobileMusicTimelineKind =
  | "user_gesture"
  | "play_requested"
  | "play_resolved"
  | "play_rejected"
  | "playing"
  | "pause"
  | "waiting"
  | "stalled"
  | "canplay"
  | "loadedmetadata"
  | "error"
  | "ended"
  | "seeking"
  | "seeked"
  | "audio_context_created"
  | "audio_context_resume_requested"
  | "audio_context_resume_resolved"
  | "audio_context_resume_rejected"
  | "audio_context_state_running"
  | "audio_context_state_suspended"
  | "audio_context_state_closed"
  | "media_element_source_created"
  | "media_element_source_reused"
  | "media_element_source_failed"
  | "analyser_created"
  | "dsp_loop_started"
  | "dsp_loop_stopped"
  | "dsp_zero_signal_frame"
  | "dsp_signal_recovered"
  | "visibility_hidden"
  | "visibility_visible"
  | "page_hide"
  | "page_show";

export interface MobileMusicTimelineEntry {
  ts: number;
  kind: MobileMusicTimelineKind;
  note?: string;
}

export interface MobileMusicDspFrame {
  rms: number;
  spectralFlux: number;
  highFreqEnergy: number;
  zeroSignalThreshold: number;
}

export interface MobileMusicPipelineState {
  /** Browser / device classification (safe env metadata only). */
  env: {
    browserClass: MobileBrowserClass;
    isMobile: boolean;
    isIOS: boolean;
    isAndroid: boolean;
    isSafari: boolean;
    userAgent: string;
    platform: string;
    vendor: string;
    viewport: { w: number; h: number } | null;
    /** AudioContext / OfflineAudioContext / Analyser / MESN availability. */
    webAudio: {
      audioContext: boolean;
      offlineAudioContext: boolean;
      mediaElementAudioSourceNode: boolean;
      analyserNode: boolean;
    };
  };
  /** Audio element / playback state. */
  audioElement: {
    present: boolean;
    paused: boolean | null;
    readyState: number | null;
    networkState: number | null;
    currentTime: number | null;
    duration: number | null;
    crossOrigin: string | null;
    sourceClass: AudioSourceClass;
  };
  /** AudioContext lifecycle + last resume reason. */
  audioContext: {
    lifecycle: AudioContextLifecycle;
    sampleRate: number | null;
    baseLatency: number | null;
    outputLatency: number | null;
    lastResumeReason:
      | MobileMusicTimelineKind
      | "initialization"
      | "playback_started"
      | "user_gesture"
      | "visibility_change"
      | "manual_resume"
      | "none";
    resumeRequested: number;
    resumeResolved: number;
    resumeRejected: number;
  };
  /** MediaElementAudioSourceNode (uses the existing WeakMap protection). */
  mediaElementSource: {
    lifecycle: MediaSourceLifecycle;
    invalidStateError: boolean;
    boundElementId: number | null;
  };
  /** AnalyserNode. */
  analyser: {
    lifecycle: AnalyserLifecycle;
    fftSize: number | null;
    frequencyBinCount: number | null;
  };
  /** DSP analysis loop. */
  dspLoop: {
    lifecycle: DspLoopLifecycle;
    targetHz: number;
    actualHz: number;
    tickCount: number;
    lastTickAt: number | null;
    ticksLast1s: number;
    lastFrame: MobileMusicDspFrame | null;
    consecutiveZeroFrames: number;
  };
  /** MusicPerceptionOrchestrator status. */
  perception: {
    lifecycle: PerceptionProviderLifecycle;
    signalsIn: number;
    signalsOut: number;
    lastSignalAt: number | null;
    lastSignalType: string | null;
    lastContextRebuildAt: number | null;
  };
  /** MusicalEvidenceFusion counters. */
  evidence: {
    signalsReceived: number;
    evidenceGenerated: number;
    momentsGenerated: number;
    lastMomentAt: number | null;
    lastSourceCategories: string[];
  };
  /** iOS-style gesture chain status. */
  gesture: {
    lastGestureAt: number | null;
    playResolvedAfterGesture: boolean | null;
    audioContextResumedAfterPlay: boolean | null;
  };
  /** Visibility / page lifecycle. */
  visibility: {
    state: "visible" | "hidden" | "unknown";
    hidden: boolean | null;
  };
  /** Most recent timeline events (capped). */
  timeline: MobileMusicTimelineEntry[];
  /** User-facing health matrix. */
  health: {
    playback: "active" | "degraded" | "failed" | "not_initialized";
    audioContext: "active" | "suspended" | "degraded" | "failed" | "not_initialized";
    mediaSource: "active" | "reused" | "failed" | "not_initialized";
    analyser: "active" | "degraded" | "failed" | "not_initialized";
    dspLoop: "active" | "stalled" | "not_running" | "not_initialized";
    dspSignal: "active" | "zero" | "not_initialized";
    perception: "active" | "inactive" | "not_initialized";
    evidenceFusion: "active" | "waiting" | "not_initialized";
  };
  /** Classification. */
  diagnosis: MobileMusicDiagnosis;
  diagnosisEvidence: string[];
  /** Conservative threshold used for zero-signal detection. */
  zeroSignalThreshold: number;
}

export interface TelemetrySnapshot {
  startedAt: number;
  session: TelemetrySession;
  requests: TelemetryRequest[];
  providerCalls: ProviderCall[];
  memoryOps: MemoryOp[];
  operations: TelemetryOperation[];
  errors: TelemetryErrorRecord[];
  backend: BackendTelemetry;
  music: MusicContextScore | null;
  mobileMusicPipeline: MobileMusicPipelineState;
}

export interface TelemetryListener {
  (snapshot: TelemetrySnapshot): void;
}
