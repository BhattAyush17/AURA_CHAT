/**
 * Trace envelope contract — AURA Voice Runtime v1.0, §3.2 (Trace Runtime).
 *
 * Contract only. No runtime wiring in Phase 1. Every future speech event
 * carries this envelope; every future utterance gets a trace with the
 * frozen stage chain below, from microphone capture to playback.
 */

/** Frozen trace stages — do not expand without an architecture review. */
export type TraceStage =
  | "mic-start"
  | "speech-start"
  | "first-partial"
  | "final"
  | "llm-start"
  | "first-token"
  | "tts-request"
  | "first-pcm"
  | "playback";

/** Envelope attached to every traced event. */
export interface TraceEnvelope {
  traceId: string;
  utteranceId: string;
  epoch: number;
  providerId: string;
  timestamp: number;
}

/** A single stage observation within an utterance trace. */
export interface TracePoint extends TraceEnvelope {
  stage: TraceStage;
  /** Duration of this stage in ms, when known. */
  durationMs?: number;
}
