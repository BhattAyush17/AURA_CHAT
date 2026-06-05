/**
 * ExperienceHealthEngine — Unified experience health scoring.
 *
 * Combines:
 *   - deviceCapabilityScore (from DeviceProfiler)
 *   - networkHealthScore (from NetworkMonitor)
 *   - sttHealth (from STTWatchdog)
 *   - audioHealth (from AudioWatchdog)
 *
 * into a single experienceHealthScore (0–100) and ExperienceMode.
 *
 * Mode transitions use hysteresis to prevent oscillation:
 *   HEALTHY  → WARNING  at score < 72 (enter WARNING at 55, exit at 48)
 *   WARNING  → RECOVERY at score < 48
 *   RECOVERY → CRITICAL at score < 22
 *
 * @module resilience/phase2/ExperienceHealthEngine
 */

import type {
  ExperienceMode,
  ExperienceHealthSnapshot,
  AdaptationPolicy,
  ResilienceEvent,
  HealthScore,
  MODE_THRESHOLDS,
} from "../types";

// Re-import constant value
const THRESHOLDS = {
  HEALTHY:   { enter: 80, exit: 72 },
  WARNING:   { enter: 55, exit: 48 },
  RECOVERY:  { enter: 30, exit: 22 },
} as const;

// ─── Weight Configuration ────────────────────────────────────────
// Network and audio are weighted higher because they directly affect
// perceived responsiveness. Device is a baseline floor.
const WEIGHTS = {
  device:  0.20,
  network: 0.35,
  stt:     0.20,
  audio:   0.25,
} as const;

export class ExperienceHealthEngine {
  private currentMode: ExperienceMode = "HEALTHY";
  private lastSnapshot: ExperienceHealthSnapshot;
  private eventSink: ((e: ResilienceEvent) => void) | null = null;

  constructor() {
    this.lastSnapshot = {
      score: 100,
      mode: "HEALTHY",
      deviceCapability: 100,
      networkHealth: 100,
      sttHealth: 100,
      audioHealth: 100,
      ts: performance.now(),
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  setEventSink(sink: (e: ResilienceEvent) => void): void {
    this.eventSink = sink;
  }

  // ── Core Computation ──────────────────────────────────────────

  /**
   * Recalculate the experience health score from component scores.
   * Call this on every watchdog tick (~500ms).
   */
  update(
    deviceCapability: HealthScore,
    networkHealth: HealthScore,
    sttHealth: HealthScore,
    audioHealth: HealthScore,
  ): ExperienceHealthSnapshot {
    // Weighted average
    const raw =
      deviceCapability * WEIGHTS.device +
      networkHealth * WEIGHTS.network +
      sttHealth * WEIGHTS.stt +
      audioHealth * WEIGHTS.audio;

    // Floor: if any critical subsystem is near-zero, cap the score
    const minComponent = Math.min(networkHealth, sttHealth, audioHealth);
    const floored = minComponent < 10 ? Math.min(raw, 25) : raw;

    const score = Math.max(0, Math.min(100, Math.round(floored)));

    // Mode transition with hysteresis
    const prevMode = this.currentMode;
    this.currentMode = this.resolveMode(score, prevMode);

    if (prevMode !== this.currentMode) {
      this.emit({
        kind: "mode_changed",
        from: prevMode,
        to: this.currentMode,
        ts: performance.now(),
      });
      console.log(
        `[ExperienceHealth] Mode: ${prevMode} → ${this.currentMode} (score: ${score})`
      );
    }

    this.lastSnapshot = {
      score,
      mode: this.currentMode,
      deviceCapability,
      networkHealth,
      sttHealth,
      audioHealth,
      ts: performance.now(),
    };

    return this.lastSnapshot;
  }

  // ── Policy Generation ─────────────────────────────────────────

  /**
   * Generate an AdaptationPolicy from the current mode.
   * Consumers (LLM pipeline, TTS, streaming) use this to adjust behavior.
   */
  getPolicy(): AdaptationPolicy {
    switch (this.currentMode) {
      case "HEALTHY":
        return {
          mode: "HEALTHY",
          maxTokensHint: 4096,
          compressDelivery: false,
          reduceRedundancy: false,
          aggressiveStreaming: false,
          contextBudgetMultiplier: 1.0,
          reason: "All systems nominal. Full AURA experience.",
        };

      case "WARNING":
        return {
          mode: "WARNING",
          maxTokensHint: 2048,
          compressDelivery: false,
          reduceRedundancy: true,
          aggressiveStreaming: false,
          contextBudgetMultiplier: 0.85,
          reason: "Minor degradation detected. Reducing redundancy to maintain responsiveness.",
        };

      case "RECOVERY":
        return {
          mode: "RECOVERY",
          maxTokensHint: 1024,
          compressDelivery: true,
          reduceRedundancy: true,
          aggressiveStreaming: true,
          contextBudgetMultiplier: 0.6,
          reason: "Significant degradation. Compressing delivery structure. Core answer preserved.",
        };

      case "CRITICAL":
        return {
          mode: "CRITICAL",
          maxTokensHint: 256,
          compressDelivery: true,
          reduceRedundancy: true,
          aggressiveStreaming: true,
          contextBudgetMultiplier: 0.3,
          reason: "Emergency mode. Shortest useful response. Never silent.",
        };
    }
  }

  // ── State Access ──────────────────────────────────────────────

  getSnapshot(): Readonly<ExperienceHealthSnapshot> {
    return { ...this.lastSnapshot };
  }

  getMode(): ExperienceMode {
    return this.currentMode;
  }

  // ── Internal ──────────────────────────────────────────────────

  /**
   * Hysteresis-based mode resolution.
   * To enter a worse mode, score must drop below threshold.enter.
   * To return to a better mode, score must rise above threshold.exit + buffer.
   */
  private resolveMode(score: number, current: ExperienceMode): ExperienceMode {
    // Downgrade checks (in order of severity)
    if (score < THRESHOLDS.RECOVERY.exit) return "CRITICAL";
    if (score < THRESHOLDS.WARNING.exit && current !== "CRITICAL") return "RECOVERY";
    if (score < THRESHOLDS.HEALTHY.exit && current !== "CRITICAL" && current !== "RECOVERY") return "WARNING";

    // Upgrade checks (require exceeding the enter threshold of the better mode)
    if (current === "CRITICAL" && score >= THRESHOLDS.RECOVERY.enter) return "RECOVERY";
    if (current === "RECOVERY" && score >= THRESHOLDS.WARNING.enter) return "WARNING";
    if (current === "WARNING" && score >= THRESHOLDS.HEALTHY.enter) return "HEALTHY";

    return current; // stay in current mode (hysteresis zone)
  }

  private emit(event: ResilienceEvent): void {
    this.eventSink?.(event);
  }
}
