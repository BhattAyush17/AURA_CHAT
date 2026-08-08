/**
 * Voice Settings — AURA Voice Runtime v1.0, Phase 1.
 *
 * Provider-independent settings surface. The UI asks "current STT provider",
 * "current TTS provider", "available providers", "credential status",
 * "capability summary" — without knowing implementation details.
 *
 * The active brain is read from localStorage (aura_active_brain, existing
 * app key). The brain → provider-chain mapping below is a static table of
 * CURRENT application behavior; it is settings knowledge, not provider logic.
 */

import type { ProviderRegistry } from "../registry/ProviderRegistry";
import type { ProviderHealth } from "../health/ProviderHealth";
import type { CredentialManager } from "../credentials/CredentialManager";
import {
  CredentialStatus,
  type CapabilitySummary,
  type ProviderDescriptor,
} from "../types/metadata";

export type Brain = "gemini" | "openrouter" | "sarvam";

const BRAIN_KEY = "aura_active_brain";

const DEFAULT_BRAIN: Brain = "gemini";

/**
 * Current application behavior: which STT/TTS provider chain each brain uses.
 * gemini → gemini-native (realtime session, both sides).
 * openrouter → browser STT + browser TTS.
 * sarvam → browser STT + sarvam TTS.
 */
const BRAIN_CHAIN: Record<Brain, { stt: string; tts: string }> = {
  gemini: { stt: "gemini-native", tts: "gemini-native" },
  openrouter: { stt: "browser", tts: "browser" },
  sarvam: { stt: "browser", tts: "sarvam" },
};

export class VoiceSettings {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly health: ProviderHealth,
    private readonly credentials: CredentialManager,
  ) {}

  /** Active brain, normalized. */
  getActiveBrain(): Brain {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(BRAIN_KEY) : null;
    return saved === "gemini" || saved === "openrouter" || saved === "sarvam"
      ? saved
      : DEFAULT_BRAIN;
  }

  /** The provider currently used for transcription, per the active brain. */
  getCurrentSttProvider(): ProviderDescriptor | null {
    const chain = BRAIN_CHAIN[this.getActiveBrain()];
    return this.registry.get(chain.stt) ?? null;
  }

  /** The provider currently used for speech output, per the active brain. */
  getCurrentTtsProvider(): ProviderDescriptor | null {
    const chain = BRAIN_CHAIN[this.getActiveBrain()];
    return this.registry.get(chain.tts) ?? null;
  }

  /** All registered providers with current health state. */
  getAvailableProviders(): CapabilitySummary[] {
    return this.registry.all().map((d) => this.getCapabilitySummary(d.id));
  }

  getCredentialStatus(providerId: string): CredentialStatus {
    return this.credentials.getStatus(providerId);
  }

  getCapabilitySummary(providerId: string): CapabilitySummary {
    const descriptor = this.registry.get(providerId);
    if (!descriptor) {
      throw new Error(`[VoiceSettings] Unknown provider: ${providerId}`);
    }
    return {
      descriptor,
      health: this.health.evaluate(providerId),
      credentialStatus: this.credentials.getStatus(providerId),
    };
  }
}
