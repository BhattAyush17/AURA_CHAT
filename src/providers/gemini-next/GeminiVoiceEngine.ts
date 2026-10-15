import { GeminiSession } from "./GeminiSession";
import { GeminiAudioInput } from "./GeminiAudioInput";
import { GeminiAudioOutput } from "./GeminiAudioOutput";
import {
  VoiceEngineConfig,
  VoiceEngineEvents,
  GeminiSessionState,
  VoiceTelemetry,
} from "./GeminiTypes";
import { playbackState } from "../../music/PlaybackState";

export class GeminiVoiceEngine {
  private config: VoiceEngineConfig;
  private events: VoiceEngineEvents;

  private session: GeminiSession | null = null;
  private input: GeminiAudioInput;
  private output: GeminiAudioOutput;

  private state: GeminiSessionState = "IDLE";
  private isAuraSpeaking: boolean = false;
  private turnCounter: number = 0;
  private suppressCancelledOutput = false;
  private autonomousInFlight = false;
  private inputPathVerified: boolean = false;
  private lastAuraSpeechTimestamp: number = 0;
  private turnNonce: number = 0;
  // After AURA finishes speaking, her own voice rings/off briefly through the
  // speakers into the mic. Streaming that echo tail to the server makes its VAD
  // think the user spoke and the model regenerates the same answer — the
  // audible repetition bug. Gate mic PCM to the server for this window.
  private echoTailUntil: number = 0;

  // Playback tracking to prevent VAD unmute during buffered audio
  private chunksPlaying: number = 0;
  private serverTurnComplete: boolean = false;

  public readonly telemetry: VoiceTelemetry = {
    lastInputSendAt: 0,
    lastServerMessageAt: 0,
    lastResponseAudioAt: 0,
    lastTurnCompleteAt: 0,
    lastErrorAt: 0,
    isCapturing: false,
    isPlaying: false,
  };

  constructor(config: VoiceEngineConfig, events: VoiceEngineEvents) {
    this.config = config;
    this.events = events;
    this.input = new GeminiAudioInput();
    this.output = new GeminiAudioOutput();
  }

  private checkTurnEnded() {
    if (this.serverTurnComplete && this.chunksPlaying === 0) {
      this.telemetry.isPlaying = false;
      this.isAuraSpeaking = false;
      this.suppressCancelledOutput = false;
      this.autonomousInFlight = false;
      const isMusicPlaying = playbackState.getState().isPlaying;
      this.input.setVadState(true, false, false, isMusicPlaying);
      this.lastAuraSpeechTimestamp = Date.now();
      this.echoTailUntil = Date.now() + 600;
      this.events.onTurnComplete?.();
      this.serverTurnComplete = false;
    }
  }

