import type { AuraSense, RawSenseObservation, SenseHealth, SenseManifest, SenseStatusCode } from "./types";

export abstract class BaseSense implements AuraSense {
  abstract readonly manifest: SenseManifest;

  protected _health: SenseHealth = {
    status: "disconnected",
    latency: 0,
    provider: null,
    lastHeartbeat: 0,
    lastObservation: 0,
    errorCount: 0
  };
  
  protected _initialized: boolean = false;

  // Subclasses must implement these
  abstract initialize(): Promise<void>;
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract dispose(): Promise<void>;
  abstract collectContext(): Promise<RawSenseObservation | null>;

  health(): SenseHealth {
    return { ...this._health, lastHeartbeat: Date.now() };
  }

  protected setStatus(
    status: SenseStatusCode,
    provider?: string | null,
    degradedReason?: string
  ): void {
    this._health = { 
      ...this._health, 
      status, 
      provider: provider !== undefined ? provider : this._health.provider,
      degradedReason 
    };
  }

  protected recordError(reason: string) {
    this._health.errorCount++;
    this.setStatus('error', undefined, reason);
  }
}
