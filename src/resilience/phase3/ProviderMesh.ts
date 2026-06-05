/**
 * ProviderMesh — Multi-provider failover management.
 *
 * Tracks primary + fallback providers for STT, TTS, and LLM.
 * Automatic failover when a provider exceeds failure thresholds.
 * Cooldown-based provider re-promotion after recovery.
 *
 * @module resilience/phase3/ProviderMesh
 */

import type {
  ProviderEntry,
  ProviderMeshState,
  ProviderRole,
  ResilienceEvent,
} from "../types";

// ─── Constants ──────────────────────────────────────────────────────
const MAX_FAILS_BEFORE_SWITCH = 3;
const FAIL_WINDOW_MS = 30_000;
const REPROMOTION_COOLDOWN_MS = 60_000;

export class ProviderMesh {
  private mesh: ProviderMeshState;
  private eventSink: ((e: ResilienceEvent) => void) | null = null;

  constructor() {
    this.mesh = {
      stt: [
        this.entry("webspeech", "stt", 0),
        this.entry("sarvam_stt", "stt", 1),
        this.entry("text_fallback", "stt", 2),
      ],
      tts: [
        this.entry("sarvam_tts", "tts", 0),
        this.entry("webspeech_tts", "tts", 1),
        this.entry("text_only", "tts", 2),
      ],
      llm: [
        this.entry("openrouter", "llm", 0),
        this.entry("gemini_direct", "llm", 1),
        this.entry("stale_fallback", "llm", 2),
      ],
      activeProviders: {
        stt: "webspeech",
        tts: "sarvam_tts",
        llm: "openrouter",
      },
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  setEventSink(sink: (e: ResilienceEvent) => void): void {
    this.eventSink = sink;
  }

  // ── Signal Ingestion ──────────────────────────────────────────

  /** Report a provider failure */
  reportFailure(role: ProviderRole, providerId: string): void {
    const provider = this.findProvider(role, providerId);
    if (!provider) return;

    const now = performance.now();
    provider.failCount++;
    provider.lastFailTs = now;

    // Check if we need to failover
    if (
      provider.failCount >= MAX_FAILS_BEFORE_SWITCH &&
      this.mesh.activeProviders[role] === providerId
    ) {
      this.failover(role, providerId);
    }
  }

  /** Report a provider success (reduces fail count) */
  reportSuccess(role: ProviderRole, providerId: string, latencyMs?: number): void {
    const provider = this.findProvider(role, providerId);
    if (!provider) return;

    provider.failCount = Math.max(0, provider.failCount - 1);
    provider.isAvailable = true;
    if (latencyMs !== undefined) {
      // Exponential moving average
      provider.avgLatencyMs = provider.avgLatencyMs === 0
        ? latencyMs
        : provider.avgLatencyMs * 0.7 + latencyMs * 0.3;
    }
  }

  /** Mark a provider as unavailable */
  markUnavailable(role: ProviderRole, providerId: string): void {
    const provider = this.findProvider(role, providerId);
    if (provider) {
      provider.isAvailable = false;
      if (this.mesh.activeProviders[role] === providerId) {
        this.failover(role, providerId);
      }
    }
  }

  /** Mark a provider as available again */
  markAvailable(role: ProviderRole, providerId: string): void {
    const provider = this.findProvider(role, providerId);
    if (provider) {
      provider.isAvailable = true;
      provider.failCount = 0;
    }
  }

  // ── State Access ──────────────────────────────────────────────

  getState(): Readonly<ProviderMeshState> {
    return {
      stt: this.mesh.stt.map((p) => ({ ...p })),
      tts: this.mesh.tts.map((p) => ({ ...p })),
      llm: this.mesh.llm.map((p) => ({ ...p })),
      activeProviders: { ...this.mesh.activeProviders },
    };
  }

  getActiveProvider(role: ProviderRole): string {
    return this.mesh.activeProviders[role];
  }

  // ── Internal ──────────────────────────────────────────────────

  private failover(role: ProviderRole, fromId: string): void {
    const providers = this.mesh[role];
    const next = providers.find(
      (p) => p.id !== fromId && p.isAvailable
    );

    if (next) {
      const prevId = this.mesh.activeProviders[role];
      this.mesh.activeProviders[role] = next.id;

      console.warn(
        `[ProviderMesh] Failover: ${role} ${prevId} → ${next.id}`
      );

      this.emit({
        kind: "provider_switched",
        role,
        from: prevId,
        to: next.id,
        ts: performance.now(),
      });
    } else {
      console.error(
        `[ProviderMesh] No available fallback for ${role}! All providers exhausted.`
      );
    }
  }

  private findProvider(role: ProviderRole, id: string): ProviderEntry | undefined {
    return this.mesh[role].find((p) => p.id === id);
  }

  private entry(id: string, role: ProviderRole, priority: number): ProviderEntry {
    return {
      id,
      role,
      priority,
      isAvailable: true,
      failCount: 0,
      lastFailTs: 0,
      avgLatencyMs: 0,
    };
  }

  private emit(event: ResilienceEvent): void {
    this.eventSink?.(event);
  }
}
