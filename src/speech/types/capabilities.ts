/**
 * Frozen capability vocabulary (AURA Voice Runtime v1.0, §6.2).
 *
 * No arbitrary capability strings. Every capability is a typed field on
 * SpeechCapabilities; classified dimensions use explicit enums in metadata.ts.
 * This vocabulary must not drift without an architecture review.
 */

/**
 * Where the provider actually runs. This is a runtime class, never a
 * provider name — provider names live only in the Provider Registry.
 */
export enum ProviderRuntimeClass {
  Browser = "browser", // browser-managed APIs (SpeechRecognition, speechSynthesis)
  Cloud = "cloud", // remote API
  Local = "local", // on-device inference
}

/**
 * The provider's transport mechanism.
 */
export enum TransportMode {
  BrowserNative = "browser-native",
  Http = "http",
  WebSocket = "websocket",
  WebRtc = "webrtc",
  RealtimeSession = "realtime-session",
}

/**
 * Who decides when a turn ends. Frozen semantics:
 *  - provider: the provider autonomously emits FinalTranscript (Browser STT).
 *  - runtime:  a final is only produced when the runtime calls endUtterance()
 *              (Groq pseudo-stream, Sarvam REST — VAD boundary via Media's VAD).
 *  - none:     the provider never emits finals; the Turn Engine decides turns
 *              (Realtime sessions).
 */
export enum EndpointControl {
  Provider = "provider",
  Runtime = "runtime",
  None = "none",
}

/**
 * Frozen capability set. All fields are required — no optional drift.
 */
export interface SpeechCapabilities {
  /** Produces transcripts (STT side of the seam). */
  speechInput: boolean;
  /** Produces audio/segments (TTS side of the seam). */
  speechOutput: boolean;
  /** Full-duplex session: audio in AND audio out in one session (Gemini Live, OpenAI Realtime). */
  realtime: boolean;
  /** Emits chunked/final results progressively rather than only at the end. */
  streaming: boolean;
  /** Emits PartialTranscript events. */
  partials: boolean;
  /** Emits TranscriptRevision events (stable-prefix agreement). */
  revisions: boolean;
  /** Works without a network connection. */
  offline: boolean;
  /** Runs on-device. */
  local: boolean;
  /** Playback/output can be interrupted (barge-in). */
  interruptible: boolean;
  /** Provides word-level timestamps. */
  wordTimestamps: boolean;
  /** Requires a user gesture before the provider can start (iOS/mobile). */
  gestureRequired: boolean;
  /** Output includes raw audio frames (OutputAudioFrame). */
  audioOutput: boolean;
}
