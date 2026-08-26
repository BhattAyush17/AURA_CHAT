/**
 * ObservableThinking — makes internal reasoning visible through behavior.
 *
 * Phase 11: consumes the canonical understanding — the decision to murmur
 * comes from the interpretation, never from re-scanning the text.
 *
 * Observable thinking must originate from genuine uncertainty or
 * strategy — never from random filler insertion.
 */

import type { ConversationContext } from "./ConversationContext";
import type { ConversationUnderstanding } from "./ConversationUnderstanding";
import type { ThinkingBehavior } from "./ExecutionPlan";

const NONE: ThinkingBehavior = Object.freeze({
  kind: "none",
  utterance: null,
  reason: null,
});

export class ObservableThinking {
  decide(
    ctx: ConversationContext,
    uncertainty: number,
    u: ConversationUnderstanding,
  ): ThinkingBehavior {
    const text = ctx.input.text.trim();

    // Genuine uncertainty — the speaker didn't fully land the thought
    if (uncertainty >= 0.6 && u.raw.isQuestion && text.length > 12) {
      return {
        kind: "hesitation",
        utterance: "Hmm…",
        reason: `genuine input uncertainty (${uncertainty.toFixed(2)})`,
      };
    }

    // The turn requires choosing between readings — a real pause
    if (uncertainty >= 0.45) {
      return {
        kind: "considering",
        utterance: "Let me think…",
        reason: `moderate uncertainty (${uncertainty.toFixed(2)})`,
      };
    }

    // Strategy-driven hesitation: Clarify / Reflect naturally start slowly
    if (u.move === "Clarify" || u.context.ambiguityTagged || text.length < 4) {
      return {
        kind: "curious",
        utterance: "I want to understand something first…",
        reason: "strategy-driven clarification opening",
      };
    }

    return NONE;
  }
}
