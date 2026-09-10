/**
 * RuntimeTelemetry — the single in-memory observability store for AURA.
 *
 * Design constraints honored:
 *  - Observability ONLY: no store writes ever trigger provider/LLM calls.
 *  - Per-session scoping with userId "local/anonymous" fallback; a new session
 *    replaces the previous session wholesale (multi-user isolation).
 *  - Bounded memory: requests / calls / ops / errors are pruned to keep the
 *    panel attached without unbounded growth.
 *  - No credentials: we never store keys or secrets — only booleans/counts.
 *  - Token counts always carry a UsageTokenSource (REPORTED/ESTIMATED/UNAVAILABLE).
 */

import type {
  BackendTelemetry,
  CallKind,
  CallStatus,
  MemoryOp,
  MemoryOpType,
  MemoryService,
  ProviderCall,
  ProviderName,
  MusicContextScore,
  MobileMusicDiagnosis,
  MobileMusicDspFrame,
  MobileMusicPipelineState,
  MobileMusicTimelineEntry,
  MobileMusicTimelineKind,
  OperationStatus,
  RequestStatus,
  TelemetryErrorRecord,
  TelemetryListener,
  TelemetryOperation,
  TelemetryRequest,
  TelemetrySession,
  TelemetrySnapshot,
  TokenUsage,
} from "./types";

const MAX_REQUESTS = 24;
const MAX_CALLS = 400;
const MAX_MEMORY_OPS = 300;
const MAX_OPERATIONS = 300;
const MAX_ERRORS = 50;

/** Mobile music pipeline timeline depth. Bounded to avoid unbounded growth. */
const MAX_MOBILE_TIMELINE = 80;
/** Conservative RMS floor below which a frame is "near zero" (peak-normalized
 *  Float32 time-domain ≈ [-1, 1]). 0.005 matches the perception provider's
 *  internal silence threshold. Surfaced in diagnostics for transparency. */
const ZERO_SIGNAL_RMS_THRESHOLD = 0.005;
/** Number of consecutive near-zero frames required to declare the DSP graph
 *  as not receiving signal (even though the AudioContext claims to be running). */
const ZERO_SIGNAL_FRAMES_TO_FLAG = 30;

function now(): number {
  return Date.now();
}

function uid(prefix: string, counter: number): string {
  return `${prefix}${String(counter).padStart(3, "0")}`;
}

export class RuntimeTelemetry {
  private listeners = new Set<TelemetryListener>();

  private startedAt = now();

  // counters for id generation
  private seqRequest = 0;
  private seqCall = 0;
  private seqMemory = 0;
  private seqOperation = 0;
  private seqError = 0;

  private session: TelemetrySession = {
    sessionId: "",
    userId: "local/anonymous",
    startedAt: this.startedAt,
    status: "active",
    requestCount: 0,
    providerCallCount: 0,
    tokenInputTotal: 0,
    tokenOutputTotal: 0,
    memoryOpCount: 0,
    errorCount: 0,
    humanFeel: {
      contextInjected: 0,
      deicticResolved: 0,
      followupsDetected: 0,
      acknowledgementSuppressed: 0,
      musicAssociationsCreated: 0,
      musicAssociationsRejected: 0,
    },
  };

  private requests: TelemetryRequest[] = [];
  private calls = new Map<string, ProviderCall>();
  private memoryOps = new Map<string, MemoryOp>();
  private operations = new Map<string, TelemetryOperation>();
  private errors: TelemetryErrorRecord[] = [];

  private backend: BackendTelemetry = {
    available: false,
    capabilities: null,
    deltas: null,
    totalsByOp: {},
    recentOps: [],
  };

  private music: MusicContextScore | null = null;

  private mobileMusicPipeline: MobileMusicPipelineState = createDefaultMobileMusicPipeline();

  // ── Subscription ────────────────────────────────────────────────

  subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private emit() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((l) => l(snapshot));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("aura:telemetry", { detail: snapshot }));
    }
  }

  // ── Session / identity ──────────────────────────────────────────

  beginSession(opts?: { sessionId?: string; userId?: string }): string {
    const sessionId =
      opts?.sessionId || (crypto?.randomUUID ? crypto.randomUUID() : `session_${now()}`);
    const userId = opts?.userId || "local/anonymous";
    const startedAt = now();
    this.session = {
      sessionId,
      userId,
      startedAt,
      status: "active",
      requestCount: 0,
      providerCallCount: 0,
      tokenInputTotal: 0,
      tokenOutputTotal: 0,
      memoryOpCount: 0,
      errorCount: 0,
      humanFeel: {
        contextInjected: 0,
        deicticResolved: 0,
        followupsDetected: 0,
        acknowledgementSuppressed: 0,
        musicAssociationsCreated: 0,
        musicAssociationsRejected: 0,
      },
    };
    this.requests = [];
    this.calls.clear();
    this.memoryOps.clear();
    this.operations.clear();
    this.errors = [];
    this.backend = {
      available: false,
      capabilities: null,
      deltas: null,
      totalsByOp: {},
      recentOps: [],
    };
    this.music = null;
    this.mobileMusicPipeline = createDefaultMobileMusicPipeline();
    this.startedAt = startedAt;
    this.emit();
    return sessionId;
  }

  setUserId(userId: string | null | undefined): void {
    this.session.userId = userId || "local/anonymous";
    this.emit();
  }

  getSessionId(): string {
    return this.session.sessionId;
  }

  endSession(): void {
    if (this.session.status === "ended") return;
    this.session.status = "ended";
    this.session.endedAt = now();
    this.requests.forEach((r) => {
      if (r.status === "running") {
        r.status = "error";
        r.endedAt = r.endedAt ?? now();
      }
    });
    this.emit();
  }

  // ── Requests ────────────────────────────────────────────────────

  beginRequest(opts: { turnId?: string } = {}): string {
    const requestId = uid("R", ++this.seqRequest);
    this.requests.push({
      requestId,
      turnId: opts.turnId,
      sessionId: this.session.sessionId,
      startedAt: now(),
      status: "running",
      providerCalls: [],
      memoryOps: [],
      operations: [],
    });
    this.session.requestCount += 1;
    this.prune();
    this.emit();
    return requestId;
  }

  endRequest(
    requestId: string,
    opts: { status?: RequestStatus; interrupted?: boolean } = {},
  ): void {
    const req = this.requests.find((r) => r.requestId === requestId);
    if (!req) return;
    req.status = opts.status ?? (req.providerCalls.length === 0 ? "success" : "success");
    req.endedAt = now();
    req.latencyMs = req.endedAt - req.startedAt;
    if (opts.interrupted) req.interrupted = true;
    this.emit();
  }

  getRequest(requestId: string): TelemetryRequest | undefined {
    return this.requests.find((r) => r.requestId === requestId);
  }

  getCurrentRequest(): TelemetryRequest | undefined {
    return this.requests[this.requests.length - 1];
  }

  onRequestFailure(requestId?: string, code = "500", message = ""): void {
    if (requestId) {
      const req = this.requests.find((r) => r.requestId === requestId);
      if (req && req.status === "running") {
        req.status = "error";
        req.endedAt = now();
        req.latencyMs = req.endedAt - req.startedAt;
      }
    }
    this.recordError({ code, message, requestId });
  }

  // ── Provider calls ──────────────────────────────────────────────

  beginProviderCall(opts: {
    provider: ProviderName;
    model: string;
    kind?: CallKind;
    audio?: boolean;
    requestId?: string;
    turnId?: string;
  }): string {
    const requestId = opts.requestId || this.getCurrentRequest()?.requestId || this.beginRequest();
    const callId = uid("C", ++this.seqCall);
    const call: ProviderCall = {
      callId,
      requestId,
      provider: opts.provider,
      model: opts.model,
      kind: opts.kind ?? "PRIMARY",
      status: "aborted",
      startedAt: now(),
      audio: opts.audio,
    };
    if (opts.turnId) call.turnId = opts.turnId;
    this.calls.set(callId, call);
    const req = this.getRequest(requestId);
    req?.providerCalls.push(callId);
    this.session.providerCallCount += 1;
    this.prune();
    this.emit();
    return callId;
  }

  endProviderCall(
    callId: string,
    result: {
      status: CallStatus;
      ttftMs?: number;
      usage?: Partial<TokenUsage>;
      failureCode?: string;
      failureDetail?: string;
    },
  ): void {
    const call = this.calls.get(callId);
    if (!call) return;
    call.status = result.status;
    call.endedAt = now();
    call.latencyMs = call.endedAt - call.startedAt;
    if (result.ttftMs != null) call.ttftMs = result.ttftMs;
    if (result.failureCode) call.failureCode = result.failureCode;
    if (result.failureDetail) call.failureDetail = this.sanitize(result.failureDetail);
    if (result.usage) {
      this.applyUsage(call, result.usage);
    }
    this.emit();
  }

  /** Update usage on a still-running provider call (e.g. live session stream). */
  updateProviderCallUsage(callId: string, usage: Partial<TokenUsage>): void {
    const call = this.calls.get(callId);
    if (!call) return;
    const existing = call.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      inputSource: "UNAVAILABLE" as const,
      outputSource: "UNAVAILABLE" as const,
    };
    const merged: Partial<TokenUsage> = {
      inputTokens: usage.inputTokens ?? existing.inputTokens,
      outputTokens: usage.outputTokens ?? existing.outputTokens,
      inputSource: usage.inputSource ?? existing.inputSource,
      outputSource: usage.outputSource ?? existing.outputSource,
    };
    this.applyUsage(call, merged);
    this.emit();
  }

  private applyUsage(call: ProviderCall, usage: Partial<TokenUsage>): void {
    const beforeIn = call.usage?.inputTokens ?? 0;
    const beforeOut = call.usage?.outputTokens ?? 0;
    const nextIn = clamp0(usage.inputTokens);
    const nextOut = clamp0(usage.outputTokens);
    call.usage = {
      inputTokens: nextIn,
      outputTokens: nextOut,
      inputSource: usage.inputSource ?? "UNAVAILABLE",
      outputSource: usage.outputSource ?? "UNAVAILABLE",
    };
    // Session totals track only the *delta* to keep them accurate across
    // multiple live updates without double-counting.
    this.session.tokenInputTotal += Math.max(0, nextIn - beforeIn);
    this.session.tokenOutputTotal += Math.max(0, nextOut - beforeOut);
  }

  /** Attach a long-running provider call (e.g. a live session) to a request. */
  attachCallToRequest(callId: string, requestId: string): void {
    const call = this.calls.get(callId);
    if (!call) return;
    const req = this.requests.find((r) => r.requestId === requestId);
    if (!req) return;
    if (!req.providerCalls.includes(callId)) {
      req.providerCalls.push(callId);
    }
    this.emit();
  }

  attachMemoryOpToRequest(opId: string, requestId: string): void {
    const op = this.memoryOps.get(opId);
    if (!op) return;
    const req = this.requests.find((r) => r.requestId === requestId);
    if (!req) return;
    if (!req.memoryOps.includes(opId)) {
      req.memoryOps.push(opId);
    }
    this.emit();
  }

  // ── Memory ops ──────────────────────────────────────────────────

  beginMemoryOp(opts: {
    type: MemoryOpType;
    service: MemoryService;
    requestId?: string;
    turnId?: string;
    embeddingHint?: boolean;
  }): string {
    const requestId = opts.requestId || this.getCurrentRequest()?.requestId || this.beginRequest();
    const opId = uid("M", ++this.seqMemory);
    const op: MemoryOp = {
      opId,
      requestId,
      type: opts.type,
      service: opts.service,
      status: "success",
      startedAt: now(),
      embeddingHint: opts.embeddingHint,
    };
    if (opts.turnId) op.turnId = opts.turnId;
    this.memoryOps.set(opId, op);
    const req = this.getRequest(requestId);
    req?.memoryOps.push(opId);
    this.session.memoryOpCount += 1;
    this.prune();
    this.emit();
    return opId;
  }

  endMemoryOp(
    opId: string,
    result: { status?: "success" | "error"; resultCount?: number; latencyMs?: number },
  ): void {
    const op = this.memoryOps.get(opId);
    if (!op) return;
    if (result.status) op.status = result.status;
    if (result.resultCount != null) op.resultCount = result.resultCount;
    op.endedAt = now();
    op.latencyMs = result.latencyMs ?? op.endedAt - op.startedAt;
    if (op.status === "error") {
      const req = this.getRequest(op.requestId);
      if (req && req.status === "running") {
        req.status = "error";
      }
    }
    this.emit();
  }

  // Abbreviated convenience: begin+end in one call.
  recordMemoryOp(opts: {
    type: MemoryOpType;
    service: MemoryService;
    requestId?: string;
    turnId?: string;
    status?: "success" | "error";
    resultCount?: number;
    latencyMs?: number;
    embeddingHint?: boolean;
  }): string {
    const opId = this.beginMemoryOp(opts);
    this.endMemoryOp(opId, {
      status: opts.status,
      resultCount: opts.resultCount,
      latencyMs: opts.latencyMs,
    });
    return opId;
  }

  // ── Operations timeline (request-level spans) ───────────────────

  beginOperation(opts: { requestId?: string; name: string; service: string }): string {
    const requestId = opts.requestId || this.getCurrentRequest()?.requestId || this.beginRequest();
    const id = uid("O", ++this.seqOperation);
    const op: TelemetryOperation = {
      id,
      requestId,
      name: opts.name,
      service: opts.service,
      status: "running",
      startedAt: now(),
    };
    this.operations.set(id, op);
    const req = this.getRequest(requestId);
    if (req) req.operations.push(id);
    this.prune();
    return id;
  }

  endOperation(id: string, status: OperationStatus = "success"): void {
    const op = this.operations.get(id);
    if (!op) return;
    op.status = status;
    op.endedAt = now();
    this.emit();
  }

  // ── Errors ──────────────────────────────────────────────────────

  recordError(opts: {
    code?: string;
    message?: string;
    requestId?: string;
    provider?: ProviderName;
  }): void {
    this.errors.push({
      id: uid("E", ++this.seqError),
      ts: now(),
      requestId: opts.requestId,
      provider: opts.provider,
      code: opts.code || "500",
      message: this.sanitize(opts.message || opts.code || "Unknown error"),
    });
    this.session.errorCount += 1;
    if (this.errors.length > MAX_ERRORS) this.errors.splice(0, this.errors.length - MAX_ERRORS);
    this.emit();
  }

  // ── Backend / infra counters ────────────────────────────────────

  setBackendTelemetry(backend: BackendTelemetry): void {
    this.backend = backend;
    this.emit();
  }

  // ── Music context ───────────────────────────────────────────────

  setMusicContext(music: MusicContextScore | null): void {
    this.music = music;
    this.emit();
  }

  // ── Human Feel metrics ─────────────────────────────────────────

  recordHumanFeelEvent(event: keyof TelemetrySession["humanFeel"]): void {
    if (event in this.session.humanFeel) {
      this.session.humanFeel[event]++;
      this.emit();
    }
  }

  // ── Snapshot / maintenance ──────────────────────────────────────

  getSnapshot(): TelemetrySnapshot {
    return {
      startedAt: this.startedAt,
      session: { ...this.session },
      requests: [...this.requests],
      providerCalls: [...this.calls.values()],
      memoryOps: [...this.memoryOps.values()],
      operations: [...this.operations.values()],
      errors: [...this.errors],
      backend: {
        ...this.backend,
        deltas: this.backend.deltas ? { ...this.backend.deltas } : null,
        capabilities: this.backend.capabilities ? { ...this.backend.capabilities } : null,
      },
      music: this.music ? { ...this.music } : null,
      mobileMusicPipeline: cloneMobileMusicPipeline(this.mobileMusicPipeline),
    };
  }

  debugSnapshot(): TelemetrySnapshot {
    return this.getSnapshot();
  }

  // ── Mobile music pipeline observability ───────────────────────────
  //
  // Read-only instrumentation. Providers call these helpers to record
  // safe, non-sensitive state. The recorder never blocks the calling
  // code path and never triggers provider/LLM calls.

  getMobileMusicPipeline(): MobileMusicPipelineState {
    return cloneMobileMusicPipeline(this.mobileMusicPipeline);
  }

  /** Record a timeline event (kept bounded). */
  recordMobileMusicTimeline(kind: MobileMusicTimelineKind, note?: string): void {
    const t: MobileMusicTimelineEntry = { ts: now(), kind };
    if (note) t.note = note.slice(0, 160);
    this.mobileMusicPipeline.timeline.push(t);
    if (this.mobileMusicPipeline.timeline.length > MAX_MOBILE_TIMELINE) {
      this.mobileMusicPipeline.timeline.splice(
        0,
        this.mobileMusicPipeline.timeline.length - MAX_MOBILE_TIMELINE,
      );
    }
    this.recomputeMobileHealth();
    this.emit();
  }

  /** Update the environment (browser, viewport, capability probes). */
  updateMobileMusicEnvironment(patch: Partial<MobileMusicPipelineState["env"]>): void {
    this.mobileMusicPipeline.env = { ...this.mobileMusicPipeline.env, ...patch };
    this.emit();
  }

  /** Update audio element snapshot. */
  updateMobileMusicAudioElement(patch: Partial<MobileMusicPipelineState["audioElement"]>): void {
    this.mobileMusicPipeline.audioElement = {
      ...this.mobileMusicPipeline.audioElement,
      ...patch,
    };
    this.recomputeMobileHealth();
    this.emit();
  }

  /** Update AudioContext snapshot. */
  updateMobileMusicAudioContext(
    patch:
      | Partial<MobileMusicPipelineState["audioContext"]>
      | ((
          prev: MobileMusicPipelineState["audioContext"],
        ) => Partial<MobileMusicPipelineState["audioContext"]>),
  ): void {
    const next = typeof patch === "function" ? patch(this.mobileMusicPipeline.audioContext) : patch;
    this.mobileMusicPipeline.audioContext = {
      ...this.mobileMusicPipeline.audioContext,
      ...next,
    };
    this.recomputeMobileHealth();
    this.emit();
  }

  /** Update MediaElementAudioSourceNode snapshot. */
  updateMobileMusicMediaElementSource(
    patch: Partial<MobileMusicPipelineState["mediaElementSource"]>,
  ): void {
    this.mobileMusicPipeline.mediaElementSource = {
      ...this.mobileMusicPipeline.mediaElementSource,
      ...patch,
    };
    this.recomputeMobileHealth();
    this.emit();
  }

  /** Update AnalyserNode snapshot. */
  updateMobileMusicAnalyser(patch: Partial<MobileMusicPipelineState["analyser"]>): void {
    this.mobileMusicPipeline.analyser = {
      ...this.mobileMusicPipeline.analyser,
      ...patch,
    };
    this.recomputeMobileHealth();
    this.emit();
  }

  /** Update DSP loop snapshot (called once per tick). */
  updateMobileMusicDspLoop(patch: Partial<MobileMusicPipelineState["dspLoop"]>): void {
    this.mobileMusicPipeline.dspLoop = {
      ...this.mobileMusicPipeline.dspLoop,
      ...patch,
    };
    this.recomputeMobileHealth();
    this.emit();
  }

  /** Update perception orchestrator counters. */
  updateMobileMusicPerception(patch: Partial<MobileMusicPipelineState["perception"]>): void {
    this.mobileMusicPipeline.perception = {
      ...this.mobileMusicPipeline.perception,
      ...patch,
    };
    this.recomputeMobileHealth();
    this.emit();
  }

  /** Update evidence fusion counters. */
  updateMobileMusicEvidence(
    patch:
      | Partial<MobileMusicPipelineState["evidence"]>
      | ((
          prev: MobileMusicPipelineState["evidence"],
        ) => Partial<MobileMusicPipelineState["evidence"]>),
  ): void {
    const next = typeof patch === "function" ? patch(this.mobileMusicPipeline.evidence) : patch;
    this.mobileMusicPipeline.evidence = {
      ...this.mobileMusicPipeline.evidence,
      ...next,
    };
    this.recomputeMobileHealth();
    this.emit();
  }

  /** Update gesture chain status. */
  updateMobileMusicGesture(patch: Partial<MobileMusicPipelineState["gesture"]>): void {
    this.mobileMusicPipeline.gesture = {
      ...this.mobileMusicPipeline.gesture,
      ...patch,
    };
    this.recomputeMobileHealth();
    this.emit();
  }

  /** Update page visibility snapshot. */
  updateMobileMusicVisibility(patch: Partial<MobileMusicPipelineState["visibility"]>): void {
    this.mobileMusicPipeline.visibility = {
      ...this.mobileMusicPipeline.visibility,
      ...patch,
    };
    this.recomputeMobileHealth();
    this.emit();
  }

  /** Recompute the health matrix and the primary diagnosis. */
  private recomputeMobileHealth(): void {
    const s = this.mobileMusicPipeline;
    const a = s.audioElement;
    const c = s.audioContext;
    const m = s.mediaElementSource;
    const an = s.analyser;
    const d = s.dspLoop;
    const p = s.perception;
    const e = s.evidence;

    // ── Per-stage health classification ──────────────────────────────
    const playbackHealth = !a.present
      ? "not_initialized"
      : a.paused === false
        ? "active"
        : a.paused === true
          ? "degraded"
          : "not_initialized";

    const audioContextHealth =
      c.lifecycle === "running"
        ? "active"
        : c.lifecycle === "suspended"
          ? "suspended"
          : c.lifecycle === "closed" || c.lifecycle === "absent"
            ? "not_initialized"
            : "degraded";

    const mediaSourceHealth =
      m.lifecycle === "created"
        ? "active"
        : m.lifecycle === "reused"
          ? "reused"
          : m.lifecycle === "failed"
            ? "failed"
            : "not_initialized";

    const analyserHealth =
      an.lifecycle === "active"
        ? "active"
        : an.lifecycle === "failed"
          ? "failed"
          : an.lifecycle === "created"
            ? "degraded"
            : "not_initialized";

    const dspLoopHealth =
      d.lifecycle === "running" ? "active" : d.lifecycle === "stalled" ? "stalled" : "not_running";

    const dspSignalHealth = !d.lastFrame
      ? "not_initialized"
      : d.consecutiveZeroFrames >= ZERO_SIGNAL_FRAMES_TO_FLAG
        ? "zero"
        : "active";

    const perceptionHealth =
      p.lifecycle === "active" ? "active" : p.lifecycle === "degraded" ? "degraded" : "inactive";

    const evidenceHealth =
      e.momentsGenerated > 0 || e.evidenceGenerated > 0
        ? "active"
        : p.signalsIn > 0
          ? "waiting"
          : "not_initialized";

    s.health = {
      playback: playbackHealth as MobileMusicPipelineState["health"]["playback"],
      audioContext: audioContextHealth as MobileMusicPipelineState["health"]["audioContext"],
      mediaSource: mediaSourceHealth as MobileMusicPipelineState["health"]["mediaSource"],
      analyser: analyserHealth as MobileMusicPipelineState["health"]["analyser"],
      dspLoop: dspLoopHealth as MobileMusicPipelineState["health"]["dspLoop"],
      dspSignal: dspSignalHealth as MobileMusicPipelineState["health"]["dspSignal"],
      perception: perceptionHealth as MobileMusicPipelineState["health"]["perception"],
      evidenceFusion: evidenceHealth as MobileMusicPipelineState["health"]["evidenceFusion"],
    };

    // ── Primary diagnosis (only when playback is actually attempting) ─
    const evidence: string[] = [];
    let diagnosis: MobileMusicDiagnosis = "UNKNOWN";

    if (s.health.playback === "not_initialized" && a.present === false) {
      diagnosis = "PLAYBACK_NOT_STARTED";
      evidence.push("audio element not initialized");
    } else if (a.paused === false && c.lifecycle === "suspended") {
      diagnosis = "AUDIO_CONTEXT_SUSPENDED";
      evidence.push(`audio.play() resolved (currentTime=${a.currentTime ?? "?"})`);
      evidence.push("playing event observed");
      evidence.push(`AudioContext state = ${c.lifecycle}`);
      evidence.push(`resume() requested=${c.resumeRequested} resolved=${c.resumeResolved}`);
    } else if (c.lifecycle === "absent" || c.lifecycle === "closed") {
      diagnosis = "AUDIO_CONTEXT_UNAVAILABLE";
      evidence.push(`AudioContext lifecycle = ${c.lifecycle}`);
    } else if (m.lifecycle === "failed" || m.invalidStateError) {
      diagnosis = "MEDIA_SOURCE_FAILED";
      evidence.push(`MediaElementAudioSourceNode lifecycle = ${m.lifecycle}`);
      if (m.invalidStateError) evidence.push("InvalidStateError observed");
    } else if (an.lifecycle === "failed" || an.lifecycle === "absent") {
      diagnosis = "ANALYSER_UNAVAILABLE";
      evidence.push(`AnalyserNode lifecycle = ${an.lifecycle}`);
    } else if (s.health.dspLoop === "not_running" && a.paused === false) {
      diagnosis = "DSP_LOOP_NOT_RUNNING";
      evidence.push("audio playing but DSP loop never started");
      evidence.push(`loop tickCount=${d.tickCount}`);
    } else if (s.health.dspLoop === "stalled" && a.paused === false) {
      diagnosis = "DSP_LOOP_NOT_RUNNING";
      evidence.push("DSP loop stalled (no recent ticks)");
    } else if (dspSignalHealth === "zero") {
      diagnosis = "DSP_ZERO_SIGNAL";
      evidence.push("audio.play() resolved");
      evidence.push("playing event observed");
      evidence.push(`AudioContext state = running`);
      evidence.push("MediaElementAudioSourceNode connected");
      evidence.push("analyser active");
      evidence.push(
        `${d.consecutiveZeroFrames} consecutive frames near zero (threshold ${ZERO_SIGNAL_RMS_THRESHOLD})`,
      );
      if (a.currentTime != null) {
        evidence.push(`audio.currentTime advancing (${a.currentTime.toFixed(2)}s)`);
      }
      if (s.env.isIOS || s.env.isSafari) {
        evidence.push("iOS / Safari runtime");
      }
      if (a.crossOrigin === "anonymous") {
        evidence.push(`audio.crossOrigin=${a.crossOrigin}`);
      }
      // CORS suspicion is a soft signal — never auto-confirm.
      if (a.sourceClass === "direct" && a.crossOrigin === "anonymous") {
        evidence.push("CORS suspected (direct cross-origin media + crossOrigin=anonymous)");
      }
    } else if (
      s.health.dspLoop === "active" &&
      dspSignalHealth === "active" &&
      p.signalsOut === 0
    ) {
      diagnosis = "PERCEPTION_ORCHESTRATOR_INACTIVE";
      evidence.push("DSP running and signal non-zero");
      evidence.push(`but signals emitted by orchestrator = 0`);
    } else if (p.signalsIn === 0 && p.signalsOut === 0) {
      diagnosis = "NO_SIGNALS_YET";
      evidence.push("orchestrator has not yet observed any DSP frames");
    } else if (s.health.dspLoop === "active" && dspSignalHealth === "active") {
      diagnosis = "PIPELINE_ACTIVE";
      evidence.push(`DSP loop ${d.actualHz.toFixed(1)} Hz`);
      evidence.push(`perception signals emitted: ${p.signalsOut}`);
    }

    // Page lifecycle interrupt: if visibility became hidden and DSP stopped.
    if (s.visibility.state === "hidden" && d.lifecycle !== "running") {
      if (diagnosis === "PIPELINE_ACTIVE" || diagnosis === "UNKNOWN") {
        diagnosis = "DSP_INTERRUPTED_BY_LIFECYCLE";
        evidence.push("document.visibilityState=hidden");
        evidence.push("DSP loop stopped while page backgrounded");
      } else {
        evidence.push("note: page is currently hidden");
      }
    }

    s.diagnosis = diagnosis;
    s.diagnosisEvidence = evidence;
    s.zeroSignalThreshold = ZERO_SIGNAL_RMS_THRESHOLD;
  }

  private sanitize(text: string): string {
    // Keep observability honest: strip anything that looks like a credential.

    const clean = String(text || "")
      .replace(/(?:sk-or-v1-)[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
      .replace(/(?:sk-)[A-Za-z0-9]{16,}/g, "[REDACTED]")
      .replace(/AIza[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
      .replace(/(?:eyJ)[A-Za-z0-9_\-.]{20,}/g, "[REDACTED]");
    return clean.length > 240 ? `${clean.slice(0, 240)}…` : clean;
  }

  private prune(): void {
    if (this.requests.length > MAX_REQUESTS) {
      this.requests.splice(0, this.requests.length - MAX_REQUESTS);
      this.requests.forEach((r) => r.endedAt ?? (r.endedAt = now()));
    }
    // Keep a small tail of recent calls even when not referenced by a
    // retained request, then bounded global caps.
    if (this.calls.size > MAX_CALLS) {
      this.calls = new Map([...this.calls.entries()].slice(-MAX_CALLS));
    }
    if (this.memoryOps.size > MAX_MEMORY_OPS) {
      this.memoryOps = new Map([...this.memoryOps.entries()].slice(-MAX_MEMORY_OPS));
    }
    if (this.operations.size > MAX_OPERATIONS) {
      this.operations = new Map([...this.operations.entries()].slice(-MAX_OPERATIONS));
    }
    // Keep IDs referenced by retained requests resolved if still present.
    const keptRequestIds = new Set(this.requests.map((r) => r.requestId));
    for (const r of this.requests) {
      r.providerCalls = r.providerCalls.filter((c) => this.calls.has(c));
      r.memoryOps = r.memoryOps.filter((m) => this.memoryOps.has(m));
      r.operations = r.operations.filter((o) => this.operations.has(o));
    }
    void keptRequestIds;
  }
}

function clamp0(n: number | undefined | null): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

// ── Mobile music pipeline default state + clone helpers ──────────────

function safeBrowserClass(): {
  browserClass: MobileMusicPipelineState["env"]["browserClass"];
  isMobile: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isSafari: boolean;
} {
  if (typeof navigator === "undefined") {
    return {
      browserClass: "Unknown",
      isMobile: false,
      isIOS: false,
      isAndroid: false,
      isSafari: false,
    };
  }
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const vendor = navigator.vendor || "";
  // iOS detection (iPad iPhone iPod) — including iPadOS 13+ that masquerades as Mac.
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (platform === "MacIntel" &&
      (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints! > 1);
  const isAndroid = /Android/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
  // Mobile covers phones + small tablets + iPad.
  const isMobile = isIOS || isAndroid || /Mobi|Tablet/.test(ua);

  let browserClass: MobileMusicPipelineState["env"]["browserClass"] = "Unknown";
  if (isIOS && /CriOS/.test(ua)) browserClass = "iOS Chrome";
  else if (isIOS && /FxiOS/.test(ua))
    browserClass = "iOS Chrome"; // collapse variant
  else if (isIOS && /EdgiOS/.test(ua)) browserClass = "iOS Chrome";
  else if (isIOS) browserClass = "iOS Safari";
  else if (isAndroid && /Firefox/.test(ua)) browserClass = "Android Firefox";
  else if (isAndroid && /Chrome/.test(ua)) browserClass = "Android Chrome";
  else if (/Firefox/.test(ua)) browserClass = "Desktop Firefox";
  else if (/Chrome/.test(ua)) browserClass = "Desktop Chrome";
  else if (isSafari) browserClass = "Desktop Safari";
  else browserClass = "Unknown";

  return { browserClass, isMobile, isIOS, isAndroid, isSafari };
}

function createDefaultMobileMusicPipeline(): MobileMusicPipelineState {
  const cls = safeBrowserClass();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const platform = typeof navigator !== "undefined" ? navigator.platform : "";
  const vendor = typeof navigator !== "undefined" ? navigator.vendor : "";
  const viewport =
    typeof window !== "undefined" ? { w: window.innerWidth, h: window.innerHeight } : null;
  const w = typeof window !== "undefined" ? window : null;
  return {
    env: {
      browserClass: cls.browserClass,
      isMobile: cls.isMobile,
      isIOS: cls.isIOS,
      isAndroid: cls.isAndroid,
      isSafari: cls.isSafari,
      userAgent: ua.slice(0, 240),
      platform,
      vendor,
      viewport,
      webAudio: {
        audioContext: !!(
          w &&
          (window.AudioContext ||
            (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)
        ),
        offlineAudioContext: !!(
          w &&
          (window.OfflineAudioContext ||
            (window as unknown as { webkitOfflineAudioContext?: unknown })
              .webkitOfflineAudioContext)
        ),
        mediaElementAudioSourceNode: !!(
          w &&
          w.HTMLMediaElement &&
          "srcObject" in HTMLMediaElement.prototype
        ),
        analyserNode: !!(w && w.AnalyserNode),
      },
    },
    audioElement: {
      present: false,
      paused: null,
      readyState: null,
      networkState: null,
      currentTime: null,
      duration: null,
      crossOrigin: null,
      sourceClass: "unknown",
    },
    audioContext: {
      lifecycle: "absent",
      sampleRate: null,
      baseLatency: null,
      outputLatency: null,
      lastResumeReason: "none",
      resumeRequested: 0,
      resumeResolved: 0,
      resumeRejected: 0,
    },
    mediaElementSource: {
      lifecycle: "absent",
      invalidStateError: false,
      boundElementId: null,
    },
    analyser: {
      lifecycle: "absent",
      fftSize: null,
      frequencyBinCount: null,
    },
    dspLoop: {
      lifecycle: "stopped",
      targetHz: 10,
      actualHz: 0,
      tickCount: 0,
      lastTickAt: null,
      ticksLast1s: 0,
      lastFrame: null,
      consecutiveZeroFrames: 0,
    },
    perception: {
      lifecycle: "inactive",
      signalsIn: 0,
      signalsOut: 0,
      lastSignalAt: null,
      lastSignalType: null,
      lastContextRebuildAt: null,
    },
    evidence: {
      signalsReceived: 0,
      evidenceGenerated: 0,
      momentsGenerated: 0,
      lastMomentAt: null,
      lastSourceCategories: [],
    },
    gesture: {
      lastGestureAt: null,
      playResolvedAfterGesture: null,
      audioContextResumedAfterPlay: null,
    },
    visibility: {
      state:
        typeof document !== "undefined"
          ? document.visibilityState === "hidden"
            ? "hidden"
            : document.visibilityState === "visible"
              ? "visible"
              : "unknown"
          : "unknown",
      hidden: typeof document !== "undefined" ? document.hidden : null,
    },
    timeline: [],
    health: {
      playback: "not_initialized",
      audioContext: "not_initialized",
      mediaSource: "not_initialized",
      analyser: "not_initialized",
      dspLoop: "not_running",
      dspSignal: "not_initialized",
      perception: "inactive",
      evidenceFusion: "not_initialized",
    },
    diagnosis: "UNKNOWN",
    diagnosisEvidence: [],
    zeroSignalThreshold: ZERO_SIGNAL_RMS_THRESHOLD,
  };
}

function cloneMobileMusicPipeline(s: MobileMusicPipelineState): MobileMusicPipelineState {
  return {
    env: {
      ...s.env,
      webAudio: { ...s.env.webAudio },
      viewport: s.env.viewport ? { ...s.env.viewport } : null,
    },
    audioElement: { ...s.audioElement },
    audioContext: { ...s.audioContext },
    mediaElementSource: { ...s.mediaElementSource },
    analyser: { ...s.analyser },
    dspLoop: {
      ...s.dspLoop,
      lastFrame: s.dspLoop.lastFrame ? { ...s.dspLoop.lastFrame } : null,
    },
    perception: { ...s.perception },
    evidence: { ...s.evidence, lastSourceCategories: [...s.evidence.lastSourceCategories] },
    gesture: { ...s.gesture },
    visibility: { ...s.visibility },
    timeline: s.timeline.map((t) => ({ ...t })),
    health: { ...s.health },
    diagnosis: s.diagnosis,
    diagnosisEvidence: [...s.diagnosisEvidence],
    zeroSignalThreshold: s.zeroSignalThreshold,
  };
}

/** Singleton for the whole app. */
export const auraTelemetry = new RuntimeTelemetry();

// Dev-only global for quick inspection in the console.
if (typeof window !== "undefined") {
  try {
    (window as unknown as Record<string, unknown>).auraTelemetry = auraTelemetry;
  } catch {
    /* non-critical */
  }
}
