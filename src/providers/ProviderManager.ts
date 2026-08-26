import { FALLBACK_MODELS } from "./openrouter/useProvider";
import { ProviderSupervisor } from "../runtime/resilience/ProviderSupervisor";

export type ProviderId = "gemini" | "openrouter" | "sarvam";

export interface ProviderRecommendation {
  personality: string;
  provider: ProviderId;
  model: string;
  confidenceScore: number;
}

/**
 * Manages the optimal provider and model routing for AURA personality modes.
 * Recommendations are derived from the AURA Personality Benchmark.
 */
export class ProviderManager {
  private static instance: ProviderManager;

  // The optimized routing matrix based on benchmark results.
  // Note: These mappings are exposed as recommendations unless explicitly enabled.
  private optimalRouting: Record<string, { provider: ProviderId; model: string }> = {
    adaptive: { provider: "gemini", model: "gemini-2.0-flash" },
    professional: { provider: "openrouter", model: "anthropic/claude-3.5-sonnet" },
    joyfulPassion: { provider: "gemini", model: "gemini-2.0-flash" },
    interview: { provider: "openrouter", model: "anthropic/claude-3.5-sonnet" },
    companion: { provider: "sarvam", model: "sarvam-2" },
    reflective: { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct" },
    chaotic: { provider: "openrouter", model: "deepseek/deepseek-chat" },
  };
  
  private supervisor = new ProviderSupervisor();

  private constructor() {}

  public static getInstance(): ProviderManager {
    if (!ProviderManager.instance) {
      ProviderManager.instance = new ProviderManager();
    }
    return ProviderManager.instance;
  }

  /**
   * Recommends the optimal LLM provider and model for a given personality.
   * This does NOT automatically switch providers at runtime unless explicitly configured.
   */
  public getOptimalProvider(personality: string): ProviderRecommendation {
    const routing = this.optimalRouting[personality] || this.optimalRouting.adaptive;
    return {
      personality,
      provider: routing.provider,
      model: routing.model,
      confidenceScore: 0.92,
    };
  }

  /**
   * Updates the routing matrix (e.g. from a dynamic benchmark result).
   */
  public updateRouting(personality: string, provider: ProviderId, model: string) {
    this.optimalRouting[personality] = { provider, model };
  }
  
  public getSupervisor() {
    return this.supervisor;
  }
}
