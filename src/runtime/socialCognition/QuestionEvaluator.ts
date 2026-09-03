import type { ConversationalMomentum } from "./SocialDecision";

/**
 * Question evaluation.
 *
 * question_value = information_needed + genuine_curiosity + conversational_opportunity
 *                  - interruption_cost - question_fatigue
 *
 * Only ask when the expected value is positive (threshold: 0.6).
 */
export class QuestionEvaluator {
  private readonly ASK_THRESHOLD = 0.6;

  evaluate(
    clarificationRequired: boolean,
    isGenuinelyCurious: boolean,
    momentum: ConversationalMomentum,
    userVulnerability: number,
    questionFatigue: number,
    impulse: boolean,
  ): { shouldAsk: boolean; value: number; reasons: string[] } {
    const reasons: string[] = [];
    let value = 0;

    // Information needed: high if clarification required
    const infoNeeded = clarificationRequired ? 0.8 : 0;
    if (infoNeeded > 0) {
      reasons.push(`info_needed=${infoNeeded.toFixed(2)}`);
    }
    value += infoNeeded;

    // Genuine curiosity
    const curiosity = isGenuinelyCurious ? 0.6 : 0;
    if (curiosity > 0) {
      reasons.push(`curiosity=${curiosity.toFixed(2)}`);
    }
    value += curiosity;

    // Conversational opportunity
    const opportunity = momentum.exploratory ? 0.4 : momentum.user_elaborating ? 0.2 : 0.1;
    if (opportunity > 0) {
      reasons.push(`opportunity=${opportunity.toFixed(2)}`);
    }
    value += opportunity;

    // Interruption cost: high if user is storytelling or elaborating
    const interruptCost = momentum.storytelling ? 0.8 : momentum.unfinished_thought ? 0.5 : 0;
    if (interruptCost > 0) {
      reasons.push(`interrupt_cost=${interruptCost.toFixed(2)}`);
    }
    value -= interruptCost;

    // Vulnerability cost
    if (userVulnerability > 0.5) {
      value -= 0.5;
      reasons.push("vulnerability_penalty");
    }

    // Question fatigue lowers value
    const fatiguePenalty = questionFatigue * 0.7;
    if (fatiguePenalty > 0) {
      reasons.push(`fatigue_penalty=${fatiguePenalty.toFixed(2)}`);
    }
    value -= fatiguePenalty;

    // Natural ending: don't ask
    if (momentum.carrier === "USER_HIGH" && !impulse) {
      value -= 0.3;
    }

    const shouldAsk = value >= this.ASK_THRESHOLD;
    return {
      shouldAsk,
      value: Math.max(0, Math.round(value * 100) / 100),
      reasons: reasons.length > 0 ? reasons : ["no_value"],
    };
  }
}
