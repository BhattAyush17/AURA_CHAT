// src/runtime/optimization/TelemetryDispatcher.ts

import { TelemetryEnvelope } from "../contracts/ExecutionContracts";

export class TelemetryDispatcher {
  private static instance: TelemetryDispatcher;
  private queue: TelemetryEnvelope[] = [];
  private isFlushScheduled = false;

  private constructor() {}

  public static getInstance(): TelemetryDispatcher {
    if (!TelemetryDispatcher.instance) {
      TelemetryDispatcher.instance = new TelemetryDispatcher();
    }
    return TelemetryDispatcher.instance;
  }

  public enqueue(event: TelemetryEnvelope) {
    // If critical, flush immediately
    if (event.severity === "critical") {
      this.flushSync(event);
      return;
    }

    this.queue.push(event);

    if (!this.isFlushScheduled) {
      this.isFlushScheduled = true;
      if (typeof window !== "undefined" && 'requestIdleCallback' in window) {
        (window as any).requestIdleCallback(() => this.flush(), { timeout: 1000 });
      } else {
        setTimeout(() => this.flush(), 1000);
      }
    }
  }

  private flush() {
    this.isFlushScheduled = false;
    if (this.queue.length === 0) return;

    const eventsToFlush = [...this.queue];
    this.queue = [];

    // Batch upload logic would go here
    // console.log(`[TelemetryDispatcher] Batched ${eventsToFlush.length} events.`);
  }

  private flushSync(event: TelemetryEnvelope) {
    // console.log(`[TelemetryDispatcher] Urgent flush:`, event);
  }
}
