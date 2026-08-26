// src/runtime/decision/DecisionContracts.ts

export type ConversationType = 
  | "Greeting" | "QuickFact" | "FollowUp" | "Teaching" | "Coding" 
  | "Reasoning" | "Brainstorming" | "Emotional" | "Personal" 
  | "Debate" | "Storytelling" | "Interview" | "CreativeWriting" 
  | "DecisionMaking" | "DeepReflection" | "Unknown";

export type ConversationState = "Listening" | "Processing" | "Speaking" | "Idle" | "Interrupted";
export type ResponseSelection = "Direct" | "Reflective" | "Probing" | "Empathetic" | "Analytical";
export type ThinkingStyle = "Fast" | "Deliberate" | "Deep";
export type ListeningStyle = "Active" | "Passive" | "Interruptible";
export type Initiative = "UserDriven" | "AuraDriven" | "Balanced";
export type Curiosity = "High" | "Medium" | "Low";
export type ConversationMomentum = "Fast" | "Normal" | "Reflective" | "Deep";
export type DispatchPolicy = "Immediate" | "Delayed" | "Anticipatory" | "Hold";
export type StreamingPolicy = "Chunked" | "Continuous" | "SentenceBoundary" | "ParagraphBoundary";
export type InterruptionPolicy = "HardStop" | "SoftStop" | "Overlap" | "Ignore";
export type MemoryPriority = "Critical" | "Useful" | "Optional" | "Skip";
export type ProviderRecommendation = "Gemini" | "OpenRouter" | "Sarvam" | "Local";
export type RuntimePolicy = "Aggressive" | "Balanced" | "Conservative" | "BatterySaver";

// src/runtime/decision/RuntimeDecision.ts
import * as Contracts from "./DecisionContracts";

export interface RuntimeDecision {
  conversationType: Contracts.ConversationType;
  conversationState: Contracts.ConversationState;
  responseSelection: Contracts.ResponseSelection;
  thinkingStyle: Contracts.ThinkingStyle;
  listeningStyle: Contracts.ListeningStyle;
  initiative: Contracts.Initiative;
  curiosity: Contracts.Curiosity;
  conversationMomentum: Contracts.ConversationMomentum;
  endpointConfidence: number;
  reasoningConfidence: number;
  conversationConfidence: number;
  responseReadiness: number;
  timingIntent: number; // The artificial delay or timing target (ms)
  dispatchPolicy: Contracts.DispatchPolicy;
  streamingPolicy: Contracts.StreamingPolicy;
  interruptionPolicy: Contracts.InterruptionPolicy;
  memoryPriority: Contracts.MemoryPriority;
  providerRecommendation: Contracts.ProviderRecommendation;
  runtimePolicy: Contracts.RuntimePolicy;
  
  // Immutability enforced through readonly properties or freezing the object.
  // We use standard properties here, but the builder will Object.freeze() the result.
}