  public async start(): Promise<void> {
    if (this.state !== "IDLE" && this.state !== "ERROR" && this.state !== "CLOSED") return;
    this.updateState("CONNECTING");
    this.inputPathVerified = false;
    this.suppressCancelledOutput = false;
    this.autonomousInFlight = false;
    this.chunksPlaying = 0;
    this.serverTurnComplete = false;

    try {
      // 1. Acquire Audio Context & Microphone
      this.events.onMilestone?.("microphone", "in_progress");
      const { audioContext, analyser } = await this.input.acquire();
      this.events.onMilestone?.("microphone", "complete");

      // 2. Initialize Output
      this.events.onMilestone?.("audio_output", "in_progress");
      this.output.initialize(audioContext, analyser);
      this.events.onMilestone?.("audio_output", "complete");

      // 3. Setup Session
      this.events.onMilestone?.("gemini_session", "in_progress");
      this.session = new GeminiSession(this.config, {
        onStateChange: (state) => {
          if (state === "CONNECTING") {
            // Increment nonce on new connection/reconnect to invalidate any pending
            // callbacks from the previous session. This ensures stale audio chunks
            // from a disconnected session don't play after reconnect.
            this.turnNonce++;
            this.chunksPlaying = 0;
            this.serverTurnComplete = false;
            this.isAuraSpeaking = false;
            this.telemetry.isPlaying = false;
            this.telemetry.lastServerMessageAt = 0;
            this.output.stopPlayback();
          }
          this.updateState(state);
          // Report gemini_session milestone on CONNECTED
          if (state === "CONNECTED") {
            this.events.onMilestone?.("gemini_session", "complete");
            const isMusicPlaying = playbackState.getState().isPlaying;
            this.input.setVadState(true, false, false, isMusicPlaying);
          }
        },
        onAudioChunkReceived: (base64Data) => {
          if (this.suppressCancelledOutput) return;
          this.telemetry.lastServerMessageAt = Date.now();
          this.telemetry.lastResponseAudioAt = Date.now();
          this.telemetry.isPlaying = true;
          if (!this.isAuraSpeaking) {
            this.isAuraSpeaking = true;
            const isMusicPlaying = playbackState.getState().isPlaying;
            this.input.setVadState(false, true, false, isMusicPlaying);
            this.events.onAuraSpeechStart?.();
          }

          this.chunksPlaying++;
          const currentNonce = this.turnNonce;
          this.output.enqueueChunk(base64Data, () => {
            if (this.turnNonce !== currentNonce) return;
            this.chunksPlaying = Math.max(0, this.chunksPlaying - 1);
            if (this.chunksPlaying === 0) {
              this.telemetry.isPlaying = false;
            }
            this.checkTurnEnded();
          });
          this.events.onAudioChunkReceived?.(base64Data);
        },
        onModelText: (text) => {
          if (this.suppressCancelledOutput) return;
          this.telemetry.lastServerMessageAt = Date.now();
          if (!this.isAuraSpeaking) {
            this.isAuraSpeaking = true;
            const isMusicPlaying = playbackState.getState().isPlaying;
            this.input.setVadState(false, true, false, isMusicPlaying);
            this.events.onAuraSpeechStart?.();
          }
          this.events.onModelText?.(text);
        },
        onOutputTranscription: (text) => {
          if (this.suppressCancelledOutput) return;
          this.telemetry.lastServerMessageAt = Date.now();
          if (!this.isAuraSpeaking) {
            this.isAuraSpeaking = true;
            const isMusicPlaying = playbackState.getState().isPlaying;
            this.input.setVadState(false, true, false, isMusicPlaying);
            this.events.onAuraSpeechStart?.();
          }
          this.events.onOutputTranscription?.(text);
        },
        onInputTranscription: (text) => {
          this.telemetry.lastServerMessageAt = Date.now();
          this.events.onInputTranscription?.(text);
        },
        onInterrupted: () => {
          this.suppressCancelledOutput = false;
          this.autonomousInFlight = false;
          this.telemetry.lastServerMessageAt = Date.now();
          this.telemetry.isPlaying = false;
          this.isAuraSpeaking = false;
          this.chunksPlaying = 0;
          // Increment nonce on user interruption to invalidate pending audio callbacks
          // and prevent the interrupted response from continuing after barge-in.
          this.turnNonce++;
          this.serverTurnComplete = false;
          this.output.stopPlayback();
          const isMusicPlaying = playbackState.getState().isPlaying;
          this.input.setVadState(true, false, false, isMusicPlaying);
          this.lastAuraSpeechTimestamp = Date.now();
          this.events.onInterrupted?.();
        },
        onTurnComplete: () => {
          this.telemetry.lastServerMessageAt = Date.now();
          this.telemetry.lastTurnCompleteAt = Date.now();
          this.turnCounter++;
          // Generation can finish before buffered audio. Keep its callbacks valid
          // until playback drains; only explicit cancellation (interruption, reconnect, stop)
          // invalidates the nonce. DO NOT increment turnNonce here.
          this.serverTurnComplete = true;
          this.checkTurnEnded();
        },
        onToolCall: async (calls) => {
          if (this.suppressCancelledOutput) return [];
          if (this.events.onToolCall) {
            return this.events.onToolCall(calls);
          }
          return [];
        },
        onUsageMetadata: (meta) => {
          this.telemetry.lastServerMessageAt = Date.now();
          this.events.onUsageMetadata?.(meta);
        },
        onGoAway: () => {
          this.events.onGoAway?.();
        },
        onError: (err) => {
          this.telemetry.lastErrorAt = Date.now();
          this.events.onError?.(err);
        },
      });

      // 4. Connect to Gemini Live
      await this.session.connect();

      // 5. Start streaming audio to session — verify input path
      this.events.onMilestone?.("input_path", "in_progress");
      this.input.startStreaming(
        (base64Data) => {
          // Echo-tail gate: AURA's own output bleeds back into the mic for a
          // short window after her turn ends. Don't stream it to the server —
          // server-side VAD would treat it as a user turn and regenerate the
          // same answer (the repetition bug). The local barge-in guard below
          // uses the same 600ms window.
          if (Date.now() < this.echoTailUntil) return;
          this.telemetry.isCapturing = true;
          if (this.session?.getState() === "CONNECTED") {
            this.telemetry.lastInputSendAt = Date.now();
            this.session.sendRealtimeInput({
              audio: {
                mimeType: "audio/pcm;rate=16000",
                data: base64Data,
              },
            });
            // Mark input path verified on first successful send
            if (!this.inputPathVerified) {
              this.inputPathVerified = true;
              this.events.onMilestone?.("input_path", "complete");
              // Output path is ready once input is flowing and output infra is initialized
              this.events.onMilestone?.("output_path", "in_progress");
              this.events.onMilestone?.("output_path", "complete");
            }
          }
        },
        () => {
          // While AURA is speaking, mic PCM is already gated from the server,
          // so a local barge-in is unactionable there — and is usually her own
          // voice leaking back. Firing here would churn the turn nonce and
          // re-send the language enforcement directive mid-turn, causing the
          // model to re-answer.
          if (this.isAuraSpeaking && !this.autonomousInFlight) return;
          if (Date.now() - this.lastAuraSpeechTimestamp < 600) return;
          if (playbackState.getState().isPlaying) return;
          console.log("[GeminiVoiceEngine] Barge-in/speech confirmed via local VAD.");
          this.events.onUserSpeechDetected?.();
        },
      );
    } catch (err: any) {
      this.updateState("ERROR");
      this.events.onError?.(err);
      this.stop();
      throw err;
    }
  }

