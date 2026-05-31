/**
 * AURA Runtime Trace Engine — Flight recorder for the voice pipeline.
 *
 * This module provides:
 *   1. A global event bus (window.auraVoiceTrace) for recording pipeline events.
 *   2. Passive monitors that detect AudioContext, network, and visibility changes.
 *   3. A failure fingerprinting engine that classifies root causes.
 *   4. A latency breakdown calculator.
 *
 * CRITICAL: This module does NOT modify, replace, or interfere with any
 * existing voice, STT, TTS, WebSocket, LLM, memory, or conversation logic.
 * It is a read-only flight recorder.
 *
 * @module
 */

// ─── Types ──────────────────────────────────────────────────────────

export type TraceStage =
  | "MIC_BUTTON_CLICK"
  | "MIC_PERMISSION_CHECK"
  | "MIC_STREAM_ACQUIRED"
  | "STT_INITIALIZING"
  | "STT_STARTED"
  | "STT_PARTIAL_RESULT"
  | "STT_FINAL_RESULT"
  | "STT_ENDED"
  | "STT_ERROR"
  | "VAD_STARTED"
  | "VAD_SPEECH_DETECTED"
  | "VAD_TIMEOUT"
  | "VAD_STOPPED"
  | "WS_CONNECTING"
  | "WS_CONNECTED"
  | "WS_DISCONNECTED"
  | "WS_RECONNECTING"
  | "WS_ERROR"
  | "LLM_REQUEST_START"
  | "LLM_REQUEST_SUCCESS"
  | "LLM_REQUEST_ERROR"
  | "TTS_REQUEST_START"
  | "TTS_REQUEST_SUCCESS"
  | "TTS_REQUEST_ERROR"
  | "AUDIO_PLAYBACK_START"
  | "AUDIO_PLAYBACK_END"
  | "AUDIO_PLAYBACK_ERROR"
  | "INTERRUPTION_DETECTED"
  | "INTERRUPTION_HANDLED"
  | "SESSION_RECOVERED"
  | "SESSION_FAILED"
  // Passive monitor events
  | "VISIBILITY_HIDDEN"
  | "VISIBILITY_VISIBLE"
  | "NETWORK_OFFLINE"
  | "NETWORK_ONLINE"
  | "AUDIOCONTEXT_SUSPENDED"
  | "AUDIOCONTEXT_RUNNING"
  | "AUDIOCONTEXT_CLOSED"
  | "SCREEN_LOCKED"
  | "SCREEN_UNLOCKED";

export type TraceStatus = "ok" | "error" | "warning" | "info";

export interface TraceEvent {
  id: number;
  timestamp: number;
  stage: TraceStage;
  status: TraceStatus;
  durationMs: number | null;
  details: string;
  error: string | null;
}

export type PipelineHealth = "RUNNING" | "IDLE" | "FAILED" | "RECOVERING";

export interface PipelineStatus {
  mic: PipelineHealth;
  stt: PipelineHealth;
  vad: PipelineHealth;
  ws: PipelineHealth;
  llm: PipelineHealth;
  tts: PipelineHealth;
  playback: PipelineHealth;
}

export interface FailureFingerprint {
  rootCause: string;
  confidence: number;
  stage: TraceStage;
  timestamp: number;
  suggestion: string;
}

export interface LatencyBreakdown {
  micToStt: number | null;
  sttToTranscript: number | null;
  transcriptToLlm: number | null;
  llmToTts: number | null;
  ttsToPlayback: number | null;
  totalLatency: number | null;
}

export type TraceListener = (event: TraceEvent) => void;

// ─── Constants ──────────────────────────────────────────────────────

const MAX_EVENTS = 500;

// ─── Trace Engine Class ─────────────────────────────────────────────

class RuntimeTraceEngine {
  private events: TraceEvent[] = [];
  private idCounter = 0;
  private listeners: Set<TraceListener> = new Set();
  private passiveCleanups: (() => void)[] = [];
  private healthState: PipelineStatus = {
    mic: "IDLE",
    stt: "IDLE",
    vad: "IDLE",
    ws: "IDLE",
    llm: "IDLE",
    tts: "IDLE",
    playback: "IDLE",
  };

  // ─── Event Emission ───────────────────────────────────────────────

  emit(
    stage: TraceStage,
    status: TraceStatus = "info",
    details: string = "",
    error: string | null = null,
    durationMs: number | null = null,
  ): TraceEvent {
    const event: TraceEvent = {
      id: ++this.idCounter,
      timestamp: Date.now(),
      stage,
      status,
      durationMs,
      details,
      error,
    };

    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }

