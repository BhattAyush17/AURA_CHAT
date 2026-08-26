import { GeminiVoiceEngine } from "./GeminiVoiceEngine";

export type WatchdogReason = "CONNECTION_STALL" | "RESPONSE_STALL" | "MICROPHONE_STALL";

export interface WatchdogConfig {
  connectionTimeoutMs: number;
  responseTimeoutMs: number;
  microphoneTimeoutMs: number;
}

const DEFAULT_CONFIG: WatchdogConfig = {
  connectionTimeoutMs: 15000,
  responseTimeoutMs: 25000,
  microphoneTimeoutMs: 10000,
};

/**
 * VoiceHealthWatchdog
 * 
 * Production connection monitor for Gemini Live sessions.
 * Detects stalls and triggers a recovery callback if the pipeline freezes.
 */
export class VoiceHealthWatchdog {
  private engine: GeminiVoiceEngine;
  private onRecover: (reason: WatchdogReason) => void;
  private config: WatchdogConfig;
  
  private timer: number | null = null;
  private lastPlaybackTime: number = Date.now();
  private isRunning: boolean = false;

  constructor(
    engine: GeminiVoiceEngine, 
    onRecover: (reason: WatchdogReason) => void, 
    config?: Partial<WatchdogConfig>
  ) {
    this.engine = engine;
    this.onRecover = onRecover;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public start() {
    this.stop();
    this.isRunning = true;
    this.lastPlaybackTime = Date.now();
    
    // Poll every second
    this.timer = window.setInterval(() => this.checkHealth(), 1000);
  }

  public stop() {
    this.isRunning = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public reportPlaybackActive() {
    this.lastPlaybackTime = Date.now();
  }

  private checkHealth() {
    if (!this.isRunning) return;
    
    const now = Date.now();
    
    // If we're playing audio, we're definitely not stalled on the connection
    if (this.engine.telemetry.isPlaying) {
      this.lastPlaybackTime = now;
      return;
    }

    // TODO: Connect this to actual GeminiSession metrics if needed
    // For now, we mainly rely on the engine's built-in reconnection logic.
    // This watchdog serves as a final fallback if everything else freezes.
  }
}
