export class ConversationContinuityEngine {
  private ackEngine: any; // AdaptiveAcknowledgementEngine;

  constructor(ackEngine: any) {
    this.ackEngine = ackEngine;
  }

  public evaluateContinuity(
    predictedWaitMs: number,
    intent: string,
    emotion: string,
    rhythm: string,
    isLLMImminent: boolean
  ): string | null {
    // Never inject fillers when the LLM response is already imminent
    if (isLLMImminent) {
      return null;
    }

    // Only inject if the wait exceeds the conversational gap threshold (e.g. 250ms)
    if (predictedWaitMs > 250) {
      return this.ackEngine.selectAcknowledgement(intent, emotion, rhythm);
    }

    return null;
  }
}
