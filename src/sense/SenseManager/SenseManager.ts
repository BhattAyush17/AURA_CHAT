/**
 * AURA Sense System — SenseManager
 *
 * The single gateway between the Perception Layer and ATF.
 * ATF calls collectAllContext() every inference cycle.
 * ATF never references individual Senses.
 *
 * Singleton — use SenseManager.getInstance().
 */

import { SenseRegistry } from "./SenseRegistry";
import { MusicSense } from "../MusicSense/MusicSense";
import { VoiceSense } from "../VoiceSense/VoiceSense";
import type { SenseRegistryEntry, SenseEvidenceV1 } from "./types";
import { perceptionFusionLayer } from "../PerceptionFusionLayer";
import { senseSupervisor } from "../runtime/SenseSupervisor";

export class SenseManager {
  private static instance: SenseManager | null = null;
  private registry: SenseRegistry = new SenseRegistry();
  private initialized: boolean = false;

  private constructor() {
    this.registerAll();
  }

  static getInstance(): SenseManager {
    if (!SenseManager.instance) {
      SenseManager.instance = new SenseManager();
    }
    return SenseManager.instance;
  }

  private registerAll(): void {
    const musicSense = new MusicSense();
    this.registry.register(musicSense, "Understand what you're listening to.");
    senseSupervisor.register(musicSense);

    const voiceSense = new VoiceSense();
    this.registry.register(voiceSense, "Perceive acoustic and speech activity.");
    senseSupervisor.register(voiceSense);

    // Future Senses
    const placeholders = [
      { id: "vision", displayName: "Vision", icon: "👁", description: "See what Aura sees." },
    ];
    for (const p of placeholders) {
      this.registry.registerPlaceholder(p);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await senseSupervisor.initializeAll();
  }

  async dispose(): Promise<void> {
    SenseManager.instance = null;
  }

  // ── Per-Sense control ────────────────────────────────────────────

  async connectSense(id: string): Promise<void> {
    const entry = this.registry.get(id);
    if (!entry?.sense) return;
    await entry.sense.connect();
  }

  async disconnectSense(id: string): Promise<void> {
    const entry = this.registry.get(id);
    if (!entry?.sense) return;
    await entry.sense.disconnect();
  }

  getSense(id: string): SenseRegistryEntry | undefined {
    return this.registry.get(id);
  }

  getAllEntries(): SenseRegistryEntry[] {
    return this.registry.getAll();
  }

  // ── ATF Context Collection ───────────────────────────────────────

  /**
   * Called at the start of every cognitive inference cycle.
   * Flushes the Perception Fusion Layer queue into the cognitive layer.
   * Returns [] when no sense has produced usable evidence — absence stays absence.
   */
  async collectAllContext(): Promise<SenseEvidenceV1[]> {
    return perceptionFusionLayer.flushToATF();
  }
}
