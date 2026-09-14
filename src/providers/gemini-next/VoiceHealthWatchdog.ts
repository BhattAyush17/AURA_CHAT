import { GeminiVoiceEngine } from "./GeminiVoiceEngine";
import { MicrophoneCoordinator } from "../../audioRuntime/MicrophoneCoordinator";
import { ConversationStateManager } from "../../runtime/ConversationStateManager";
import { auraTelemetry } from "@/telemetry/RuntimeTelemetry";
import { ENDPOINTS } from "@/config/api";

export type WatchdogReason =
  | "CONNECTION_STALL"
  | "RESPONSE_STALL"
  | "MICROPHONE_STALL"
  | "COGNITION_STALL";

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
  private backendHealthTimer: number | null = null;
  private lastPlaybackTime: number = Date.now();
  private isRunning: boolean = false;
  private thinkingStartTime: number = 0;

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
    // Poll backend health every 5 seconds
    this.backendHealthTimer = window.setInterval(() => this.checkBackendHealth(), 5000);
  }

  public stop() {
    this.isRunning = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.backendHealthTimer !== null) {
      clearInterval(this.backendHealthTimer);
      this.backendHealthTimer = null;
    }
  }

  public reportPlaybackActive() {
    this.lastPlaybackTime = Date.now();
  }

  private async checkBackendHealth() {
    if (!this.isRunning) return;
    try {
      const response = await fetch(ENDPOINTS.health);
      if (!response.ok) {
        throw new Error("Backend unreachable");
      }
      const data = await response.json();
      if (data.redis_active === false) {
        auraTelemetry.recordError({
          code: "backend_degraded",
          message: "Redis unavailable — operating in synchronous fallback mode",
        });
      }
    } catch (e) {
      auraTelemetry.recordError({
        code: "backend_unreachable",
        message: "Backend is completely unreachable",
      });
    }
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

    // Check Cognition Stall (THINKING state locked)
    const convStateMgr = ConversationStateManager.getInstance();
    if (convStateMgr.getState() === "THINKING") {
      if (this.thinkingStartTime === 0) {
        this.thinkingStartTime = now;
      } else if (now - this.thinkingStartTime > 20000) {
        console.error(
          "[VoiceHealthWatchdog] COGNITION_STALL: Stuck in THINKING for > 20s. Forcing IDLE.",
        );
        // Emit error to telemetry (using console.error which is caught, or auraTelemetry if available)
        auraTelemetry.recordError({ code: "cognition_stall" });
        convStateMgr.forceIdle();
        this.onRecover("COGNITION_STALL");
        this.thinkingStartTime = 0;
        return;
      }
    } else {
      this.thinkingStartTime = 0;
    }
  }
}
