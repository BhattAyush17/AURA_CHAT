/**
 * DeviceProfiler — Runtime device capability scoring.
 *
 * Generates deviceCapabilityScore (0–100) based on:
 *   - CPU cores (navigator.hardwareConcurrency)
 *   - Memory estimate (navigator.deviceMemory)
 *   - Frame timing (rAF-based FPS sampling)
 *   - Browser performance heuristics
 *
 * This is NOT "mobile vs desktop" — a modern flagship phone scores
 * identically to a capable desktop. A 2018 budget Android scores low
 * regardless of form factor.
 *
 * @module resilience/phase2/DeviceProfiler
 */

import type { DeviceProfile } from "../types";

// ─── Constants ──────────────────────────────────────────────────────
const FPS_SAMPLE_FRAMES = 60;
const PROFILE_UPDATE_INTERVAL_MS = 10_000;

export class DeviceProfiler {
  private profile: DeviceProfile;
  private fpsFrameCount = 0;
  private fpsStartTime = 0;
  private rafHandle = 0;
  private updateHandle: ReturnType<typeof setInterval> | null = null;
  private recentFps: number[] = [];

  constructor() {
    const cores = typeof navigator !== "undefined"
      ? navigator.hardwareConcurrency || 2
      : 4;
    const memGB = typeof navigator !== "undefined"
      ? (navigator as any).deviceMemory || 4
      : 8;
    const isMobile = typeof navigator !== "undefined"
      ? /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      : false;

    this.profile = {
      score: 70, // conservative default until measured
      cores,
      memoryGB: memGB,
      avgFrameTimeMs: 16.67,
      isMobile,
      isLowEnd: false,
      gpuTier: "unknown",
    };

    // Initial static scoring
    this.computeStaticScore();
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  start(): void {
    // Start FPS measurement
    this.fpsStartTime = performance.now();
    this.fpsFrameCount = 0;
    this.measureFps();

    // Periodic re-evaluation (frame timing can change under load)
    this.updateHandle = setInterval(() => {
      this.computeDynamicScore();
    }, PROFILE_UPDATE_INTERVAL_MS);
  }

  stop(): void {
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    if (this.updateHandle) clearInterval(this.updateHandle);
  }

  destroy(): void {
    this.stop();
  }

  // ── State Access ──────────────────────────────────────────────

  getProfile(): Readonly<DeviceProfile> {
    return { ...this.profile };
  }

  getScore(): number {
    return this.profile.score;
  }

  // ── Internal ──────────────────────────────────────────────────

  private measureFps(): void {
    this.rafHandle = requestAnimationFrame(() => {
      this.fpsFrameCount++;

      if (this.fpsFrameCount >= FPS_SAMPLE_FRAMES) {
        const elapsed = performance.now() - this.fpsStartTime;
        const fps = (this.fpsFrameCount / elapsed) * 1000;
        this.recentFps.push(fps);
        if (this.recentFps.length > 6) this.recentFps.shift();

        this.profile.avgFrameTimeMs = elapsed / this.fpsFrameCount;
        this.fpsFrameCount = 0;
        this.fpsStartTime = performance.now();
      }

      this.measureFps();
    });
  }

  private computeStaticScore(): void {
    let score = 50; // baseline

    // CPU cores
    if (this.profile.cores >= 8) score += 20;
    else if (this.profile.cores >= 4) score += 10;
    else if (this.profile.cores >= 2) score += 0;
    else score -= 10;

    // Memory
    if (this.profile.memoryGB >= 8) score += 15;
    else if (this.profile.memoryGB >= 4) score += 8;
    else if (this.profile.memoryGB >= 2) score += 0;
    else score -= 15;

    // Old mobile browser detection (heuristic)
    if (typeof navigator !== "undefined") {
      const ua = navigator.userAgent;
      // Old Android (4.x–7.x) or old iOS (8–12)
      if (/Android [4-7]\./.test(ua) || /iPhone OS [89]_|iPhone OS 1[012]_/.test(ua)) {
        score -= 20;
      }
      // WebView penalty
      if (/wv\)|WebView/i.test(ua)) {
        score -= 5;
      }
    }

    // GPU tier heuristic via canvas
    this.profile.gpuTier = this.estimateGpuTier();
    if (this.profile.gpuTier === "low") score -= 10;
    else if (this.profile.gpuTier === "high") score += 10;

    this.profile.score = Math.max(0, Math.min(100, score));
    this.profile.isLowEnd = this.profile.score < 40;
  }

  private computeDynamicScore(): void {
    // Re-run static base
    this.computeStaticScore();

    // Overlay FPS-based dynamic adjustment
    if (this.recentFps.length > 0) {
      const avgFps = this.recentFps.reduce((a, b) => a + b, 0) / this.recentFps.length;

      let fpsBonus = 0;
      if (avgFps >= 55) fpsBonus = 10;
      else if (avgFps >= 45) fpsBonus = 5;
      else if (avgFps >= 30) fpsBonus = 0;
      else if (avgFps >= 20) fpsBonus = -10;
      else fpsBonus = -20;

      this.profile.score = Math.max(0, Math.min(100, this.profile.score + fpsBonus));
    }

    this.profile.isLowEnd = this.profile.score < 40;
  }

  private estimateGpuTier(): string {
    if (typeof document === "undefined") return "unknown";
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) return "low";

      const debugInfo = (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        const renderer = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        const rendererLower = (renderer || "").toLowerCase();

        if (/adreno 7|adreno 6[3-9]|mali-g[78]|apple gpu|apple m[1-4]|nvidia|radeon rx|geforce/i.test(rendererLower)) {
          return "high";
        }
        if (/adreno 5|adreno 6[0-2]|mali-g[56]|intel (iris|uhd)/i.test(rendererLower)) {
          return "mid";
        }
        if (/adreno [34]|mali-[4t]|powervr|swiftshader|llvmpipe/i.test(rendererLower)) {
          return "low";
        }
      }
      return "mid"; // can create GL context = at least mid
    } catch {
      return "unknown";
    }
  }
}
