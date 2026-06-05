/**
 * SilenceProtection — Detects and fills unexplained silence.
 *
 * If AURA is in an active state (thinking, speaking) but the user
 * perceives no activity for >2000ms, this module triggers recovery.
 *
 * Recovery hierarchy:
 *   1. Diagnostic check (is audio context alive? is STT frozen?)
 *   2. Fill with conversational acknowledgement
 *   3. Trigger provider recovery
 *
 * The user must ALWAYS perceive activity.
 *
 * @module resilience/phase3/SilenceProtection
 */

import type { SilenceEvent, ResilienceEvent } from "../types";

// ─── Constants ──────────────────────────────────────────────────────
const SILENCE_THRESHOLD_MS = 2000;
const CHECK_INTERVAL_MS = 500;
const FILL_COOLDOWN_MS = 3000;
const MAX_CONSECUTIVE_FILLS = 3;

const FILL_PHRASES = [
  "Give me just a moment...",
  "Still here, thinking...",
  "One second...",
  "Working on it...",
  "Hmm, let me think...",
  "Almost there...",
];

export interface SilenceProtectionCallbacks {
  /** Returns current pipeline status */
  getStatus: () => "idle" | "listening" | "thinking" | "speaking" | "error";
  /** Returns timestamp of last audio/speech activity */
  getLastActivityTs: () => number;
  /** Returns timestamp of last token received */
  getLastTokenTs: () => number;
  /** Speak a filler phrase */
  speakFiller: (text: string) => void;
  /** Check if AudioContext is alive */
  isAudioContextAlive: () => boolean;
  /** Trigger STT recovery */
  triggerSTTRecovery: () => void;
  /** Trigger audio recovery */
  triggerAudioRecovery: () => void;
}

export class SilenceProtection {
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private callbacks: SilenceProtectionCallbacks | null = null;
  private eventSink: ((e: ResilienceEvent) => void) | null = null;
  private events: SilenceEvent[] = [];
  private lastFillTs = 0;
  private consecutiveFills = 0;
  private lastFillIndex = -1;

  // ── Lifecycle ───────────────────────────────────────────────────

  start(
    callbacks: SilenceProtectionCallbacks,
    eventSink?: (e: ResilienceEvent) => void
  ): void {
    this.callbacks = callbacks;
    this.eventSink = eventSink ?? null;
    this.tickHandle = setInterval(() => this.tick(), CHECK_INTERVAL_MS);
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

  /** Call when user-visible activity occurs (audio plays, text appears) */
  reportActivity(): void {
    this.consecutiveFills = 0;
  }

  // ── State Access ──────────────────────────────────────────────

  getRecentEvents(): readonly SilenceEvent[] {
    return this.events.slice(-10);
  }

  // ── Internal ──────────────────────────────────────────────────

  private tick(): void {
    if (!this.callbacks) return;

    const status = this.callbacks.getStatus();
    const now = performance.now();

    // Only protect during active states
    if (status !== "thinking" && status !== "speaking") {
      this.consecutiveFills = 0;
      return;
    }

    const lastActivity = Math.max(
      this.callbacks.getLastActivityTs(),
      this.callbacks.getLastTokenTs()
    );

    // If there's been no last activity recorded, use a fallback
    if (lastActivity === 0) return;

    const silenceDuration = now - lastActivity;

    if (silenceDuration < SILENCE_THRESHOLD_MS) return;

    // Cooldown between fills
    if (now - this.lastFillTs < FILL_COOLDOWN_MS) return;

    // Too many consecutive fills → something is fundamentally wrong
    if (this.consecutiveFills >= MAX_CONSECUTIVE_FILLS) {
      console.error(
        "[SilenceProtection] Max consecutive fills reached. Triggering deep recovery."
      );

      // Diagnose and recover
      if (!this.callbacks.isAudioContextAlive()) {
        this.callbacks.triggerAudioRecovery();
        this.recordEvent(silenceDuration, "audio_recovery");
      } else if (status === "thinking") {
        // LLM might be stuck — the provider mesh should handle this
        this.recordEvent(silenceDuration, "llm_timeout_suspected");
      } else {
        this.callbacks.triggerSTTRecovery();
        this.recordEvent(silenceDuration, "stt_recovery");
      }

      this.consecutiveFills = 0;
      return;
    }

    // Fill with a conversational phrase
    const phrase = this.getNextPhrase();
    this.callbacks.speakFiller(phrase);
    this.lastFillTs = now;
    this.consecutiveFills++;

    this.emit({
      kind: "silence_filled",
      text: phrase,
      ts: now,
    });

    this.recordEvent(silenceDuration, `filler: "${phrase}"`);
  }

  private getNextPhrase(): string {
    // Avoid repeating the same phrase consecutively
    let index: number;
    do {
      index = Math.floor(Math.random() * FILL_PHRASES.length);
    } while (index === this.lastFillIndex && FILL_PHRASES.length > 1);

    this.lastFillIndex = index;
    return FILL_PHRASES[index];
  }

  private recordEvent(durationMs: number, action: string): void {
    const event: SilenceEvent = {
      detectedAt: performance.now(),
      durationMs,
      context: this.callbacks?.getStatus() || "unknown",
      recoveryAction: action,
      resolved: true,
    };

    this.events.push(event);
    if (this.events.length > 50) this.events.shift();

    this.emit({
      kind: "silence_detected",
      durationMs,
      ts: performance.now(),
    });
  }

  private emit(event: ResilienceEvent): void {
    this.eventSink?.(event);
  }
}
