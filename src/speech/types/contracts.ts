/**
 * Frozen provider contracts — AURA Voice Runtime v1.0.
 *
 * Interfaces ONLY. No implementations in Phase 1.
 *
 * Law 4: providers are framework-free modules — never React hooks.
 * Law 5: shared networking mechanics belong to ProviderTransport, never to
 *        individual providers.
 * Law 7: no provider emits raw transcripts upward — a SpeechEventAssembler
 *        normalizes provider output before it reaches the Turn Engine.
 */

import type {
  SpeechEventEnvelope,
  FinalTranscriptEvent,
  ResponseSegment,
  OutputAudioFrame,
} from "./events";
import type { SpeechCapabilities } from "./capabilities";

/** Initialization for an input (STT) session. */
export interface InputProviderInit {
  language: string;
  traceId: string;
  epoch: number;
}

/** A live STT session. One per active listener. */
export interface InputSession {
  /** Feed 16kHz mono PCM frames (20–40ms) from Media Runtime. */
  pushPcm(frame: Float32Array): void;
  /** VAD onset — begin an utterance. */
  beginUtterance(): void;
  /** VAD boundary — request the final transcript (endpointControl: runtime). */
  endUtterance(): Promise<FinalTranscriptEvent>;
  /** Barge-in / focus loss — discard the current utterance, keep the session. */
  abortUtterance(): void;
  /** Release the session and its lease. */
  close(): void;
}

/** A speech-input provider. Framework-free; reacts only via session methods. */
export interface SpeechInputProvider {
  readonly id: string;
  open(init: InputProviderInit): Promise<InputSession>;
}

/** Initialization for an output (TTS) session. */
export interface OutputProviderInit {
  traceId: string;
  epoch: number;
}

/** A live TTS session. */
export interface OutputSession {
  enqueueSegment(segment: ResponseSegment): void;
  enqueueAudioFrame(frame: OutputAudioFrame): void;
  /** Immediate stop (barge-in reflex from Media Runtime). */
  cancel(): void;
  close(): void;
}

/** A speech-output provider. */
export interface SpeechOutputProvider {
  readonly id: string;
  open(init: OutputProviderInit): Promise<OutputSession>;
}

/** Transport session returned by ProviderTransport.connect(). */
export interface TransportSession {
  readonly epoch: number;
  send(payload: unknown): Promise<void>;
  close(): Promise<void>;
}

/** Connection mechanics configuration (retry/backoff/lease). */
export interface TransportConfig {
  providerId: string;
  url?: string;
  headers?: Record<string, string>;
  retries?: number;
  backoffMs?: number;
  leaseTtlMs?: number;
}

/**
 * Shared networking mechanics — Law 5.
 * Reconnect, retry, lease, TTL, backoff, heartbeat, single-flight live here.
 * Policy (warmup, readiness, failover, debt, provider selection) NEVER lives here.
 */
export interface ProviderTransport {
  connect(cfg: TransportConfig): Promise<TransportSession>;
}

/** Provider-independent credential surface (Phase 1 implementation: CredentialManager). */
export interface CredentialProvider {
  getStatus(providerId: string): import("./metadata").CredentialStatus;
  get(providerId: string): string | null;
  set(providerId: string, value: string): void;
}

/** Utterance envelope base for all session events (superset of SpeechEventEnvelope). */
export type UtteranceEventEnvelope = SpeechEventEnvelope;

/** Capability descriptor a transport must expose (mirrors SpeechCapabilities). */
export type ProviderCapabilities = SpeechCapabilities;
