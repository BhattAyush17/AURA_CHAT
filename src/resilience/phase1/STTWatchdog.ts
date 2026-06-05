/**
 * STTWatchdog — Monitors speech recognition health and drives recovery.
 *
 * Detects:
 *   - Frozen sessions (no events for >3s while "listening")
 *   - InvalidStateError loops (>3 errors in 10s window)
 *   - Silent recognition failures (recognition running but no transcript)
 *
 * Recovery ladder:
 *   Level 0: soft restart (stop + start)
 *   Level 1: hard restart (destroy + recreate)
 *   Level 2: provider switch (e.g. WebSpeech → Sarvam STT)
 *   Level 3: text input fallback
 *
 * @module resilience/phase1/STTWatchdog
 */

import type { STTHealthState, ResilienceEvent } from "../types";

// ─── Constants ──────────────────────────────────────────────────────
const FROZEN_THRESHOLD_MS = 3000;
const ERROR_WINDOW_MS = 10_000;
const MAX_ERRORS_IN_WINDOW = 3;
const SILENT_THRESHOLD_MS = 5000;
const HEALTH_DECAY_PER_ERROR = 15;
const HEALTH_RECOVERY_PER_TICK = 2;
const TICK_INTERVAL_MS = 500;
const RESTART_COOLDOWN_MS = 2000;

export type STTRecoveryCallback = (level: 0 | 1 | 2 | 3) => void;

export class STTWatchdog {
  private state: STTHealthState;
  private errorTimestamps: number[] = [];
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private lastRestartTs = 0;
  private onRecovery: STTRecoveryCallback | null = null;
  private eventSink: ((e: ResilienceEvent) => void) | null = null;
  private isListening = false;

  constructor() {
    this.state = {
      state: "idle",
      health: 100,
      lastEventTs: performance.now(),
      lastTranscriptTs: 0,
      errorCount: 0,
      restartCount: 0,
      recoveryLevel: 0,
      isFrozen: false,
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  start(onRecovery: STTRecoveryCallback, eventSink?: (e: ResilienceEvent) => void): void {
    this.onRecovery = onRecovery;
    this.eventSink = eventSink ?? null;
    this.tickHandle = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    this.onRecovery = null;
  }

  destroy(): void {
    this.stop();
  }

  // ── Signal Ingestion (call these from STT integration) ──────────

  /** Call when SpeechRecognition.onstart fires */
  reportListening(): void {
    this.isListening = true;
    this.state.state = "active";
    this.state.lastEventTs = performance.now();
    this.state.isFrozen = false;
  }

  /** Call when any recognition event fires (onresult, onspeechend, etc.) */
  reportEvent(): void {
    this.state.lastEventTs = performance.now();
    this.state.isFrozen = false;
  }

  /** Call when a transcript result is received */
  reportTranscript(): void {
    this.state.lastEventTs = performance.now();
    this.state.lastTranscriptTs = performance.now();
    this.state.isFrozen = false;
    // Transcript activity = positive health signal
    this.state.health = Math.min(100, this.state.health + 5);
  }

  /** Call when SpeechRecognition.onerror fires */
  reportError(errorName: string): void {
    const now = performance.now();
    this.state.lastEventTs = now;
    this.state.errorCount++;
    this.errorTimestamps.push(now);
    this.state.health = Math.max(0, this.state.health - HEALTH_DECAY_PER_ERROR);

    this.emit({ kind: "stt_error", error: errorName, ts: now });

    // Prune old error timestamps
    this.errorTimestamps = this.errorTimestamps.filter(
      (t) => now - t < ERROR_WINDOW_MS
    );

    // InvalidStateError loop detection
    if (
      this.errorTimestamps.length >= MAX_ERRORS_IN_WINDOW &&
      errorName === "InvalidStateError"
    ) {
      this.escalateRecovery();
    }
  }

  /** Call when recognition stops (onend) */
  reportStopped(): void {
    this.isListening = false;
    this.state.state = "idle";
    this.state.lastEventTs = performance.now();
  }

  /** Call after a successful recovery */
  reportRecovered(): void {
    this.state.isFrozen = false;
    this.state.restartCount++;
    this.state.health = Math.min(100, this.state.health + 10);
    this.emit({
      kind: "stt_recovered",
      level: this.state.recoveryLevel,
      ts: performance.now(),
    });
  }

  /** Call when text fallback is activated */
  reportFallback(): void {
    this.state.state = "fallback";
    this.state.recoveryLevel = 3;
    this.state.health = 20;
  }

  // ── State Access ──────────────────────────────────────────────

  getState(): Readonly<STTHealthState> {
    return { ...this.state };
  }

  // ── Internal ──────────────────────────────────────────────────

  private tick(): void {
    const now = performance.now();

    // Frozen detection: listening but no events for FROZEN_THRESHOLD_MS
    if (
      this.isListening &&
      this.state.state === "active" &&
      now - this.state.lastEventTs > FROZEN_THRESHOLD_MS
    ) {
      if (!this.state.isFrozen) {
        this.state.isFrozen = true;
        this.state.state = "frozen";
        this.state.health = Math.max(0, this.state.health - 25);
        this.emit({
          kind: "stt_frozen",
          durationMs: now - this.state.lastEventTs,
          ts: now,
        });
        this.escalateRecovery();
      }
    }

    // Silent recognition: active but no transcript for SILENT_THRESHOLD_MS
    if (
      this.isListening &&
      this.state.state === "active" &&
      this.state.lastTranscriptTs > 0 &&
      now - this.state.lastTranscriptTs > SILENT_THRESHOLD_MS
    ) {
      this.state.health = Math.max(0, this.state.health - 5);
    }

    // Passive health recovery when things are working
    if (
      this.state.state === "active" &&
      !this.state.isFrozen &&
      now - this.state.lastEventTs < 1000
    ) {
      this.state.health = Math.min(100, this.state.health + HEALTH_RECOVERY_PER_TICK);
    }
  }

  private escalateRecovery(): void {
    const now = performance.now();

    // Cooldown: don't escalate too quickly
    if (now - this.lastRestartTs < RESTART_COOLDOWN_MS) return;
    this.lastRestartTs = now;

    // Advance recovery level
    const nextLevel = Math.min(3, this.state.recoveryLevel + 1) as 0 | 1 | 2 | 3;
    this.state.recoveryLevel = nextLevel;

    console.warn(
      `[STTWatchdog] Escalating recovery to level ${nextLevel}` +
        ` (health: ${this.state.health}, errors: ${this.state.errorCount})`
    );

    this.emit({
      kind: "recovery_attempted",
      action: { type: "stt_restart", level: nextLevel },
      ts: now,
    });

    this.onRecovery?.(nextLevel);
  }

  private emit(event: ResilienceEvent): void {
    this.eventSink?.(event);
  }
}