  public stop(): void {
    // Increment nonce on explicit stop to invalidate all pending callbacks
    this.turnNonce++;
    this.chunksPlaying = 0;
    this.serverTurnComplete = false;
    this.telemetry.isCapturing = false;
    this.telemetry.isPlaying = false;
    this.isAuraSpeaking = false;
    this.input.stopStreaming();
    this.output.stopPlayback();
    this.session?.disconnect();
    this.session = null;
    this.inputPathVerified = false;
    this.updateState("CLOSED");
  }

  public async destroy(): Promise<void> {
    this.stop();
    this.input.teardown();
  }

  public muteMicrophone(): void {
    this.input.mute();
  }

  public unmuteMicrophone(): void {
    this.input.unmute();
  }

  public setOutputVolume(gain: number): void {
    this.output.setVolume(gain);
  }

  public requestAutonomousResponse(text: string): boolean {
    if (this.isAuraSpeaking || this.autonomousInFlight || this.suppressCancelledOutput)
      return false;
    const accepted = this.session?.requestAutonomousResponse(text) ?? false;
    this.autonomousInFlight = accepted;
    return accepted;
  }

  public cancelAutonomousResponse(): void {
    if (!this.autonomousInFlight) return;
    this.suppressCancelledOutput = true;
    this.autonomousInFlight = false;
    this.turnNonce++;
    this.output.stopPlayback();
    this.chunksPlaying = 0;
    this.isAuraSpeaking = false;
    this.telemetry.isPlaying = false;
    this.input.setVadState(true, false, false, playbackState.getState().isPlaying);
  }

  public sendText(text: string): void {
    if (this.session?.getState() === "CONNECTED") {
      this.session.sendRealtimeInput({ text });
    }
  }

  /**
   * Injects internal cognition into the live session without triggering a
   * model response (see GeminiSession.injectContext). This is how cognitive
   * blocks / memories / executive directives reach Gemini mid-session —
   * never via sendText, which causes phantom spoken replies.
   */
  public injectContext(text: string): void {
    if (this.session?.getState() === "CONNECTED") {
      this.session.injectContext(text);
    }
  }

  public getState(): GeminiSessionState {
    return this.state;
  }

  public getInputFrequencyData(): Uint8Array {
    return this.input.getFrequencyData();
  }

  public getOutputFrequencyData(): Uint8Array {
    return this.output.getOutputFrequencyData();
  }

  private updateState(newState: GeminiSessionState) {
    this.state = newState;
    this.events.onStateChange?.(newState);
  }
}
