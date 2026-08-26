/**
 * InformationBudget — determines response depth before generation.
 *
 * The LLM should not decide response length independently.
 * Budgets: Tiny / Short / Normal / Detailed / DeepDive
 */

import type { ConversationContext } from "./ConversationContext";
import type { ConversationUnderstanding } from "./ConversationUnderstanding";
import type { InformationBudget } from "./ExecutionPlan";
import type { Strategy } from "./ExecutionPlan";

export interface BudgetDecision {
  budget: InformationBudget;
  targetWords: number;
  reasons: string[];
}

const BUDGET_WORDS: Record<InformationBudget, number> = {
  Tiny: 6,
  Short: 15,
  Normal: 35,
  Detailed: 70,
  DeepDive: 120,
};

export { BUDGET_WORDS };

export class InformationBudgetEngine {
  decide(
    ctx: ConversationContext,
    strategy: Strategy,
    u: ConversationUnderstanding,
  ): BudgetDecision {
    const reasons: string[] = [];
    const emo = ctx.emotion;
    let budget: InformationBudget = "Normal";
    reasons.push("default Normal");

    // Urgency / frustration — solve fast, no walls of text
    if (emo.frustration > 0.6) {
      budget = "Short";
      reasons.push("frustration demands brevity");
    }

    // High tension + low energy — presence over information
    if (emo.tension > 0.7 && emo.energy < 0.4) {
      budget = "Tiny";
      reasons.push("high tension, low energy → presence only");
    }

    // Vulnerability — few words, maximum care
    if (emo.vulnerability > 0.6) {
      budget = "Tiny";
      reasons.push("vulnerability → minimal, grounded response");
    }

    // Shared excitement stays light — celebration is presence, not essay
    if (u.speakerGoal === "share-excitement" && budget !== "Tiny") {
      budget = "Short";
      reasons.push("excitement wants a light, matching response");
    }

    // Strategy-driven depth
    switch (strategy) {
      case "Answer": {
        // Technical or long-form questions earn depth
        const behavior = ctx.behaviorAnalysis;
        const technical = behavior?.tags?.some((t) =>
          ["technical", "coding", "academic", "research"].includes(t),
        );
        if (technical || ctx.timing.averageResponseLengthWords > 50) {
          budget = "Detailed";
          reasons.push("technical question or heavy-history user");
        } else {
          budget = "Short";
          reasons.push("direct answer strategy");
        }
        break;
      }
      case "Comfort":
        budget = "Tiny";
        reasons.push("comfort is presence, not explanation");
        break;
      case "Listen":
      case "Observe":
      case "Reflect":
        budget = "Short";
        reasons.push("reflective strategies stay light");
        break;
      case "Summarize":
        budget = "Detailed";
        reasons.push("consolidation warrants completeness");
        break;
      case "Clarify":
      case "Ask":
        budget = "Tiny";
        reasons.push("a question needs no preamble");
        break;
      default:
        break;
    }

    // Engagement governs ceiling: low engagement → shorter
    if (emo.engagement < 0.3 && budget !== "Tiny") {
      budget = "Short";
      reasons.push("low engagement caps depth");
    }

    return { budget, targetWords: BUDGET_WORDS[budget], reasons };
  }
}
