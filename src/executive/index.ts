/**
 * AURA Phase 7.0 — Conversation Executive & Cognitive Constitution.
 *
 * The Executive consumes subsystem snapshots and produces the canonical
 * ExecutionPlan. The LLM never decides conversational strategy — it
 * realizes an already-chosen plan.
 */

export * from "./ConversationContext";
export * from "./ExecutionPlan";
export * from "./RegisterState";

export { ConversationExecutive } from "./ConversationExecutive";
export type { ExecutiveDependencies } from "./ConversationExecutive";

export { StrategyPlanner, STRATEGIES } from "./StrategyPlanner";
export type { StrategySelection } from "./StrategyPlanner";

// Phase 11: the canonical interpretation layer — one object, single owner.
export { understand } from "./ConversationUnderstanding";
export type {
  ConversationUnderstanding,
  LiteralMeaning,
  ConversationMove,
  SpeakerGoal,
  ExpectedResponse,
  ConversationState,
  ImplicitMeaning,
  SocialSignal,
  UnderstandingConfidence,
  SharedContext,
  UnderstandingContext,
} from "./ConversationUnderstanding";

export { ClarificationPolicy } from "./ClarificationPolicy";
export { MemoryPolicyEngine } from "./MemoryPolicy";
export type { MemoryDecision } from "./MemoryPolicy";
export { InformationBudgetEngine } from "./InformationBudget";
export type { BudgetDecision } from "./InformationBudget";
export { InitiativePolicy } from "./InitiativePolicy";
export type { InitiativeDecision } from "./InitiativePolicy";
export { SpeechBehaviorPlanner } from "./SpeechBehaviorPlanner";
export { ConfidenceManager } from "./ConfidenceManager";
export { ObservableThinking } from "./ObservableThinking";
export { ReflectionEngine } from "./ReflectionEngine";
export type { TurnOutcome, ReflectionResult, ReflectionSignal } from "./ReflectionEngine";

// Phase 14.2: Executive-driven model routing — one deterministic decision.
export {
  MODEL_PROFILES,
  MODEL_OPENROUTER_IDS,
  EMERGENCY_FALLBACK,
  buildModelQueue,
} from "./ModelProfile";
export type { ModelId, ModelProfile } from "./ModelProfile";
export {
  CONVERSATION_PROFILES,
  scoreProfiles,
  routeConversationModel,
  signalsFromPlan,
} from "./ModelRouter";
export type {
  ConversationProfile,
  ConversationProfileId,
  ModelRoutingDecision,
  RoutingSignals,
} from "./ModelRouter";
