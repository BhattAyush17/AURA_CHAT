// src/runtime/contracts/ExecutionContracts.ts

/**
 * AURA Unified Execution Contracts
 * Permanent execution architecture for all subsystems.
 * All contracts are immutable after creation.
 */

export interface ConversationTurn {
  readonly id: string;
  readonly sessionId: string;
  readonly turnIndex: number;
  readonly timestamp: number;
  readonly userTranscript: string;
  readonly partialTranscript: string | null;
  readonly languageProfile: Record<string, any>;
  readonly speechMetrics: {
    readonly rms: number;
    readonly pauseMs: number;
  };
  readonly interruptionState: boolean;
  readonly deviceContext: Record<string, any>;
  readonly networkContext: Record<string, any>;
  readonly conversationContext: Record<string, any>;
}

export interface BehaviorEnvelope {
  readonly behavior: string; // act/intent
  readonly relationship: string;
  readonly emotion: string;
  readonly memoryContext: string;
  readonly trust: number;
  readonly context: string;
  readonly toxicity: Record<string, any>;
  readonly confidence: number;
  readonly version: string;
  readonly timestamp: number;
}

export interface ConversationPlan {
  readonly initiative: "UserDriven" | "AuraDriven" | "Balanced";
  readonly conversationStructure: string;
  readonly curiosity: "High" | "Medium" | "Low";
  readonly responseArchitecture: string;
  readonly endingStrategy: string;
  readonly reasoningDepth: "Surface" | "Deep";
  readonly toneStrategy: string;
  readonly questionStrategy: string;
}

export interface RuntimeDecision {
  readonly timingIntent: number; // Delay in ms
  readonly responseReadiness: number; // 0.0 to 1.0
  readonly streamingPolicy: "Chunked" | "Continuous" | "SentenceBoundary" | "ParagraphBoundary";
  readonly runtimePolicy: "Aggressive" | "Balanced" | "Conservative" | "BatterySaver";
  readonly providerRecommendation: "Gemini" | "OpenRouter" | "Sarvam" | "Local";
  readonly memoryPriority: "Critical" | "Useful" | "Optional" | "Skip";
  readonly interruptionPolicy: "HardStop" | "SoftStop" | "Overlap" | "Ignore";
  readonly pausePolicy: "Strict" | "Adaptive";
  readonly expressionPolicy: string;
  readonly conversationMomentum: "Fast" | "Normal" | "Reflective" | "Deep";
  readonly dispatchPolicy: "Immediate" | "Delayed" | "Anticipatory" | "Hold";
}

export interface ExecutionPlan {
  readonly provider: string;
  readonly streaming: boolean;
  readonly speech: boolean;
  readonly audio: boolean;
  readonly retryPolicy: string;
  readonly fallbackPolicy: string;
  readonly chunkingStrategy: string;
  readonly interruptionStrategy: string;
  readonly playbackStrategy: string;
}

export interface TelemetryEnvelope {
  readonly turnId: string;
  readonly timestamp: number;
  readonly subsystem: string;
  readonly event: string;
  readonly duration: number;
  readonly severity: "info" | "warning" | "error" | "critical";
  readonly thread: string;
  readonly metadata: Record<string, any>;
}
