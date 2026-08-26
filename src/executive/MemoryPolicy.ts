/**
 * MemoryPolicy — decides whether retrieved memory should be referenced
 * in this turn.
 *
 * The Memory Engine retrieves. The Executive decides usage.
 * Never reference memory simply because it exists.
 */

import type { ConversationContext } from "./ConversationContext";
import type { ConversationUnderstanding } from "./ConversationUnderstanding";
import type { MemoryPolicy } from "./ExecutionPlan";

export interface MemoryDecision {
  policy: MemoryPolicy;
  topMemory: string | null;
  reasons: string[];
}

export class MemoryPolicyEngine {
  decide(ctx: ConversationContext, u: ConversationUnderstanding): MemoryDecision {
    const reasons: string[] = [];
    const retrieved = ctx.memory.retrieved;
    const relevance = ctx.memory.relevanceScores;

    if (retrieved.length === 0) {
      return { policy: "Ignore", topMemory: null, reasons: ["nothing retrieved"] };
    }

    // Emotional urgency — comfort and presence take precedence over recall.
    const emo = ctx.emotion;
    if (emo.vulnerability > 0.6 || emo.tension > 0.7) {
      return {
        policy: "Optional",
        topMemory: null,
        reasons: ["emotional state demands presence; memory only if it aids comfort"],
      };
    }

    const bestIndex = relevance.length > 0 ? relevance.indexOf(Math.max(...relevance)) : 0;
    const bestScore = relevance[bestIndex] ?? 0;
    const topMemory = retrieved[bestIndex] ?? null;

    // Naturalness guard — don't recite history into rapid small talk.
    // The understanding layer classified the turn; this policy only
    // decides whether recall would be natural here.
    if (
      ctx.timing.turnCount < 2 &&
      u.context.wordCount <= 2 &&
      ["greeting", "backchannel", "statement"].includes(u.literal)
    ) {
      return {
        policy: "Ignore",
        topMemory: null,
        reasons: ["greeting-scale turn; referencing memory would be unnatural"],
      };
    }

    if (bestScore >= 0.6) {
      reasons.push(`top memory relevance ${bestScore.toFixed(2)}`);
      return { policy: "Required", topMemory, reasons };
    }

    if (bestScore >= 0.3) {
      reasons.push(`top memory relevance ${bestScore.toFixed(2)} — usable if it flows`);
      return { policy: "Optional", topMemory, reasons };
    }

    return { policy: "Ignore", topMemory: null, reasons: ["no memory clears relevance threshold"] };
  }
}
