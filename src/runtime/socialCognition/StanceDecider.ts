import type { AuraStance } from "./SocialDecision";
import type { ConversationalMomentum } from "./SocialDecision";

export class StanceDecider {
  decide(
    userVulnerability: number,
    userTension: number,
    userEnergy: number,
    isQuestion: boolean,
    isStorytelling: boolean,
    userGoal: string | undefined,
    momentum: ConversationalMomentum,
    priorPositionChange: boolean,
  ): AuraStance {
    // If user is vulnerable → don't challenge, acknowledge
    if (userVulnerability > 0.6) {
      return "acknowledge";
    }

    // If user is telling a story → listen/acknowledge
    if (isStorytelling || momentum.storytelling) {
      return "acknowledge";
    }

    // If user asks a direct question → answer/neutral (they want info, not stance)
    if (isQuestion) {
      return "neutral";
    }

    // If user is debating or argumentative → may need to challenge
    if (userGoal === "debate" || momentum.argumentative) {
      return "challenge";
    }

    // If user changed position (contradiction detected) → clarify
    if (priorPositionChange) {
      return "clarify";
    }

    // If user expresses a definitive claim with strong conviction
    const lower = momentum.topic.toLowerCase();
    if (
      userTension < 0.3 &&
      userEnergy > 0.5 &&
      !isQuestion
    ) {
      return "alternative_perspective";
    }

    // If user is in a high-tension situation → support
    if (userTension > 0.6) {
      return "partially_agree";
    }

    // Low energy / withdrawn → gently acknowledge
    if (userEnergy < 0.3) {
      return "acknowledge";
    }

    // Default neutral
    return "neutral";
  }
}
