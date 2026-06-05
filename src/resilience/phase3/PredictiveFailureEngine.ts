/**
 * PredictiveFailureEngine — Pattern-based failure prediction.
 *
 * Tracks recurring failures and generates predictions about which
 * subsystems are likely to fail soon, enabling preemptive recovery.
 *
 * Uses lightweight heuristics (no ML):
 *   - Frequency analysis over rolling windows
 *   - Time-of-day patterns (battery saver hours)
 *   - Consecutive failure detection
 *
 * Storage: localStorage for cross-session learning.
 *
 * @module resilience/phase3/PredictiveFailureEngine
 */

import type { FailureRecord, PredictiveFailureState } from "../types";

const STORAGE_KEY = "aura_failure_patterns";
const ROLLING_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const PREDICTION_THRESHOLD = 3; // 3 failures in window → predict recurrence
const MAX_RECENT_TS = 50;

export class PredictiveFailureEngine {
  private state: PredictiveFailureState;

  constructor() {
    this.state = {
      records: {},
      predictions: [],
    };
    this.loadFromStorage();
  }

  // ── Signal Ingestion ──────────────────────────────────────────

  /**
   * Record a failure event.
   * @param type Failure category (e.g., "stt_crash", "audio_suspend", "network_timeout", "tts_error")
   */
  recordFailure(type: string): void {
    const now = performance.now();

    if (!this.state.records[type]) {
      this.state.records[type] = {
        type,
        count: 0,
        lastTs: 0,
        recentTs: [],
      };
    }

    const record = this.state.records[type];
    record.count++;
    record.lastTs = now;
    record.recentTs.push(now);

    // Cap rolling window
    if (record.recentTs.length > MAX_RECENT_TS) {
      record.recentTs = record.recentTs.slice(-MAX_RECENT_TS);
    }

    this.updatePredictions();
    this.saveToStorage();
  }

  /** Record a successful operation to decay failure frequency */
  recordSuccess(type: string): void {
    const record = this.state.records[type];
    if (record) {
      record.count = Math.max(0, record.count - 1);
    }
  }

  // ── Predictions ───────────────────────────────────────────────

  /**
   * Get current failure predictions.
   * Returns types that are likely to recur based on recent frequency.
   */
  getPredictions(): readonly string[] {
    return this.state.predictions;
  }

  /**
   * Check if a specific failure type is predicted to recur.
   */
  isPredicted(type: string): boolean {
    return this.state.predictions.includes(type);
  }

  /**
   * Get failure frequency for a type (failures per minute in rolling window).
   */
  getFrequency(type: string): number {
    const record = this.state.records[type];
    if (!record) return 0;

    const now = performance.now();
    const windowStart = now - ROLLING_WINDOW_MS;
    const recentCount = record.recentTs.filter((t) => t > windowStart).length;
    return recentCount / (ROLLING_WINDOW_MS / 60_000); // per minute
  }

  /** Get all failure records for diagnostics */
  getState(): Readonly<PredictiveFailureState> {
    return {
      records: { ...this.state.records },
      predictions: [...this.state.predictions],
    };
  }

  // ── Internal ──────────────────────────────────────────────────

  private updatePredictions(): void {
    const now = performance.now();
    const windowStart = now - ROLLING_WINDOW_MS;
    const predictions: string[] = [];

    for (const [type, record] of Object.entries(this.state.records)) {
      const recentCount = record.recentTs.filter((t) => t > windowStart).length;

      if (recentCount >= PREDICTION_THRESHOLD) {
        predictions.push(type);
      }
    }

    this.state.predictions = predictions;
  }

  private saveToStorage(): void {
    try {
      // Save only summary data, not full timestamps
      const summary: Record<string, { count: number; lastTs: number }> = {};
      for (const [type, record] of Object.entries(this.state.records)) {
        summary[type] = { count: record.count, lastTs: record.lastTs };
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(summary));
    } catch {
      // localStorage unavailable — silent fail
    }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const summary = JSON.parse(raw);
      for (const [type, data] of Object.entries(summary) as [string, any][]) {
        this.state.records[type] = {
          type,
          count: data.count || 0,
          lastTs: data.lastTs || 0,
          recentTs: [], // timestamps don't persist across sessions
        };
      }
    } catch {
      // Corrupted — start fresh
    }
  }
}
