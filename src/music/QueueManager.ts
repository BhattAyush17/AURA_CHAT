/**
 * AURA Music System — QueueManager
 * 
 * Manages the music queue: add, remove, next, previous, shuffle, repeat.
 */

import type { TrackInfo, RepeatMode } from "./types";

export class QueueManager {
  private _queue: TrackInfo[] = [];
  private _currentIndex: number = -1;
  private _repeat: RepeatMode = "none";
  private _shuffle: boolean = false;
  private _shuffledIndices: number[] = [];

  get queue(): readonly TrackInfo[] {
    return this._queue;
  }

  get currentIndex(): number {
    return this._currentIndex;
  }

  get repeat(): RepeatMode {
    return this._repeat;
  }

  get shuffle(): boolean {
    return this._shuffle;
  }

  get currentTrack(): TrackInfo | null {
    if (this._currentIndex < 0 || this._currentIndex >= this._queue.length) return null;
    const idx = this._shuffle ? this._shuffledIndices[this._currentIndex] : this._currentIndex;
    return this._queue[idx] ?? null;
  }

  get length(): number {
    return this._queue.length;
  }

  // ── Mutation ──────────────────────────────────────────────────────

  add(track: TrackInfo): void {
    this._queue.push(track);
    this.rebuildShuffleIndices();
  }

  addMany(tracks: TrackInfo[]): void {
    this._queue.push(...tracks);
    this.rebuildShuffleIndices();
  }

  remove(index: number): void {
    if (index < 0 || index >= this._queue.length) return;
    this._queue.splice(index, 1);
    if (this._currentIndex >= this._queue.length) {
      this._currentIndex = this._queue.length - 1;
    }
    this.rebuildShuffleIndices();
  }

  clear(): void {
    this._queue = [];
    this._currentIndex = -1;
    this._shuffledIndices = [];
  }

  setIndex(index: number): void {
    if (index >= 0 && index < this._queue.length) {
      this._currentIndex = index;
    }
  }

  // ── Navigation ────────────────────────────────────────────────────

  next(): TrackInfo | null {
    if (this._queue.length === 0) return null;

    if (this._repeat === "one") {
      // Repeat current track
      return this.currentTrack;
    }

    const nextIndex = this._currentIndex + 1;

    if (nextIndex >= this._queue.length) {
      if (this._repeat === "all") {
        this._currentIndex = 0;
        if (this._shuffle) this.rebuildShuffleIndices();
      } else {
        return null; // Queue exhausted
      }
    } else {
      this._currentIndex = nextIndex;
    }

    return this.currentTrack;
  }

  previous(): TrackInfo | null {
    if (this._queue.length === 0) return null;

    if (this._repeat === "one") {
      return this.currentTrack;
    }

    const prevIndex = this._currentIndex - 1;

    if (prevIndex < 0) {
      if (this._repeat === "all") {
        this._currentIndex = this._queue.length - 1;
      } else {
        this._currentIndex = 0;
        return this.currentTrack; // Stay at first track
      }
    } else {
      this._currentIndex = prevIndex;
    }

    return this.currentTrack;
  }

  // ── Mode ──────────────────────────────────────────────────────────

  setRepeat(mode: RepeatMode): void {
    this._repeat = mode;
  }

  toggleShuffle(): void {
    this._shuffle = !this._shuffle;
    if (this._shuffle) {
      this.rebuildShuffleIndices();
    }
  }

  setShuffle(enabled: boolean): void {
    this._shuffle = enabled;
    if (enabled) {
      this.rebuildShuffleIndices();
    }
  }

  // ── Internal ──────────────────────────────────────────────────────

  private rebuildShuffleIndices(): void {
    this._shuffledIndices = Array.from({ length: this._queue.length }, (_, i) => i);
    // Fisher-Yates shuffle
    for (let i = this._shuffledIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this._shuffledIndices[i], this._shuffledIndices[j]] = [this._shuffledIndices[j], this._shuffledIndices[i]];
    }
  }
}
