export type EventCallback = (payload?: any) => void;

export interface EventRecord {
  event: string;
  payload: any;
  timestamp: number;
}

export class PlaybackEvents {
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private historyBuffer: EventRecord[] = [];
  private readonly MAX_HISTORY = 50;

  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.off(event, callback);
  }

  off(event: string, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  emit(event: string, payload?: any): void {
    // Record to ring buffer
    this.historyBuffer.push({ event, payload, timestamp: Date.now() });
    if (this.historyBuffer.length > this.MAX_HISTORY) {
      this.historyBuffer.shift();
    }

    if (this.listeners.has(event)) {
      this.listeners.get(event)!.forEach(cb => {
        try {
          cb(payload);
        } catch (e) {
          console.error(`Error in event listener for ${event}:`, e);
        }
      });
    }
  }

  getRecentEvents(): EventRecord[] {
    return [...this.historyBuffer];
  }
}

export const musicEvents = new PlaybackEvents();
