/**
 * QueueProtection — Ensures the TTS sentence queue never starves.
 *
 * Maintains a 3-chunk lookahead buffer:
 *   - currentChunk  (currently being spoken)
 *   - nextChunk     (decoded and ready)
 *   - nextNextChunk (fetched/decoded, waiting)
 *
 * When depth drops to 1 during active playback, triggers refill.
 * When depth reaches 0 during active playback, emits critical event.
 *
 * @module resilience/phase3/QueueProtection
 */

import type { QueueProtectionState, ResilienceEvent } from "../types";

const MIN_PROTECTED_DEPTH = 2;

export type QueueRefillCallback = () => void;

export class QueueProtection {
  private state: QueueProtectionState;
  private onRefillNeeded: QueueRefillCallback | null = null;
  private eventSink: ((e: ResilienceEvent) => void) | null = null;
  private isPlaybackActive = false;

  constructor() {
    this.state = {
      currentChunk: null,
      nextChunk: null,
      nextNextChunk: null,
      queueDepth: 0,
      isProtected: true,
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  setCallbacks(
    onRefillNeeded: QueueRefillCallback,
    eventSink?: (e: ResilienceEvent) => void
  ): void {
    this.onRefillNeeded = onRefillNeeded;
    this.eventSink = eventSink ?? null;
  }

  // ── Signal Ingestion ──────────────────────────────────────────

  /** Call when playback starts */
  markPlaybackActive(): void {
    this.isPlaybackActive = true;
  }

  /** Call when all playback completes */
  markPlaybackIdle(): void {
    this.isPlaybackActive = false;
    this.state.currentChunk = null;
    this.state.nextChunk = null;
    this.state.nextNextChunk = null;
    this.state.queueDepth = 0;
    this.state.isProtected = true;
  }

  /** Update the queue state from the sentence queue */
  updateFromQueue(queue: readonly string[]): void {
    this.state.queueDepth = queue.length;
    this.state.currentChunk = queue[0] ?? null;
    this.state.nextChunk = queue[1] ?? null;
    this.state.nextNextChunk = queue[2] ?? null;

    // Check protection level
    if (this.isPlaybackActive) {
      if (queue.length < MIN_PROTECTED_DEPTH) {
        this.state.isProtected = false;

        if (queue.length === 0) {
          // CRITICAL: Queue is empty during playback
          this.emit({
            kind: "silence_detected",
            durationMs: 0,
            ts: performance.now(),
          });
        }

        // Request refill
        this.onRefillNeeded?.();
      } else {
        this.state.isProtected = true;
      }
    }
  }

  /** Call when a chunk is consumed (shifted from queue) */
  reportChunkConsumed(): void {
    // Promote: next → current, nextNext → next
    this.state.currentChunk = this.state.nextChunk;
    this.state.nextChunk = this.state.nextNextChunk;
    this.state.nextNextChunk = null;
    this.state.queueDepth = Math.max(0, this.state.queueDepth - 1);

    if (this.isPlaybackActive && this.state.queueDepth < MIN_PROTECTED_DEPTH) {
      this.state.isProtected = false;
      this.onRefillNeeded?.();
    }
  }

  /** Call when a new chunk is added to the queue */
  reportChunkAdded(chunk: string): void {
    this.state.queueDepth++;
    if (!this.state.nextChunk) {
      this.state.nextChunk = chunk;
    } else if (!this.state.nextNextChunk) {
      this.state.nextNextChunk = chunk;
    }

    if (this.state.queueDepth >= MIN_PROTECTED_DEPTH) {
      this.state.isProtected = true;
    }
  }

  // ── State Access ──────────────────────────────────────────────

  getState(): Readonly<QueueProtectionState> {
    return { ...this.state };
  }

  isQueueProtected(): boolean {
    return this.state.isProtected;
  }

  // ── Internal ──────────────────────────────────────────────────

  private emit(event: ResilienceEvent): void {
    this.eventSink?.(event);
  }
}
