import { GeminiVoiceEngine } from "./GeminiVoiceEngine";
import { MicrophoneCoordinator } from "../../audioRuntime/MicrophoneCoordinator";
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
    config?: Partial<WatchdogConfig>,
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

    // Check Microphone Stream
    if (this.engine.telemetry.isCapturing) {
      const micCoordinator = MicrophoneCoordinator.getInstance();
      const micStream = micCoordinator.getStream();
      if (!micStream || !micStream.active) {
        console.error(
          "[VoiceHealthWatchdog] MICROPHONE_STALL detected: Stream inactive while capturing is true.",
        );
        this.onRecover("MICROPHONE_STALL");
        return;
      }
    }

    // Check Connection Stall
    if (this.engine.getState() === "CONNECTING") {
      if (now - this.lastPlaybackTime > this.config.connectionTimeoutMs) {
        console.error(
          `[VoiceHealthWatchdog] CONNECTION_STALL: In CONNECTING state for > ${this.config.connectionTimeoutMs}ms`,
        );
        this.onRecover("CONNECTION_STALL");
        return;
      }
    }

    // Check Response Stall
    if (this.engine.getState() === "CONNECTED" && !this.engine.telemetry.isPlaying) {
      // If we are connected and it's been a long time since we received a server message or played audio
      const timeSinceLastMessage = now - this.engine.telemetry.lastServerMessageAt;
      // We only flag a response stall if lastServerMessageAt > 0, meaning we at least connected fully once.
      if (
        timeSinceLastMessage > this.config.responseTimeoutMs &&
        this.engine.telemetry.lastServerMessageAt > 0
      ) {
        console.error(
          `[VoiceHealthWatchdog] RESPONSE_STALL: No server messages or audio for > ${this.config.responseTimeoutMs}ms`,
        );
        this.onRecover("RESPONSE_STALL");
        return;
      }
    }
  }
}
