/**
 * Frozen speech event schema — AURA Voice Runtime v1.0, §6.1.
 *
 * This is the ONLY speech contract above the provider seam. Conversation
 * Runtime, Turn Engine, and every other consumer understand exactly these
 * events and nothing else. Provider names never appear in event payloads.
 *
 * Every event carries utteranceId + sequence + epoch (Law 12):
 *  - utteranceId: identifies the user turn.
 *  - sequence:    monotonic per utterance; supersession law — a higher
 *                 sequence supersedes any lower sequence event.
 *  - epoch:       monotonic per transport session; any event from an old
 *                 epoch is stale and must be dropped.
 */

/** Provider error codes — frozen. */
export enum ProviderErrorCode {
  RateLimit = "rate-limit",
  Auth = "auth",
  Network = "network",
  Decode = "decode",
  Timeout = "timeout",
  GestureRequired = "gesture-required",
  Unsupported = "unsupported",
}

/** Fields carried by every speech event. */
export interface SpeechEventEnvelope {
  utteranceId: string;
  sequence: number;
  epoch: number;
  /** Provider id — the only place a provider id may appear in the event path. */
  providerId: string;
  traceId: string;
  timestamp: number;
}

export interface SpeechStartedEvent extends SpeechEventEnvelope {
  type: "SpeechStarted";
}

export interface PartialTranscriptEvent extends SpeechEventEnvelope {
  type: "PartialTranscript";
  transcript: string;
  language?: string;
}

export interface TranscriptRevisionEvent extends SpeechEventEnvelope {
  type: "TranscriptRevision";
  /** Replaces the previously emitted partial for this utterance. */
  transcript: string;
}

export interface FinalTranscriptEvent extends SpeechEventEnvelope {
  type: "FinalTranscript";
  transcript: string;
  language: string;
  /** [0,1] — provider confidence; undefined when unknown. */
  confidence: number;
  /** Optional word-level evidence when the provider supports it. */
  evidence?: readonly { word: string; start: number; end: number }[];
}

export interface SpeechEndedEvent extends SpeechEventEnvelope {
  type: "SpeechEnded";
}

export interface ProviderErrorEvent extends SpeechEventEnvelope {
  type: "ProviderError";
  code: ProviderErrorCode;
  retryable: boolean;
  detail: string;
}

export type SpeechEvent =
  | SpeechStartedEvent
  | PartialTranscriptEvent
  | TranscriptRevisionEvent
  | FinalTranscriptEvent
  | SpeechEndedEvent
  | ProviderErrorEvent;

/** Output side — response segment for TTS providers. */
export interface ResponseSegment {
  text: string;
  style?: string;
}

/** Output side — raw audio for realtime/output providers. */
export interface OutputAudioFrame {
  pcm: Float32Array;
  sampleRate: number;
}
