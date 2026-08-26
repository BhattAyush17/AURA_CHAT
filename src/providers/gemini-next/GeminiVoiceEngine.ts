import { GeminiSession } from "./GeminiSession";
import { GeminiAudioInput } from "./GeminiAudioInput";
import { GeminiAudioOutput } from "./GeminiAudioOutput";
import { VoiceEngineConfig, VoiceEngineEvents, GeminiSessionState, VoiceTelemetry } from "./GeminiTypes";

export class GeminiVoiceEngine {
  private config: VoiceEngineConfig;
  private events: VoiceEngineEvents;
  
  private session: GeminiSession | null = null;
  private input: GeminiAudioInput;
  private output: GeminiAudioOutput;

  private state: GeminiSessionState = "IDLE";
  private isAuraSpeaking: boolean = false;
  private turnCounter: number = 0;
  private inputPathVerified: boolean = false;

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

  public async start(): Promise<void> {
    if (this.state !== "IDLE" && this.state !== "ERROR" && this.state !== "CLOSED") return;
    this.updateState("CONNECTING");
    this.inputPathVerified = false;

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
            this.output.stopPlayback();
          }
          this.updateState(state);
          // Report gemini_session milestone on CONNECTED
          if (state === "CONNECTED") {
            this.events.onMilestone?.("gemini_session", "complete");
          }
        },
        onAudioChunkReceived: (base64Data) => {
          this.telemetry.lastServerMessageAt = Date.now();
          this.telemetry.lastResponseAudioAt = Date.now();
          this.telemetry.isPlaying = true;
          if (!this.isAuraSpeaking) {
            this.isAuraSpeaking = true;
          }
          this.output.enqueueChunk(base64Data, () => {
             // Chunk playback ended. We handle overall turn via onTurnComplete
             this.telemetry.isPlaying = false;
          });
          this.events.onAudioChunkReceived?.(base64Data);
        },
        onModelText: (text) => {
          this.telemetry.lastServerMessageAt = Date.now();
          this.events.onModelText?.(text);
        },
        onInputTranscription: (text) => {
          this.telemetry.lastServerMessageAt = Date.now();
          this.events.onInputTranscription?.(text);
        },
        onInterrupted: () => {
          this.telemetry.lastServerMessageAt = Date.now();
          this.telemetry.isPlaying = false;
          this.isAuraSpeaking = false;
          this.output.stopPlayback();
          this.events.onInterrupted?.();
        },
        onTurnComplete: () => {
          this.telemetry.lastServerMessageAt = Date.now();
          this.telemetry.lastTurnCompleteAt = Date.now();
          this.telemetry.isPlaying = false;
          this.isAuraSpeaking = false;
          this.turnCounter++;
          this.events.onTurnComplete?.();
        },
        onToolCall: async (calls) => {
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
        }
      });

      // 4. Connect to Gemini Live
      await this.session.connect();

      // 5. Start streaming audio to session — verify input path
      this.events.onMilestone?.("input_path", "in_progress");
      this.input.startStreaming((base64Data) => {
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
      });

    } catch (err: any) {
      this.updateState("ERROR");
      this.events.onError?.(err);
      throw err;
    }
  }

  public stop(): void {
    this.telemetry.isCapturing = false;
    this.telemetry.isPlaying = false;
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

  public sendText(text: string): void {
    if (this.session?.getState() === "CONNECTED") {
      this.session.sendRealtimeInput({ text });
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
