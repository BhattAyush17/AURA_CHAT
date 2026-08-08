/**
 * The frozen provider registry data — AURA Voice Runtime v1.0.
 *
 * This is the ONLY place provider names and metadata live. Adding a provider
 * means adding one descriptor here; application logic never changes.
 *
 * The registry NEVER instantiates providers — metadata only.
 */

import type { ProviderDescriptor } from "../types/metadata";
import { CredentialRequirement, CostClass, LatencyClass } from "../types/metadata";
import { EndpointControl, TransportMode } from "../types/capabilities";

export const PROVIDER_BROWSER = "browser";
export const PROVIDER_GROQ = "groq";
export const PROVIDER_SARVAM = "sarvam";
export const PROVIDER_OPENROUTER = "openrouter";
export const PROVIDER_GEMINI = "gemini-native";

/**
 * Frozen provider descriptors.
 *
 * Notes:
 *  - browser: endpointControl "provider" — Chrome/Safari SpeechRecognition
 *    auto-finalizes on its own silence policy. Browser STT is cloud-backed,
 *    browser TTS is local; offline/local are flagged conservatively.
 *  - groq: endpointControl "runtime" — Groq has no native streaming endpoint;
 *    the runtime triggers the final via endUtterance() on Media's VAD boundary
 *    (Law 6). Partial/revision events come from the pseudo-stream agreement
 *    (Phase 3).
 *  - sarvam: endpointControl "runtime" — REST blob transcription; the runtime
 *    decides the utterance boundary, then uploads.
 *  - openrouter: a brain (LLM) provider — registered for credential/health
 *    surfaces only; it has no speech capabilities.
 *  - gemini-native: realtime session, endpointControl "none" — continuous
 *    partials; the Turn Engine decides turns. Credential is managed
 *    internally ("reports managed internally").
 */
export const PROVIDER_DESCRIPTORS: readonly ProviderDescriptor[] = [
  {
    id: PROVIDER_BROWSER,
    displayName: "Browser",
    capabilities: {
      speechInput: true,
      speechOutput: true,
      realtime: false,
      streaming: true,
      partials: true,
      revisions: false,
      offline: false,
      local: false,
      interruptible: true,
      wordTimestamps: false,
      gestureRequired: true,
      audioOutput: false,
    },
    credentialRequirement: CredentialRequirement.None,
    languages: ["en", "en-IN", "hi", "hi-IN"],
    endpointControl: EndpointControl.Provider,
    latencyClass: LatencyClass.L2,
    costClass: CostClass.C1,
    transportMode: TransportMode.BrowserNative,
  },
  {
    id: PROVIDER_GROQ,
    displayName: "Groq",
    capabilities: {
      speechInput: true,
      speechOutput: false,
      realtime: false,
      streaming: true, // pseudo-stream (trailing-window re-POST)
      partials: true,
      revisions: true, // stable-prefix agreement
      offline: false,
      local: false,
      interruptible: true,
      wordTimestamps: true,
      gestureRequired: false,
      audioOutput: false,
    },
    credentialRequirement: CredentialRequirement.UserKey,
    credentialKey: "groq_api_key",
    languages: ["en", "hi"],
    endpointControl: EndpointControl.Runtime,
    latencyClass: LatencyClass.L2,
    costClass: CostClass.C2,
    transportMode: TransportMode.Http,
  },
  {
    id: PROVIDER_SARVAM,
    displayName: "Sarvam",
    capabilities: {
      speechInput: true,
      speechOutput: true,
      realtime: false,
      streaming: false,
      partials: false,
      revisions: false,
      offline: false,
      local: false,
      interruptible: true,
      wordTimestamps: false,
      gestureRequired: false,
      audioOutput: false,
    },
    credentialRequirement: CredentialRequirement.UserKey,
    credentialKey: "sarvam_api_key",
    languages: ["en-IN", "hi-IN"],
    endpointControl: EndpointControl.Runtime,
    latencyClass: LatencyClass.L3,
    costClass: CostClass.C2,
    transportMode: TransportMode.Http,
  },
  {
    id: PROVIDER_OPENROUTER,
    displayName: "OpenRouter",
    capabilities: {
      speechInput: false,
      speechOutput: false,
      realtime: false,
      streaming: true, // SSE LLM streaming
      partials: false,
      revisions: false,
      offline: false,
      local: false,
      interruptible: true,
      wordTimestamps: false,
      gestureRequired: false,
      audioOutput: false,
    },
    credentialRequirement: CredentialRequirement.UserKey,
    credentialKey: "openrouter_api_key",
    languages: [],
    endpointControl: EndpointControl.None, // not a speech provider
    latencyClass: LatencyClass.L3,
    costClass: CostClass.C2,
    transportMode: TransportMode.Http,
  },
  {
    id: PROVIDER_GEMINI,
    displayName: "Gemini Native",
    capabilities: {
      speechInput: true,
      speechOutput: true,
      realtime: true,
      streaming: true,
      partials: true,
      revisions: false,
      offline: false,
      local: false,
      interruptible: true,
      wordTimestamps: false,
      gestureRequired: false,
      audioOutput: true,
    },
    credentialRequirement: CredentialRequirement.Managed,
    languages: ["en", "hi"],
    endpointControl: EndpointControl.None,
    latencyClass: LatencyClass.L1,
    costClass: CostClass.C3,
    transportMode: TransportMode.WebRtc,
  },
];
