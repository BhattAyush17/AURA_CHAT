/**
 * Credential Manager — AURA Voice Runtime v1.0, Phase 1.
 *
 * Provider-independent credential system. All key storage/validation stays in
 * src/lib/credentials.ts (sessionStorage only); this module layers the
 * provider abstraction on top of it, driven entirely by registry descriptors.
 *
 * Never performs provider logic. Browser → not-applicable; Gemini Native →
 * managed ("managed internally"); userKey providers read sessionStorage.
 */

import { getCredential, hasUserKey, setCredential, type CredentialKey } from "@/lib/credentials";
import type { CredentialProvider } from "../types/contracts";
import { CredentialRequirement, CredentialStatus } from "../types/metadata";
import type { ProviderRegistry } from "../registry/ProviderRegistry";

export class CredentialManager implements CredentialProvider {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Static credential availability for a provider, driven by its registry
   * descriptor. No provider-specific branching.
   */
  getStatus(providerId: string): CredentialStatus {
    const descriptor = this.registry.get(providerId);
    if (!descriptor) return CredentialStatus.NotApplicable;
    switch (descriptor.credentialRequirement) {
      case CredentialRequirement.Managed:
        return CredentialStatus.Managed;
      case CredentialRequirement.None:
        return CredentialStatus.NotApplicable;
      case CredentialRequirement.UserKey: {
        const key = descriptor.credentialKey as CredentialKey | undefined;
        return key && hasUserKey(key) ? CredentialStatus.Available : CredentialStatus.Missing;
      }
    }
  }

  /** True when the provider can operate from a credential standpoint. */
  isOperational(providerId: string): boolean {
    const status = this.getStatus(providerId);
    return status === CredentialStatus.Available || status === CredentialStatus.Managed;
  }

  /** Read the user key for a userKey provider; null otherwise. */
  get(providerId: string): string | null {
    const descriptor = this.registry.get(providerId);
    if (!descriptor || descriptor.credentialRequirement !== CredentialRequirement.UserKey) {
      return null;
    }
    const value = descriptor.credentialKey ? getCredential(descriptor.credentialKey) : "";
    return value || null;
  }

  /** Store the user key for a userKey provider (sessionStorage only). */
  set(providerId: string, value: string): void {
    const descriptor = this.registry.get(providerId);
    if (!descriptor || descriptor.credentialRequirement !== CredentialRequirement.UserKey) {
      return;
    }
    if (descriptor.credentialKey) {
      setCredential(descriptor.credentialKey, value);
    }
  }

  /** Validate a stored key (no provider logic — validation is in lib/credentials). */
  validate(providerId: string): boolean {
    return this.isOperational(providerId);
  }

  /** Ids of all providers that are credential-operational right now. */
  operationalProviders(): string[] {
    return this.registry
      .all()
      .filter((d) => this.isOperational(d.id))
      .map((d) => d.id);
  }
}
