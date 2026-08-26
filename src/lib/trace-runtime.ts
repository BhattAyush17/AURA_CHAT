/**
 * AURA Trace Runtime (G4)
 *
 * Per-utterance tracing for the frozen Trace Runtime contract
 * (src/speech/types/trace.ts). Every traced utterance carries the frozen
 * envelope { traceId, utteranceId, epoch, providerId, timestamp } and
 * observations against the frozen TraceStage chain.
 *
 * Honest mapping for realtime providers (Gemini):
 *   speech-start  — user turn enters processing (server transcription)
 *   final         — turn text dispatched to the session
 *   llm-start     — model generation begins
 *   first-token   — first model output arrives
 *   first-pcm     — first audio PCM arrives
 *   playback      — audio handed to the playback scheduler
 *
 * Stages that have no realtime equivalent (mic-start, first-partial,
 * tts-request) are NEVER fabricated — the frozen chain is only appended
 * when a real event exists.
 *
 * Observability: every point is dispatched as a window CustomEvent
 * "aura:trace" (mirroring the aura:latency pattern) and summarized
 * on completion.
 */

import type { TraceEnvelope, TracePoint, TraceStage } from "@/speech/types/trace";

export interface TraceSummary {
  traceId: string;
  utteranceId: string;
  epoch: number;
  providerId: string;
  startedAt: number;
  durationMs: number;
  stages: TraceStage[];
  /** performance.now() of client-side speech onset, when detected (same clock). */
  speechOnsetAt?: number;
}

interface ActiveTrace {
  speechOnsetAt: number | null;
  envelope: TraceEnvelope;
  startedAt: number;
  points: TracePoint[];
}

const RECENT_TRACE_LIMIT = 20;

class TraceRuntime {
  private epoch = 0;
  private seq = 0;
  private active: Map<string, ActiveTrace> = new Map();
  private recent: TraceSummary[] = [];

  // All timestamps use performance.now() (one monotonic clock) — never mix
  // clocks when computing segment latencies.
  private pendingOnset: number | null = null;
  private lastOnset: number | null = null;

  /** Begin a new session epoch. Returns the epoch number. */
  beginEpoch(): number {
    this.epoch += 1;
    this.active.clear();
    return this.epoch;
  }

  /** Record client-side speech onset (media-level activity detection). */
  noteSpeechOnset(): void {
    const now = performance.now();
    this.pendingOnset = now;
    this.lastOnset = now;
  }

  /**
   * Latency from speech onset to the moment audio playback stopped, i.e. the
   * interruption reflex (onset → detection → interruptPlayback/flush).
   * Returns null when no onset was ever recorded.
   */
  measureInterruptionStopMs(): number | null {
    if (this.lastOnset === null) return null;
    return performance.now() - this.lastOnset;
  }

  /** Start a new per-utterance trace. Returns the traceId. */
  beginUtterance(providerId: string, utteranceId?: string): string {
    const traceId = `tr-${this.epoch}-${++this.seq}`;
    const now = performance.now();
    const speechOnsetAt = this.pendingOnset;
    this.pendingOnset = null;
    this.active.set(traceId, {
      speechOnsetAt,
      envelope: {
        traceId,
        utteranceId: utteranceId ?? traceId,
        epoch: this.epoch,
        providerId,
        timestamp: now,
      },
      startedAt: now,
      points: [],
    });
    this.point(traceId, "speech-start");
    return traceId;
  }

  /** Record a stage observation against an active trace. */
  point(traceId: string, stage: TraceStage, durationMs?: number): void {
    const trace = this.active.get(traceId);
    if (!trace) return;
    const now = performance.now();
    const point: TracePoint = {
      ...trace.envelope,
      stage,
      timestamp: now,
      durationMs: durationMs ?? now - trace.startedAt,
    };
    trace.points.push(point);
    this.emit(point);
  }

  /** End an active trace and return its summary (no-op if empty). */
  endUtterance(traceId: string): TraceSummary | null {
    const trace = this.active.get(traceId);
    if (!trace || trace.points.length === 0) {
      this.active.delete(traceId);
      return null;
    }
    const { envelope, startedAt, points } = trace;
    this.active.delete(traceId);
    const now = performance.now();
    const summary: TraceSummary = {
      traceId: envelope.traceId,
      utteranceId: envelope.utteranceId,
      epoch: envelope.epoch,
      providerId: envelope.providerId,
      startedAt,
      durationMs: now - startedAt,
      stages: points.map((p) => p.stage),
      ...(trace.speechOnsetAt !== null ? { speechOnsetAt: trace.speechOnsetAt } : {}),
    };
    this.recent.push(summary);
    if (this.recent.length > RECENT_TRACE_LIMIT) this.recent.shift();
    console.log(
      `[TraceRuntime] utterance ${summary.utteranceId} (${summary.stages.join(" → ")}) ${summary.durationMs}ms`,
    );
    this.emit(summary);
    return summary;
  }

  /** Abort an active trace without a summary (e.g. interrupted turn). */
  abortUtterance(traceId: string): void {
    this.active.delete(traceId);
  }

  getRecentTraces(): TraceSummary[] {
    return [...this.recent];
  }

  getActiveCount(): number {
    return this.active.size;
  }

  private emit(detail: TracePoint | TraceSummary): void {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("aura:trace", { detail }));
    }
  }
}

export const traceRuntime = new TraceRuntime();
