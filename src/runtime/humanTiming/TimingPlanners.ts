export type ConversationMomentum = "Fast" | "Normal" | "Reflective" | "Deep";

export class ResponseMomentumPlanner {
  private currentMomentum: ConversationMomentum = "Normal";
  private consecutiveFastTurns: number = 0;
  private consecutiveDeepTurns: number = 0;

  public updateMomentum(intent: string, turnDurationMs: number): ConversationMomentum {
    if (intent === "Greeting" || intent === "QuickFact" || turnDurationMs < 2000) {
      this.consecutiveFastTurns++;
      this.consecutiveDeepTurns = 0;
    } else if (intent === "DeepReflection" || intent === "Emotional" || turnDurationMs > 10000) {
      this.consecutiveDeepTurns++;
      this.consecutiveFastTurns = 0;
    } else {
      this.consecutiveFastTurns = Math.max(0, this.consecutiveFastTurns - 1);
      this.consecutiveDeepTurns = Math.max(0, this.consecutiveDeepTurns - 1);
    }

    if (this.consecutiveFastTurns > 2) this.currentMomentum = "Fast";
    else if (this.consecutiveDeepTurns > 1) this.currentMomentum = "Deep";
    else if (this.consecutiveDeepTurns > 0) this.currentMomentum = "Reflective";
    else this.currentMomentum = "Normal";

    return this.currentMomentum;
  }

  public getMomentum() {
    return this.currentMomentum;
  }
}

export class NaturalPausePlanner {
  /**
   * Calculates the exact millisecond pause to enforce before streaming audio,
   * making the pause feel intentional and human.
   */
  public calculatePause(
    intent: string, 
    momentum: ConversationMomentum,
    actualWaitSoFarMs: number
  ): number {
    let targetPause = 300; // Base baseline

    if (intent === "Greeting" || momentum === "Fast") {
      targetPause = 100;
    } else if (intent === "QuickFact" || intent === "FollowUp") {
      targetPause = 200;
    } else if (intent === "Coding" || intent === "Reasoning") {
      targetPause = 500;
    } else if (intent === "Emotional" || intent === "DeepReflection" || momentum === "Deep") {
      targetPause = 800;
    }

    // If the system has already taken longer than the target pause to generate TTFT,
    // we don't inject any *additional* fake silence. We just stream immediately.
    const remainingPause = Math.max(0, targetPause - actualWaitSoFarMs);
    
    return remainingPause;
  }
}
