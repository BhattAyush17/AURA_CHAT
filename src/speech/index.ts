/**
 * AURA Voice Runtime v1.0 — Phase 1 (Foundation & Provider Registry)
 *
 * Public API surface. Nothing in this phase consumes the existing speech
 * system; nothing in the existing system consumes this. Phase 2 migrates
 * consumers onto these contracts.
 */

// Types
export * from "./types/capabilities";
export * from "./types/metadata";
export * from "./types/events";
export * from "./types/trace";
export * from "./types/contracts";

// Registry
export { ProviderRegistry, providerRegistry } from "./registry/ProviderRegistry";
export {
  PROVIDER_DESCRIPTORS,
  PROVIDER_BROWSER,
  PROVIDER_GROQ,
  PROVIDER_SARVAM,
  PROVIDER_OPENROUTER,
  PROVIDER_GEMINI,
} from "./registry/providers";

// Credentials
export { CredentialManager } from "./credentials/CredentialManager";

// Health
export { ProviderHealth } from "./health/ProviderHealth";

// Settings
export { VoiceSettings } from "./settings/VoiceSettings";

// Application singletons (seeded from the frozen registry on import)
import { providerRegistry } from "./registry/ProviderRegistry";
import { CredentialManager } from "./credentials/CredentialManager";
import { ProviderHealth } from "./health/ProviderHealth";
import { VoiceSettings } from "./settings/VoiceSettings";

export const credentialManager = new CredentialManager(providerRegistry);
export const providerHealth = new ProviderHealth(providerRegistry, credentialManager);
export const voiceSettings = new VoiceSettings(providerRegistry, providerHealth, credentialManager);
