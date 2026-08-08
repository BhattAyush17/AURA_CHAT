/**
 * Provider Registry — AURA Voice Runtime v1.0, Phase 1.
 *
 * Metadata-only discovery. The registry NEVER instantiates providers and
 * holds no runtime state. Registration is a static table (registry/providers.ts);
 * adding a provider requires zero application logic changes.
 */

import type { ProviderDescriptor } from "../types/metadata";
import type { SpeechCapabilities } from "../types/capabilities";
import { PROVIDER_DESCRIPTORS } from "./providers";

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderDescriptor>();

  constructor(descriptors: readonly ProviderDescriptor[] = PROVIDER_DESCRIPTORS) {
    for (const descriptor of descriptors) {
      this.register(descriptor);
    }
  }

  /**
   * Register a provider descriptor. Throws on duplicate ids — the registry
   * is the single source of truth for provider ids.
   */
  register(descriptor: ProviderDescriptor): void {
    if (this.providers.has(descriptor.id)) {
      throw new Error(`[ProviderRegistry] Duplicate provider id: ${descriptor.id}`);
    }
    this.providers.set(descriptor.id, descriptor);
  }

  get(id: string): ProviderDescriptor | undefined {
    return this.providers.get(id);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  all(): readonly ProviderDescriptor[] {
    return [...this.providers.values()];
  }

  /** Providers that can produce transcripts (STT or realtime sessions). */
  speechInputProviders(): ProviderDescriptor[] {
    return this.all().filter((d) => d.capabilities.speechInput || d.capabilities.realtime);
  }

  /** Providers that can produce audio/segments (TTS or realtime sessions). */
  speechOutputProviders(): ProviderDescriptor[] {
    return this.all().filter((d) => d.capabilities.speechOutput || d.capabilities.realtime);
  }

  realtimeProviders(): ProviderDescriptor[] {
    return this.all().filter((d) => d.capabilities.realtime);
  }

  /** Select providers whose capabilities satisfy a predicate. */
  byCapability(predicate: (cap: SpeechCapabilities) => boolean): ProviderDescriptor[] {
    return this.all().filter((d) => predicate(d.capabilities));
  }
}

/** Application singleton — seeded from the frozen registry data on import. */
export const providerRegistry = new ProviderRegistry();