    // Update health state based on event
    this.updateHealth(event);

    // Notify listeners
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* diagnostics must never crash */ }
    }

    return event;
  }

  // ─── Health State Tracking ────────────────────────────────────────

  private updateHealth(event: TraceEvent): void {
    const { stage, status } = event;

    // MIC
    if (stage === "MIC_STREAM_ACQUIRED" && status === "ok") this.healthState.mic = "RUNNING";
    else if (stage === "MIC_PERMISSION_CHECK" && status === "error") this.healthState.mic = "FAILED";

    // STT
    if (stage === "STT_STARTED") this.healthState.stt = "RUNNING";
    else if (stage === "STT_ENDED") this.healthState.stt = "IDLE";
    else if (stage === "STT_ERROR") this.healthState.stt = "FAILED";

    // VAD
    if (stage === "VAD_STARTED" || stage === "VAD_SPEECH_DETECTED") this.healthState.vad = "RUNNING";
    else if (stage === "VAD_STOPPED" || stage === "VAD_TIMEOUT") this.healthState.vad = "IDLE";

    // WS
    if (stage === "WS_CONNECTED") this.healthState.ws = "RUNNING";
    else if (stage === "WS_DISCONNECTED") this.healthState.ws = "IDLE";
    else if (stage === "WS_ERROR") this.healthState.ws = "FAILED";
    else if (stage === "WS_RECONNECTING") this.healthState.ws = "RECOVERING";

    // LLM
    if (stage === "LLM_REQUEST_START") this.healthState.llm = "RUNNING";
    else if (stage === "LLM_REQUEST_SUCCESS") this.healthState.llm = "IDLE";
    else if (stage === "LLM_REQUEST_ERROR") this.healthState.llm = "FAILED";

    // TTS
    if (stage === "TTS_REQUEST_START") this.healthState.tts = "RUNNING";
    else if (stage === "TTS_REQUEST_SUCCESS") this.healthState.tts = "IDLE";
    else if (stage === "TTS_REQUEST_ERROR") this.healthState.tts = "FAILED";

    // PLAYBACK
    if (stage === "AUDIO_PLAYBACK_START") this.healthState.playback = "RUNNING";
    else if (stage === "AUDIO_PLAYBACK_END") this.healthState.playback = "IDLE";
    else if (stage === "AUDIO_PLAYBACK_ERROR") this.healthState.playback = "FAILED";

    // Session recovery
    if (stage === "SESSION_RECOVERED") {
      if (this.healthState.ws === "FAILED") this.healthState.ws = "RECOVERING";
      if (this.healthState.stt === "FAILED") this.healthState.stt = "RECOVERING";
    }
  }

  // ─── Queries ──────────────────────────────────────────────────────

  getEvents(): TraceEvent[] {
    return [...this.events];
  }

  getHealth(): PipelineStatus {
    return { ...this.healthState };
  }

  getLastEvent(stage: TraceStage): TraceEvent | null {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].stage === stage) return this.events[i];
    }
    return null;
  }

  getEventCount(): number {
    return this.events.length;
  }

  clear(): void {
    this.events = [];
    this.healthState = {
      mic: "IDLE", stt: "IDLE", vad: "IDLE",
      ws: "IDLE", llm: "IDLE", tts: "IDLE", playback: "IDLE",
    };
  }

  // ─── Subscriptions ────────────────────────────────────────────────

  subscribe(listener: TraceListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // ─── Latency Breakdown ───────────────────────────────────────────

  computeLatency(): LatencyBreakdown {
    const result: LatencyBreakdown = {
      micToStt: null,
      sttToTranscript: null,
      transcriptToLlm: null,
      llmToTts: null,
      ttsToPlayback: null,
      totalLatency: null,
    };

    const mic = this.getLastEvent("MIC_STREAM_ACQUIRED");
    const sttStart = this.getLastEvent("STT_STARTED");
    const sttFinal = this.getLastEvent("STT_FINAL_RESULT");
    const llmStart = this.getLastEvent("LLM_REQUEST_START");
    const llmDone = this.getLastEvent("LLM_REQUEST_SUCCESS");
    const ttsStart = this.getLastEvent("TTS_REQUEST_START");
    const ttsDone = this.getLastEvent("TTS_REQUEST_SUCCESS");
    const playStart = this.getLastEvent("AUDIO_PLAYBACK_START");

    if (mic && sttStart && sttStart.timestamp > mic.timestamp) {
      result.micToStt = sttStart.timestamp - mic.timestamp;
    }
    if (sttStart && sttFinal && sttFinal.timestamp > sttStart.timestamp) {
      result.sttToTranscript = sttFinal.timestamp - sttStart.timestamp;
    }
    if (sttFinal && llmStart && llmStart.timestamp > sttFinal.timestamp) {
      result.transcriptToLlm = llmStart.timestamp - sttFinal.timestamp;
    }
    if (llmDone && ttsStart && ttsStart.timestamp > llmDone.timestamp) {
      result.llmToTts = ttsStart.timestamp - llmDone.timestamp;
    }
    if (ttsDone && playStart && playStart.timestamp > ttsDone.timestamp) {
      result.ttsToPlayback = playStart.timestamp - ttsDone.timestamp;
    }

    // Total: mic → playback
    if (mic && playStart && playStart.timestamp > mic.timestamp) {
      result.totalLatency = playStart.timestamp - mic.timestamp;
    }

    return result;
  }

  // ─── Failure Fingerprinting ───────────────────────────────────────

  getFingerprints(): FailureFingerprint[] {
    const fingerprints: FailureFingerprint[] = [];
    const errors = this.events.filter((e) => e.status === "error");

    for (const event of errors) {
      const fp = this.classifyFailure(event);
      if (fp) fingerprints.push(fp);
    }

    return fingerprints;
  }

  private classifyFailure(event: TraceEvent): FailureFingerprint | null {
    const { stage, error, details } = event;
    const errLower = (error || "").toLowerCase();
    const detailsLower = (details || "").toLowerCase();

    // Permission denied
    if (stage === "MIC_PERMISSION_CHECK" || (errLower.includes("notallowed") || errLower.includes("permission"))) {
      return {
        rootCause: "Microphone Permission Denied",
        confidence: 100,
        stage,
        timestamp: event.timestamp,
        suggestion: "Grant microphone permission in browser settings",
      };
    }

    // No mic hardware
    if (errLower.includes("notfound") || errLower.includes("no microphone")) {
      return {
        rootCause: "No Microphone Hardware",
        confidence: 98,
        stage,
        timestamp: event.timestamp,
        suggestion: "Connect a microphone or check device settings",
      };
    }

    // STT failures
    if (stage === "STT_ERROR") {
      if (errLower.includes("network") || errLower.includes("no-speech")) {
        return {
          rootCause: "Speech Recognition Network Error",
          confidence: 92,
          stage,
          timestamp: event.timestamp,
          suggestion: "Check internet connection; STT requires online access on most browsers",
        };
      }
      if (errLower.includes("aborted") || errLower.includes("not-allowed")) {
        return {
          rootCause: "Speech Recognition Aborted",
          confidence: 90,
          stage,
          timestamp: event.timestamp,
          suggestion: "Another app may be using the microphone, or the page lost focus",
        };
      }
      return {
        rootCause: "Speech Recognition Failure",
        confidence: 96,
        stage,
        timestamp: event.timestamp,
        suggestion: "Restart the session; if persistent, try a different browser",
      };
    }

    // AudioContext suspended (mobile)
    if (stage === "AUDIOCONTEXT_SUSPENDED" || detailsLower.includes("suspended")) {
      return {
        rootCause: "AudioContext Suspended",
        confidence: 94,
        stage,
        timestamp: event.timestamp,
        suggestion: "Tap the screen to resume audio (mobile browsers require user gesture)",
      };
    }

    // WebSocket failures
    if (stage === "WS_ERROR" || stage === "WS_DISCONNECTED") {
      return {
        rootCause: "WebSocket Disconnect",
        confidence: 97,
        stage,
        timestamp: event.timestamp,
        suggestion: "Check network connectivity; the backend may be unreachable",
      };
    }

    // LLM failures
    if (stage === "LLM_REQUEST_ERROR") {
      if (errLower.includes("timeout") || errLower.includes("abort")) {
        return {
          rootCause: "LLM Request Timeout",
          confidence: 91,
          stage,
          timestamp: event.timestamp,
          suggestion: "The AI backend is slow or unreachable",
        };
      }
      return {
        rootCause: "LLM Request Failed",
        confidence: 88,
        stage,
        timestamp: event.timestamp,
        suggestion: "Check API keys and backend availability",
      };
    }

    // TTS failures
    if (stage === "TTS_REQUEST_ERROR") {
      return {
        rootCause: "TTS Synthesis Failed",
        confidence: 90,
        stage,
        timestamp: event.timestamp,
        suggestion: "Check Sarvam API key or browser speech synthesis support",
      };
    }

    // Playback failures
    if (stage === "AUDIO_PLAYBACK_ERROR") {
      return {
        rootCause: "Audio Playback Failed",
        confidence: 93,
        stage,
        timestamp: event.timestamp,
        suggestion: "The device may have audio output issues or be in silent mode",
      };
    }

    // Network loss
    if (stage === "NETWORK_OFFLINE") {
      return {
        rootCause: "Network Connection Lost",
        confidence: 100,
        stage,
        timestamp: event.timestamp,
        suggestion: "Reconnect to the internet",
      };
    }

    // Session failures
    if (stage === "SESSION_FAILED") {
      return {
        rootCause: "Session Recovery Failed",
        confidence: 85,
        stage,
        timestamp: event.timestamp,
        suggestion: "Refresh the page to start a new session",
      };
    }

    return null;
  }

  // ─── Passive Monitors ────────────────────────────────────────────

  startPassiveMonitors(): void {
    this.stopPassiveMonitors();

    // 1. Visibility change (background/foreground)
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        this.emit("VISIBILITY_HIDDEN", "warning", "App moved to background");
      } else {
        this.emit("VISIBILITY_VISIBLE", "info", "App returned to foreground");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    this.passiveCleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));

    // 2. Online/offline
    const onOnline = () => this.emit("NETWORK_ONLINE", "ok", "Network restored");
    const onOffline = () => this.emit("NETWORK_OFFLINE", "error", "Network lost");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    this.passiveCleanups.push(() => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    });

    // 3. Screen lock detection via Screen Wake Lock API state
    if ("wakeLock" in navigator) {
      const onWakeLockRelease = () => {
        this.emit("SCREEN_LOCKED", "warning", "Wake lock released (screen may have locked)");
      };
      // We observe the release event if a wake lock is active
      // This is non-invasive — we just listen, don't acquire
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          this.emit("SCREEN_LOCKED", "warning", "Possible screen lock (visibility hidden)");
        } else {
          this.emit("SCREEN_UNLOCKED", "info", "Screen unlocked (visibility restored)");
        }
      });
    }

    // 4. AudioContext state polling (non-invasive, 2s interval)
    let lastAudioState = "";
    const audioPoller = setInterval(() => {
      try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        // Check if any AudioContext exists (we read-only inspect, never create)
        // We rely on the global diagnostics snapshot if available
        const diag = (window as any).auraDiagnostics;
        if (diag?.audio?.state && diag.audio.state !== lastAudioState) {
          lastAudioState = diag.audio.state;
          if (diag.audio.state === "suspended") {
            this.emit("AUDIOCONTEXT_SUSPENDED", "warning", "AudioContext suspended");
          } else if (diag.audio.state === "running") {
            this.emit("AUDIOCONTEXT_RUNNING", "ok", "AudioContext running");
          } else if (diag.audio.state === "closed") {
            this.emit("AUDIOCONTEXT_CLOSED", "warning", "AudioContext closed");
          }
        }
      } catch { /* safe */ }
    }, 2000);
    this.passiveCleanups.push(() => clearInterval(audioPoller));
  }

  stopPassiveMonitors(): void {
    for (const cleanup of this.passiveCleanups) {
      try { cleanup(); } catch { /* safe */ }
    }
    this.passiveCleanups = [];
  }

  // ─── Export ───────────────────────────────────────────────────────

  getSnapshot() {
    return {
      timestamp: Date.now(),
      eventCount: this.events.length,
      events: this.getEvents(),
      health: this.getHealth(),
      latency: this.computeLatency(),
      fingerprints: this.getFingerprints(),
    };
  }

  downloadReport(): void {
    const device = (window as any).auraDiagnostics || {};
    const report = {
      version: "2.0.0",
      exportedAt: new Date().toISOString(),
      device,
      runtime: this.getSnapshot(),
    };
    const json = JSON.stringify(report, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aura-runtime-report-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// ─── Singleton & Global Exposure ────────────────────────────────────

export const runtimeTrace = new RuntimeTraceEngine();

// Expose globally for console access
if (typeof window !== "undefined") {
  (window as any).auraVoiceTrace = runtimeTrace;
}
