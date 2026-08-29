import { Track } from './types';
import { musicEvents } from './PlaybackEvents';

export class QueueManager {
  private queue: Track[] = [];
  private history: Track[] = [];
  private currentIdx: number = -1;

  setQueue(tracks: Track[]) {
    this.queue = [...tracks];
    this.currentIdx = 0;
    musicEvents.emit('queueChanged', this.queue);
  }

  addTrack(track: Track, next: boolean = false) {
    if (next && this.currentIdx >= 0) {
      this.queue.splice(this.currentIdx + 1, 0, track);
    } else {
      this.queue.push(track);
    }
    musicEvents.emit('queueChanged', this.queue);
  }

  getNext(): Track | null {
    if (this.currentIdx >= 0 && this.currentIdx < this.queue.length - 1) {
      this.currentIdx++;
      return this.queue[this.currentIdx];
    }
    return null;
  }

  getPrevious(): Track | null {
    if (this.currentIdx > 0) {
      this.currentIdx--;
      return this.queue[this.currentIdx];
    }
    return null;
  }

  getCurrent(): Track | null {
    if (this.currentIdx >= 0 && this.currentIdx < this.queue.length) {
      return this.queue[this.currentIdx];
    }
    return null;
  }

  getQueue(): Track[] {
    return this.queue;
  }

  getCurrentIdx(): number {
    return this.currentIdx;
  }

  clear() {
    this.queue = [];
    this.currentIdx = -1;
    musicEvents.emit('queueChanged', this.queue);
  }

  shuffle() {
    // Keep current track at currentIdx, shuffle rest
    const current = this.queue[this.currentIdx];
    const rest = this.queue.filter((_, i) => i !== this.currentIdx);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this.queue = current ? [current, ...rest] : rest;
    this.currentIdx = current ? 0 : -1;
    musicEvents.emit('queueChanged', this.queue);
  }
}

export const queueManager = new QueueManager();
