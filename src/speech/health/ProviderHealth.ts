/**
 * Provider Health — AURA Voice Runtime v1.0, Phase 1.
 *
 * Static evaluation only. No networking. Combines:
 *  - credential status (CredentialManager), and
 *  - device capability probing (browser speech APIs).
 *
 * "Initializing" is a reserved state for later phases — never produced here.
 */

import type { ProviderRegistry } from "../registry/ProviderRegistry";
import type { CredentialManager } from "../credentials/CredentialManager";
import { CredentialRequirement, HealthState, type HealthEvaluation } from "../types/metadata";
import { TransportMode } from "../types/capabilities";

interface BrowserProbe {
  speechRecognition: boolean;
  speechSynthesis: boolean;
}

/**
 * TODO(AURA): Legacy fallback — flag for removal once Gemini Native is exclusive.
 * Static device probe, cached for the page lifetime. 
 */
function probeBrowserSpeech(): BrowserProbe {
  if (typeof window === "undefined") {
    return { speechRecognition: false, speechSynthesis: false };
  }
  const SR =
    (window as unknown as Record<string, unknown>).SpeechRecognition ??
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  return {
    speechRecognition: Boolean(SR),
    speechSynthesis: typeof window.speechSynthesis !== "undefined",
  };
}

export class ProviderHealth {
  private readonly probe: BrowserProbe;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly credentials: CredentialManager,
  ) {
    this.probe = probeBrowserSpeech();
  }

  /** Static health for a single provider. */
  evaluate(providerId: string): HealthEvaluation {
    const descriptor = this.registry.get(providerId);
    if (!descriptor) {
      return { providerId, state: HealthState.Unavailable, reason: "Unknown provider" };
    }

    // Browser-managed providers depend on device APIs, not credentials.
    if (descriptor.transportMode === TransportMode.BrowserNative) {
      const wantsInput = descriptor.capabilities.speechInput;
      const wantsOutput = descriptor.capabilities.speechOutput;
      const hasInput = this.probe.speechRecognition;
      const hasOutput = this.probe.speechSynthesis;
      if (wantsInput && !hasInput && wantsOutput && !hasOutput) {
        return {
          providerId,
          state: HealthState.Unsupported,
          reason: "No browser speech APIs available",
        };
      }
      if (wantsInput && !hasInput) {
        return {
          providerId,
          state: HealthState.Unsupported,
          reason: "SpeechRecognition not available in this browser",
        };
      }
      if (wantsOutput && !hasOutput) {
        return {
          providerId,
          state: HealthState.Unsupported,
          reason: "speechSynthesis has no voices in this browser",
        };
      }
      return { providerId, state: HealthState.Available };
    }

    // Credential-driven providers.
    if (descriptor.credentialRequirement === CredentialRequirement.Managed) {
      return { providerId, state: HealthState.Available, reason: "Credential managed internally" };
    }
    if (descriptor.credentialRequirement === CredentialRequirement.None) {
      return { providerId, state: HealthState.Available };
    }

    const status = this.credentials.getStatus(providerId);
    if (status === "available") {
      return { providerId, state: HealthState.Available };
    }
    return { providerId, state: HealthState.MissingCredential, reason: "API key missing" };
  }

  /** Static health for every registered provider. */
  evaluateAll(): Record<string, HealthEvaluation> {
    const result: Record<string, HealthEvaluation> = {};
    for (const descriptor of this.registry.all()) {
      result[descriptor.id] = this.evaluate(descriptor.id);
    }
    return result;
  }
}
