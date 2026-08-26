import { RuntimeDecision } from "./DecisionContracts";

export class RuntimeDecisionBuilder {
  private decision: Partial<RuntimeDecision> = {};

  public setConversationType(type: RuntimeDecision["conversationType"]) { this.decision.conversationType = type; return this; }
  public setConversationState(state: RuntimeDecision["conversationState"]) { this.decision.conversationState = state; return this; }
  public setResponseSelection(selection: RuntimeDecision["responseSelection"]) { this.decision.responseSelection = selection; return this; }
  public setThinkingStyle(style: RuntimeDecision["thinkingStyle"]) { this.decision.thinkingStyle = style; return this; }
  public setListeningStyle(style: RuntimeDecision["listeningStyle"]) { this.decision.listeningStyle = style; return this; }
  public setInitiative(initiative: RuntimeDecision["initiative"]) { this.decision.initiative = initiative; return this; }
  public setCuriosity(curiosity: RuntimeDecision["curiosity"]) { this.decision.curiosity = curiosity; return this; }
  public setConversationMomentum(momentum: RuntimeDecision["conversationMomentum"]) { this.decision.conversationMomentum = momentum; return this; }
  public setEndpointConfidence(confidence: number) { this.decision.endpointConfidence = confidence; return this; }
  public setReasoningConfidence(confidence: number) { this.decision.reasoningConfidence = confidence; return this; }
  public setConversationConfidence(confidence: number) { this.decision.conversationConfidence = confidence; return this; }
  public setResponseReadiness(readiness: number) { this.decision.responseReadiness = readiness; return this; }
  public setTimingIntent(intent: number) { this.decision.timingIntent = intent; return this; }
  public setDispatchPolicy(policy: RuntimeDecision["dispatchPolicy"]) { this.decision.dispatchPolicy = policy; return this; }
  public setStreamingPolicy(policy: RuntimeDecision["streamingPolicy"]) { this.decision.streamingPolicy = policy; return this; }
  public setInterruptionPolicy(policy: RuntimeDecision["interruptionPolicy"]) { this.decision.interruptionPolicy = policy; return this; }
  public setMemoryPriority(priority: RuntimeDecision["memoryPriority"]) { this.decision.memoryPriority = priority; return this; }
  public setProviderRecommendation(provider: RuntimeDecision["providerRecommendation"]) { this.decision.providerRecommendation = provider; return this; }
  public setRuntimePolicy(policy: RuntimeDecision["runtimePolicy"]) { this.decision.runtimePolicy = policy; return this; }

  public build(): Readonly<RuntimeDecision> {
    // Provide sensible defaults for anything unset
    const finalDecision: RuntimeDecision = {
      conversationType: this.decision.conversationType || "Unknown",
      conversationState: this.decision.conversationState || "Idle",
      responseSelection: this.decision.responseSelection || "Direct",
      thinkingStyle: this.decision.thinkingStyle || "Fast",
      listeningStyle: this.decision.listeningStyle || "Active",
      initiative: this.decision.initiative || "Balanced",
      curiosity: this.decision.curiosity || "Medium",
      conversationMomentum: this.decision.conversationMomentum || "Normal",
      endpointConfidence: this.decision.endpointConfidence || 0,
      reasoningConfidence: this.decision.reasoningConfidence || 0,
      conversationConfidence: this.decision.conversationConfidence || 0,
      responseReadiness: this.decision.responseReadiness || 0,
      timingIntent: this.decision.timingIntent || 0,
      dispatchPolicy: this.decision.dispatchPolicy || "Immediate",
      streamingPolicy: this.decision.streamingPolicy || "SentenceBoundary",
      interruptionPolicy: this.decision.interruptionPolicy || "SoftStop",
      memoryPriority: this.decision.memoryPriority || "Optional",
      providerRecommendation: this.decision.providerRecommendation || "Gemini",
      runtimePolicy: this.decision.runtimePolicy || "Balanced",
    };

    return Object.freeze(finalDecision);
  }
}
