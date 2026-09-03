import type { ConversationalMomentum } from "./SocialDecision";

/**
 * Natural interruption policy.
 *
 * interruption_score = importance + timing + relevance + conversational_opportunity
 *                       - interruption_cost - user_story_momentum
 *
 * Only interrupt above a conservative threshold (default: 2.8).
 * If the user is clearly telling a story, allow them to finish (increases cost).
 */
export class InterruptionPolicy {
  private readonly INTERRUPT_THRESHOLD = 2.8;

  evaluate(
    pauseMs: number,
    isAmbiguous: boolean,
    isCorrectionNeeded: boolean,
    momentum: ConversationalMomentum,
    userVulnerability: number,
    userEnergy: number,
    questionFatigue: number,
  ): { shouldInterrupt: boolean; score: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;

    // Importance: high if user left ambiguity or correction needed
    const importance = isCorrectionNeeded ? 0.9 : isAmbiguous ? 0.7 : 0.2;
    if (importance > 0.5) {
      reasons.push(`importance=${importance.toFixed(2)}`);
    }
    score += importance;

    // Timing: based on pause duration (longer pause = more opportunity)
    const timing = pauseMs > 1500 ? 1.0 : pauseMs > 800 ? 0.6 : pauseMs > 400 ? 0.3 : 0;
    if (timing > 0) {
      reasons.push(`timing=${timing.toFixed(2)}`);
    }
    score += timing;

    // Relevance: high if conversation is active and engaging
    const relevance = momentum.exploratory ? 0.7 : momentum.user_elaborating ? 0.3 : 0.5;
    reasons.push(`relevance=${relevance.toFixed(2)}`);
    score += relevance;

    // User story momentum: HIGH COST if user is telling a story
    const storyCost = momentum.storytelling ? 1.5 : momentum.unfinished_thought ? 1.0 : 0;
    if (storyCost > 0) {
      reasons.push(`story_cost=${storyCost.toFixed(2)}`);
    }
    score -= storyCost;

    // User vulnerability: don't interrupt vulnerable users
    const vulnerabilityCost = userVulnerability > 0.5 ? 0.8 : 0;
    if (vulnerabilityCost > 0) {
      reasons.push(`vulnerability_cost=${vulnerabilityCost.toFixed(2)}`);
    }
    score -= vulnerabilityCost;

    // Low energy: don't interrupt withdrawn users
    if (userEnergy < 0.3) {
      score -= 0.5;
      reasons.push("low_energy_penalty");
    }

    // Question fatigue: don't interrupt if we've been asking too many questions
    const fatigueCost = questionFatigue * 0.5;
    if (fatigueCost > 0) {
      reasons.push(`fatigue_cost=${fatigueCost.toFixed(2)}`);
    }
    score -= fatigueCost;

    // Conversational opportunity: positive if it's a natural gap
    const opportunity = pauseMs > 2000 && !momentum.storytelling ? 0.5 : 0;
    score += opportunity;

    const shouldInterrupt = score >= this.INTERRUPT_THRESHOLD;
    return {
      shouldInterrupt,
      score: Math.round(score * 100) / 100,
      reasons: reasons.length > 0 ? reasons : ["no_strong_reason"],
    };
  }
}
