/**
 * ResilienceOrchestrator — Central coordination for all resilience subsystems.
 *
 * Responsibilities:
 *   - Aggregate health signals from Phase 1 watchdogs
 *   - Drive Phase 2 experience health computation
 *   - Coordinate Phase 3 recovery actions
 *   - Prevent recovery loops via cooldowns
 *   - Manage adaptation mode transitions
 *   - Expose unified global resilience state
 *
 * All recovery actions route through this orchestrator.
 * No scattered recovery logic elsewhere.
 *
 * @module resilience/orchestrator
 */

import type {
  OrchestratorState,
  ExperienceMode,
  AdaptationPolicy,
  RecoveryAction,
  RecoveryAttempt,
  ResilienceEvent,
  ResilienceEventListener,
  ResilienceState,
} from "../types";

import { STTWatchdog } from "../phase1/STTWatchdog";
import { AudioWatchdog } from "../phase1/AudioWatchdog";
import { NetworkMonitor } from "../phase1/NetworkMonitor";
import { DeviceProfiler } from "../phase2/DeviceProfiler";
import { ExperienceHealthEngine } from "../phase2/ExperienceHealthEngine";
import { ProviderMesh } from "../phase3/ProviderMesh";
import { ConversationPreservation } from "../phase3/ConversationPreservation";
import { PredictiveFailureEngine } from "../phase3/PredictiveFailureEngine";
import { QueueProtection } from "../phase3/QueueProtection";
import { SilenceProtection } from "../phase3/SilenceProtection";

// ─── Constants ──────────────────────────────────────────────────────
const ORCHESTRATOR_TICK_MS = 500;
const RECOVERY_COOLDOWN_MS = 5000;
const MAX_RECENT_RECOVERIES = 20;
const RECOVERY_LOOP_THRESHOLD = 5; // Max recoveries of same type in 30s
const RECOVERY_LOOP_WINDOW_MS = 30_000;

export class ResilienceOrchestrator {
  // ── Phase 1: Watchdogs ──
  readonly sttWatchdog: STTWatchdog;
  readonly audioWatchdog: AudioWatchdog;
  readonly networkMonitor: NetworkMonitor;

  // ── Phase 2: Health Engine ──
  readonly deviceProfiler: DeviceProfiler;
  readonly experienceEngine: ExperienceHealthEngine;

  // ── Phase 3: Self-Healing ──
  readonly providerMesh: ProviderMesh;
  readonly conversationPreservation: ConversationPreservation;
  readonly predictiveFailure: PredictiveFailureEngine;
  readonly queueProtection: QueueProtection;
  readonly silenceProtection: SilenceProtection;

  // ── Internal state ──
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private recentRecoveries: RecoveryAttempt[] = [];
  private cooldowns: Map<string, number> = new Map();
  private isRecovering = false;
  private listeners: ResilienceEventListener[] = [];
  private _isStarted = false;

  constructor(sessionId: string) {
    // Instantiate all subsystems
    this.sttWatchdog = new STTWatchdog();
    this.audioWatchdog = new AudioWatchdog();
    this.networkMonitor = new NetworkMonitor();
    this.deviceProfiler = new DeviceProfiler();
    this.experienceEngine = new ExperienceHealthEngine();
    this.providerMesh = new ProviderMesh();
    this.conversationPreservation = new ConversationPreservation(sessionId);
    this.predictiveFailure = new PredictiveFailureEngine();
    this.queueProtection = new QueueProtection();
    this.silenceProtection = new SilenceProtection();

    // Wire event sinks
    const sink = (e: ResilienceEvent) => this.handleEvent(e);
    this.experienceEngine.setEventSink(sink);
    this.providerMesh.setEventSink(sink);
  }

  // ═══════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Start all watchdogs and the orchestration loop.
   * Call this once when the voice session begins.
   */
  start(): void {
    if (this._isStarted) return;
    this._isStarted = true;

    const sink = (e: ResilienceEvent) => this.handleEvent(e);

    // Phase 1
    this.sttWatchdog.start(
      (level) => this.handleSTTRecovery(level),
      sink
    );
    this.audioWatchdog.start(
      {
        onResumeContext: async () => {
          // Consumers must wire this — return true if resume succeeded
          console.warn("[Orchestrator] AudioContext resume requested");
          return false;
        },
        onRebuildPlayback: () => {
          console.warn("[Orchestrator] Playback rebuild requested");
        },
        onRequestNextChunk: () => {
          console.warn("[Orchestrator] Next chunk requested");
        },
      },
      sink
    );
    this.networkMonitor.start(sink);

    // Phase 2
    this.deviceProfiler.start();

    // Phase 3
    this.conversationPreservation.start(sink);

    // Orchestration tick
    this.tickHandle = setInterval(() => this.tick(), ORCHESTRATOR_TICK_MS);

    console.log("[ResilienceOrchestrator] Started. Device score:", this.deviceProfiler.getScore());
  }

