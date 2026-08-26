/**
 * AURA Sense System — SenseRegistry
 *
 * Dynamic Sense registration. ATF only interacts with SenseManager,
 * never with individual Senses directly.
 *
 * Usage:
 *   registry.register(new MusicSense());
 *   registry.register(new VisionSense());  // Future — no code changes needed
 */

import type { AuraSense, SenseRegistryEntry, SenseManifest } from "./types";

export class SenseRegistry {
  private entries: Map<string, SenseRegistryEntry> = new Map();

  /**
   * Register a live Sense implementation.
   */
  register(sense: AuraSense, description: string): void {
    this.entries.set(sense.manifest.id, {
      sense,
      manifest: sense.manifest,
      available: true,
    });
  }

  /**
   * Register a coming-soon placeholder (no implementation required).
   */
  registerPlaceholder(manifestPartial: Partial<SenseManifest> & { id: string, displayName: string, icon: string }): void {
    this.entries.set(manifestPartial.id, {
      sense: null,
      manifest: {
        id: manifestPartial.id,
        displayName: manifestPartial.displayName,
        icon: manifestPartial.icon,
        description: manifestPartial.description || '',
        version: manifestPartial.version || '0.0.0',
        dependencies: manifestPartial.dependencies || [],
        capabilities: manifestPartial.capabilities || [],
        providerRequirements: manifestPartial.providerRequirements || [],
        requiredPermissions: manifestPartial.requiredPermissions || []
      },
      available: false,
    });
  }

  get(id: string): SenseRegistryEntry | undefined {
    return this.entries.get(id);
  }

  getAll(): SenseRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  getAvailable(): AuraSense[] {
    return Array.from(this.entries.values())
      .filter((e) => e.available && e.sense !== null)
      .map((e) => e.sense!);
  }
}
