/**
 * NetworkMonitor — Continuous network health assessment.
 *
 * Monitors:
 *   - Navigator.onLine state changes
 *   - Network Information API (effectiveType, RTT, downlink)
 *   - API call latency (injected via reportApiCall)
 *   - Timeout and retry frequency
 *
 * Generates:
 *   networkHealthScore (0–100)
 *
 * @module resilience/phase1/NetworkMonitor
 */

import type { NetworkHealthState, ResilienceEvent } from "../types";

// ─── Constants ──────────────────────────────────────────────────────
const LATENCY_WINDOW_SIZE = 20;
const POLL_INTERVAL_MS = 3000;
const HIGH_LATENCY_MS = 500;
const TIMEOUT_DECAY = 10;
const RETRY_DECAY = 5;
const RECOVERY_PER_TICK = 2;

export class NetworkMonitor {
  private state: NetworkHealthState;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private eventSink: ((e: ResilienceEvent) => void) | null = null;
  private onlineHandler: (() => void) | null = null;
  private offlineHandler: (() => void) | null = null;
  private lastEmittedDegraded = false;

  constructor() {
    this.state = {
      health: 100,
      rttMs: 0,
      avgApiLatencyMs: 0,
      timeoutCount: 0,
      retryCount: 0,
      isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
      effectiveType: "4g",
      latencySamples: [],
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  start(eventSink?: (e: ResilienceEvent) => void): void {
    this.eventSink = eventSink ?? null;

    // Listen for online/offline
    if (typeof window !== "undefined") {
      this.onlineHandler = () => {
        this.state.isOnline = true;
        this.recalculate();
      };
      this.offlineHandler = () => {
        this.state.isOnline = false;
        this.state.health = 5;
        this.emitDegradation();
      };
      window.addEventListener("online", this.onlineHandler);
      window.addEventListener("offline", this.offlineHandler);
    }

    // Poll Network Information API
    this.pollHandle = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    this.poll(); // immediate first read
  }

  stop(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    if (typeof window !== "undefined") {
      if (this.onlineHandler) window.removeEventListener("online", this.onlineHandler);
      if (this.offlineHandler) window.removeEventListener("offline", this.offlineHandler);
    }
  }

  destroy(): void {
    this.stop();
  }

  // ── Signal Ingestion ──────────────────────────────────────────

  /** Call after every API call completes with its latency */
  reportApiCall(latencyMs: number): void {
    this.state.latencySamples.push(latencyMs);
    if (this.state.latencySamples.length > LATENCY_WINDOW_SIZE) {
      this.state.latencySamples.shift();
    }
    this.recalculate();
  }

  /** Call when an API call times out */
  reportTimeout(): void {
    this.state.timeoutCount++;
    this.state.health = Math.max(0, this.state.health - TIMEOUT_DECAY);
    this.recalculate();
  }

  /** Call when an API call is retried */
  reportRetry(): void {
    this.state.retryCount++;
    this.state.health = Math.max(0, this.state.health - RETRY_DECAY);
  }

  // ── State Access ──────────────────────────────────────────────

  getState(): Readonly<NetworkHealthState> {
    return { ...this.state, latencySamples: [...this.state.latencySamples] };
  }

  // ── Internal ──────────────────────────────────────────────────

  private poll(): void {
    if (typeof navigator === "undefined") return;

    this.state.isOnline = navigator.onLine;

    const conn = (navigator as any).connection;
    if (conn) {
      this.state.rttMs = conn.rtt ?? 0;
      this.state.effectiveType = conn.effectiveType ?? "4g";
    }

    this.recalculate();
  }

  private recalculate(): void {
    if (!this.state.isOnline) {
      this.state.health = 5;
      this.emitDegradation();
      return;
    }

    let score = 100;

    // RTT penalty
    if (this.state.rttMs > 300) score -= 15;
    else if (this.state.rttMs > 150) score -= 5;

    // Effective type penalty
    const et = this.state.effectiveType;
    if (et === "slow-2g" || et === "2g") score -= 35;
    else if (et === "3g") score -= 15;

    // API latency penalty
    if (this.state.latencySamples.length > 0) {
      const avg =
        this.state.latencySamples.reduce((a, b) => a + b, 0) /
        this.state.latencySamples.length;
      this.state.avgApiLatencyMs = Math.round(avg);

      if (avg > 2000) score -= 30;
      else if (avg > 1000) score -= 20;
      else if (avg > HIGH_LATENCY_MS) score -= 10;
    }

    // Timeout penalty (exponential)
    score -= Math.min(40, this.state.timeoutCount * TIMEOUT_DECAY);

    // Passive recovery
    score += RECOVERY_PER_TICK;

    this.state.health = Math.max(0, Math.min(100, score));

    // Emit events on threshold crossings
    if (this.state.health < 50 && !this.lastEmittedDegraded) {
      this.emitDegradation();
    } else if (this.state.health >= 60 && this.lastEmittedDegraded) {
      this.lastEmittedDegraded = false;
      this.emit({
        kind: "network_recovered",
        health: this.state.health,
        ts: performance.now(),
      });
    }
  }

  private emitDegradation(): void {
    this.lastEmittedDegraded = true;
    this.emit({
      kind: "network_degraded",
      health: this.state.health,
      ts: performance.now(),
    });
  }

  private emit(event: ResilienceEvent): void {
    this.eventSink?.(event);
  }
}
