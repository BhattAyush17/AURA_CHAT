import type { BehaviorAnalysis } from "@/lib/behavior-client";

/**
 * ExecutionAction defines the canonical behavior control contract for providers.
 * Providers MUST consume this action and behave accordingly without making
 * their own orchestrational or executive decisions.
 */
export type ExecutionAction = "SPEAK" | "WAIT" | "BACKCHANNEL";

export interface ProviderExecutionDirective {
  action: ExecutionAction;
  delayMs: number;
}

/**
 * ProviderAdapter formalizes the contract that any AURA backend provider MUST implement.
 * This guarantees the canonical RuntimeManager remains the sole cognitive orchestrator.
 */
export interface ProviderAdapter {
  /**
   * Unique identifier for the provider (e.g., "sarvam", "openrouter", "gemini-live").
   */
  readonly providerId: string;

  /**
   * Optional capability flags for this provider.
   */
  readonly capabilities?: {
    supportsSSE?: boolean;
    supportsWebSockets?: boolean;
    nativeVoiceSynthesis?: boolean;
    nativeVoiceRecognition?: boolean;
  };

  /**
   * The core method to handle a conversational turn.
   * Providers receive the raw user text, the processed cognitive block, 
   * and any pre-computed behavior analysis.
   */
  processTurn(
    userText: string,
    cognitiveBlock: string,
    behaviorAnalysis: BehaviorAnalysis | null,
    context?: Record<string, any>
  ): Promise<void>;

  /**
   * Instructs the provider to apply an execution directive (e.g. wait, speak).
   */
  applyExecutionDirective(directive: ProviderExecutionDirective): void;

  /**
   * Disconnects or cleans up any provider-specific resources (e.g., streams).
   */
  dispose(): void;
}
