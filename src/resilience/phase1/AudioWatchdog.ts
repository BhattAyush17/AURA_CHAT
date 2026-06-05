/**
 * AudioWatchdog — Monitors AudioContext and playback pipeline health.
 *
 * Detects:
 *   - Stalled playback (audio source started but no progress)
 *   - Suspended AudioContext (iOS/Android policy interruptions)
 *   - Empty queue during active speaking state
 *
 * Recovery:
 *   - Resume suspended AudioContext
 *   - Rebuild playback chain
 *   - Request next chunk from queue
 *
 * @module resilience/phase1/AudioWatchdog
 */

import type { AudioHealthState, ResilienceEvent } from "../types";

// ─── Constants ──────────────────────────────────────────────────────
const STALL_THRESHOLD_MS = 2000;
const TICK_INTERVAL_MS = 500;
const MAX_RESUME_ATTEMPTS = 3;
const HEALTH_DECAY_STALL = 20;
const HEALTH_DECAY_SUSPEND = 15;
const HEALTH_RECOVERY_PER_TICK = 3;

export interface AudioWatchdogCallbacks {
  onResumeContext: () => Promise<boolean>;
  onRebuildPlayback: () => void;
  onRequestNextChunk: () => void;
}

export class AudioWatchdog {
  private state: AudioHealthState;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private callbacks: AudioWatchdogCallbacks | null = null;
  private eventSink: ((e: ResilienceEvent) => void) | null = null;
  private isSpeakingExpected = false;

  constructor() {
    this.state = {
      state: "idle",
      health: 100,
      contextState: "unavailable",
      queueDepth: 0,
      lastPlaybackTs: 0,
      stallCount: 0,
      resumeAttempts: 0,
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  start(
    callbacks: AudioWatchdogCallbacks,
    eventSink?: (e: ResilienceEvent) => void
  ): void {
    this.callbacks = callbacks;
    this.eventSink = eventSink ?? null;
    this.tickHandle = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    this.callbacks = null;
  }

  destroy(): void {
    this.stop();
  }

  // ── Signal Ingestion ──────────────────────────────────────────

  /** Call when AudioContext state changes */
  reportContextState(ctxState: AudioContextState): void {
    this.state.contextState = ctxState;

    if (ctxState === "suspended") {
      this.state.state = "suspended";
      this.state.health = Math.max(0, this.state.health - HEALTH_DECAY_SUSPEND);
      this.emit({ kind: "audio_suspended", ts: performance.now() });
      this.attemptResume();
    } else if (ctxState === "running") {
      if (this.state.state === "suspended") {
        this.state.state = this.isSpeakingExpected ? "playing" : "idle";
        this.state.resumeAttempts = 0;
        this.emit({ kind: "audio_recovered", ts: performance.now() });
      }
    }
  }

  /** Call when audio playback starts */
  reportPlaybackStart(): void {
    this.isSpeakingExpected = true;
    this.state.state = "playing";
    this.state.lastPlaybackTs = performance.now();
  }

  /** Call when a chunk finishes playing */
  reportPlaybackEnd(): void {
    this.state.lastPlaybackTs = performance.now();
  }

  /** Call when all speech is done */
  reportSpeechComplete(): void {
    this.isSpeakingExpected = false;
    this.state.state = "idle";
  }

  /** Update current queue depth */
  reportQueueDepth(depth: number): void {
    this.state.queueDepth = depth;
  }

  /** Call when playback errors occur */
  reportPlaybackError(): void {
    this.state.state = "error";
    this.state.health = Math.max(0, this.state.health - HEALTH_DECAY_STALL);
  }

  // ── State Access ──────────────────────────────────────────────

  getState(): Readonly<AudioHealthState> {
    return { ...this.state };
  }

  // ── Internal ──────────────────────────────────────────────────

  private tick(): void {
    const now = performance.now();

    // Stall detection: expecting playback but no activity
    if (
      this.isSpeakingExpected &&
      this.state.state === "playing" &&
      this.state.lastPlaybackTs > 0 &&
      now - this.state.lastPlaybackTs > STALL_THRESHOLD_MS
    ) {
      this.state.stallCount++;
      this.state.health = Math.max(0, this.state.health - HEALTH_DECAY_STALL);
      this.state.state = "stalled";

      this.emit({
        kind: "audio_stalled",
        durationMs: now - this.state.lastPlaybackTs,
        ts: now,
      });

      // Try to unstall
      if (this.state.contextState === "suspended") {
        this.attemptResume();
      } else if (this.state.queueDepth > 0) {
        this.callbacks?.onRequestNextChunk();
      } else {
        this.callbacks?.onRebuildPlayback();
      }
    }

    // Empty queue during active playback
    if (
      this.isSpeakingExpected &&
      this.state.queueDepth === 0 &&
      this.state.state === "playing"
    ) {
      this.callbacks?.onRequestNextChunk();
    }

    // Passive recovery when playing normally
    if (
      this.state.state === "playing" &&
      now - this.state.lastPlaybackTs < 500
    ) {
      this.state.health = Math.min(100, this.state.health + HEALTH_RECOVERY_PER_TICK);
    }

    // Idle recovery
    if (this.state.state === "idle" && !this.isSpeakingExpected) {
      this.state.health = Math.min(100, this.state.health + 1);
    }
  }

  private async attemptResume(): Promise<void> {
    if (this.state.resumeAttempts >= MAX_RESUME_ATTEMPTS) {
      console.warn("[AudioWatchdog] Max resume attempts reached, requesting rebuild.");
      this.callbacks?.onRebuildPlayback();
      return;
    }

    this.state.resumeAttempts++;
    const success = await this.callbacks?.onResumeContext();
    if (success) {
      this.state.state = this.isSpeakingExpected ? "playing" : "idle";
      this.state.resumeAttempts = 0;
      this.emit({ kind: "audio_recovered", ts: performance.now() });
    }
  }

  private emit(event: ResilienceEvent): void {
    this.eventSink?.(event);
  }
}
