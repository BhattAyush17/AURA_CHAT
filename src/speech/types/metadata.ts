/**
 * Provider metadata model — AURA Voice Runtime v1.0, Phase 1.
 *
 * The Provider Registry exposes ONLY metadata. It never instantiates
 * providers. Provider ids are plain strings defined exclusively in
 * registry/providers.ts — no provider names may appear anywhere else.
 */

import type { CredentialKey } from "@/lib/credentials";
import type { SpeechCapabilities, TransportMode, EndpointControl } from "./capabilities";

/** Relative latency class. 1 = fastest, 4 = slowest. */
export enum LatencyClass {
  L1 = 1,
  L2 = 2,
  L3 = 3,
  L4 = 4,
}

/** Relative cost class. 1 = cheapest, 4 = most expensive. */
export enum CostClass {
  C1 = 1,
  C2 = 2,
  C3 = 3,
  C4 = 4,
}

/**
 * How a provider's credential is obtained.
 *  - userKey: the end user supplies a key (sessionStorage, never server).
 *  - managed: the provider manages its own credential internally
 *             (Gemini Native reports "managed internally").
 *  - none:    no credential required (Browser).
 */
export enum CredentialRequirement {
  UserKey = "userKey",
  Managed = "managed",
  None = "none",
}

/** Static credential availability as seen by the Credential Manager. */
export enum CredentialStatus {
  Available = "available",
  Missing = "missing",
  Managed = "managed",
  NotApplicable = "not-applicable",
}

/** Static provider health state (no networking — capability/credential evaluation only). */
export enum HealthState {
  Available = "available",
  Unavailable = "unavailable",
  MissingCredential = "missing-credential",
  Unsupported = "unsupported",
  Initializing = "initializing",
}

/**
 * Frozen registration shape. Every provider in the registry registers
 * exactly these fields. Adding a provider requires zero application code
 * changes — only a new descriptor in registry/providers.ts.
 */
export interface ProviderDescriptor {
  /** Provider id — defined only in the registry module. */
  id: string;
  /** Human-readable name for UI surfaces. */
  displayName: string;
  capabilities: SpeechCapabilities;
  credentialRequirement: CredentialRequirement;
  /** sessionStorage key — present only when credentialRequirement === UserKey. */
  credentialKey?: CredentialKey;
  /** Supported speech languages (STT side). May be empty for non-speech providers. */
  languages: readonly string[];
  endpointControl: EndpointControl;
  latencyClass: LatencyClass;
  costClass: CostClass;
  transportMode: TransportMode;
}

/** Result of a static health evaluation. */
export interface HealthEvaluation {
  providerId: string;
  state: HealthState;
  /** Short human-readable reason, e.g. "requires Groq API key". */
  reason?: string;
}

/** Capability summary for the Voice Settings surface. */
export interface CapabilitySummary {
  descriptor: ProviderDescriptor;
  health: HealthEvaluation;
  credentialStatus: CredentialStatus;
}