  /**
   * Stop all subsystems and the orchestration loop.
   */
  stop(): void {
    if (!this._isStarted) return;
    this._isStarted = false;

    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }

    this.sttWatchdog.stop();
    this.audioWatchdog.stop();
    this.networkMonitor.stop();
    this.deviceProfiler.stop();
    this.silenceProtection.stop();
    this.conversationPreservation.stop();
  }

  destroy(): void {
    this.stop();
    this.sttWatchdog.destroy();
    this.audioWatchdog.destroy();
    this.networkMonitor.destroy();
    this.deviceProfiler.destroy();
    this.silenceProtection.destroy();
    this.conversationPreservation.destroy();
    this.listeners = [];
  }

  // ═══════════════════════════════════════════════════════════════
  // CONSUMER API
  // ═══════════════════════════════════════════════════════════════

  /** Get the current experience mode */
  getMode(): ExperienceMode {
    return this.experienceEngine.getMode();
  }

  /** Get the current adaptation policy for LLM/TTS consumers */
  getPolicy(): AdaptationPolicy {
    return this.experienceEngine.getPolicy();
  }

  /** Get full orchestrator state snapshot */
  getState(): OrchestratorState {
    const sttHealth = this.sttWatchdog.getState();
    const audioHealth = this.audioWatchdog.getState();
    const networkHealth = this.networkMonitor.getState();

    return {
      mode: this.experienceEngine.getMode(),
      experienceHealth: this.experienceEngine.getSnapshot(),
      resilience: {
        sttHealth,
        audioHealth,
        networkHealth,
        timestamp: performance.now(),
      },
      providerMesh: this.providerMesh.getState(),
      adaptationPolicy: this.experienceEngine.getPolicy(),
      recentRecoveries: [...this.recentRecoveries],
      cooldowns: Object.fromEntries(this.cooldowns),
      isRecovering: this.isRecovering,
    };
  }

  /** Get the resilience state for watchdog consumers */
  getResilienceState(): ResilienceState {
    return {
      sttHealth: this.sttWatchdog.getState(),
      audioHealth: this.audioWatchdog.getState(),
      networkHealth: this.networkMonitor.getState(),
      timestamp: performance.now(),
    };
  }

  /** Subscribe to resilience events */
  addEventListener(listener: ResilienceEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Wire audio watchdog callbacks to actual AudioContext operations.
   * Call this after the AudioContext is created.
   */
  wireAudioCallbacks(callbacks: {
    onResumeContext: () => Promise<boolean>;
    onRebuildPlayback: () => void;
    onRequestNextChunk: () => void;
  }): void {
    // Re-start with real callbacks (safe to call start multiple times)
    this.audioWatchdog.stop();
    this.audioWatchdog.start(callbacks, (e) => this.handleEvent(e));
  }

  /**
   * Wire silence protection callbacks.
   * Call this after TTS and STT are initialized.
   */
  wireSilenceProtection(callbacks: {
    getStatus: () => "idle" | "listening" | "thinking" | "speaking" | "error";
    getLastActivityTs: () => number;
    getLastTokenTs: () => number;
    speakFiller: (text: string) => void;
    isAudioContextAlive: () => boolean;
    triggerSTTRecovery: () => void;
    triggerAudioRecovery: () => void;
  }): void {
    this.silenceProtection.stop();
    this.silenceProtection.start(callbacks, (e) => this.handleEvent(e));
  }

  // ═══════════════════════════════════════════════════════════════
  // ORCHESTRATION TICK
  // ═══════════════════════════════════════════════════════════════

  private tick(): void {
    // 1. Read component health scores
    const deviceScore = this.deviceProfiler.getScore();
    const networkScore = this.networkMonitor.getState().health;
    const sttScore = this.sttWatchdog.getState().health;
    const audioScore = this.audioWatchdog.getState().health;

    // 2. Update experience health
    this.experienceEngine.update(deviceScore, networkScore, sttScore, audioScore);

    // 3. Predictive failure checks
    const predictions = this.predictiveFailure.getPredictions();
    if (predictions.length > 0 && !this.isRecovering) {
      // Preemptive actions based on predictions
      for (const prediction of predictions) {
        if (prediction === "audio_suspend" && audioScore > 50) {
          // Preemptively warm the audio context
          console.log("[Orchestrator] Predictive: prewarming audio context");
        }
        if (prediction === "stt_crash" && sttScore > 50) {
          console.log("[Orchestrator] Predictive: STT crash likely, monitoring closely");
        }
      }
    }

    // 4. Prune old cooldowns
    const now = performance.now();
    for (const [key, ts] of this.cooldowns.entries()) {
      if (now - ts > RECOVERY_COOLDOWN_MS * 2) {
        this.cooldowns.delete(key);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RECOVERY COORDINATION
  // ═══════════════════════════════════════════════════════════════

  private handleSTTRecovery(level: 0 | 1 | 2 | 3): void {
    const action: RecoveryAction = { type: "stt_restart", level };

    if (!this.canExecuteRecovery(action)) {
      console.warn("[Orchestrator] STT recovery throttled (cooldown/loop protection)");
      return;
    }

    this.executeRecovery(action);
    this.predictiveFailure.recordFailure("stt_crash");

    if (level >= 2) {
      // Provider switch
      this.providerMesh.reportFailure("stt", this.providerMesh.getActiveProvider("stt"));
    }
  }

  /**
   * Execute a recovery action with loop protection.
   */
  executeRecovery(action: RecoveryAction): void {
    const now = performance.now();
    const key = this.actionKey(action);

    // Record the attempt
    this.recentRecoveries.push({ action, ts: now, success: false });
    if (this.recentRecoveries.length > MAX_RECENT_RECOVERIES) {
      this.recentRecoveries.shift();
    }

    // Set cooldown
    this.cooldowns.set(key, now);
    this.isRecovering = true;

    this.broadcastEvent({
      kind: "recovery_attempted",
      action,
      ts: now,
    });

    // Mark as no longer recovering after a short delay
    setTimeout(() => {
      this.isRecovering = false;
    }, 1000);
  }

  /**
   * Report a recovery outcome (success or failure).
   */
  reportRecoveryOutcome(action: RecoveryAction, success: boolean): void {
    // Update the most recent matching recovery
    for (let i = this.recentRecoveries.length - 1; i >= 0; i--) {
      if (this.actionKey(this.recentRecoveries[i].action) === this.actionKey(action)) {
        this.recentRecoveries[i].success = success;
        break;
      }
    }

    if (!success) {
      this.broadcastEvent({
        kind: "recovery_failed",
        action,
        ts: performance.now(),
      });
      this.predictiveFailure.recordFailure(this.actionKey(action));
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // LOOP PROTECTION
  // ═══════════════════════════════════════════════════════════════

  private canExecuteRecovery(action: RecoveryAction): boolean {
    const key = this.actionKey(action);
    const now = performance.now();

    // Cooldown check
    const lastCooldown = this.cooldowns.get(key);
    if (lastCooldown && now - lastCooldown < RECOVERY_COOLDOWN_MS) {
      return false;
    }

    // Loop detection: too many of the same recovery in a short window
    const windowStart = now - RECOVERY_LOOP_WINDOW_MS;
    const recentSameType = this.recentRecoveries.filter(
      (r) => this.actionKey(r.action) === key && r.ts > windowStart
    );
    if (recentSameType.length >= RECOVERY_LOOP_THRESHOLD) {
      console.error(
        `[Orchestrator] Recovery loop detected for "${key}" (${recentSameType.length} attempts in ${RECOVERY_LOOP_WINDOW_MS / 1000}s)`
      );
      return false;
    }

    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENT BUS
  // ═══════════════════════════════════════════════════════════════

  private handleEvent(event: ResilienceEvent): void {
    // Route events to predictive failure engine
    if (event.kind === "stt_error" || event.kind === "stt_frozen") {
      this.predictiveFailure.recordFailure("stt_crash");
    }
    if (event.kind === "audio_stalled" || event.kind === "audio_suspended") {
      this.predictiveFailure.recordFailure("audio_suspend");
    }
    if (event.kind === "network_degraded") {
      this.predictiveFailure.recordFailure("network_drop");
    }

    // Route conversation events
    if (event.kind === "mode_changed") {
      // Update conversation preservation with mode context
      this.conversationPreservation.updateEmotion(
        `mode_${event.to.toLowerCase()}`
      );
    }

    // Broadcast to external listeners
    this.broadcastEvent(event);
  }

  private broadcastEvent(event: ResilienceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.warn("[Orchestrator] Event listener error:", e);
      }
    }
  }

  // ── Utilities ─────────────────────────────────────────────────

  private actionKey(action: RecoveryAction): string {
    switch (action.type) {
      case "stt_restart":
        return `stt_restart_${action.level}`;
      case "provider_switch":
        return `provider_switch_${action.role}`;
      default:
        return action.type;
    }
  }
}
