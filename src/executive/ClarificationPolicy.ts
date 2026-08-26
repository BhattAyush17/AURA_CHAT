/**
 * ClarificationPolicy — decides whether clarification is required
 * before generation.
 *
 * Phase 11: consumes the canonical ConversationUnderstanding. It never
 * re-detects hedges, repairs, or ambiguity itself — the understanding
 * layer already interpreted them; this policy only decides what to do
 * with that interpretation.
 *
 * Low confidence → Clarify. Never let the LLM silently guess.
 */

import type { ConversationContext } from "./ConversationContext";
import type { ConversationUnderstanding } from "./ConversationUnderstanding";
import type { ClarificationDecision } from "./ExecutionPlan";

export class ClarificationPolicy {
  decide(ctx: ConversationContext, u: ConversationUnderstanding): ClarificationDecision {
    const triggeredBy: string[] = [];
    const stt = u.context.sttConfidence;

    // 1. STT confidence — the strongest physical signal
    if (stt < 0.45) {
      triggeredBy.push(`STT confidence ${stt.toFixed(2)} is critically low`);
    } else if (stt < 0.6) {
      triggeredBy.push(`STT confidence ${stt.toFixed(2)} is marginal`);
    }

    // 2. Ambiguity — under-specified, hedged, or empty-ish input
    // Backchannels ("yeah yeah", "hmm", "ok") are continuations, not
    // ambiguities — they must never demand clarification. Neither do
    // greetings/farewells: social microunits are unambiguous by definition.
    // A "Hmm?" is a minimal prompt that still benefits from clarification.
    // Banter is never ambiguity: a playful insult or an answer to an open
    // question ("18." after "Guess.") must not be re-read as unclear input.
    const banterish = u.social.some((s) =>
      ["playfulness", "sarcasm", "excitement", "politeness"].includes(s.name),
    );
    const socialAct = ctx.behaviorAnalysis?.act;
    const answeringOpenQuestion = u.shared.openQuestion;
    if (
      u.context.wordCount <= 2 &&
      !u.raw.isQuestion &&
      !["greeting", "goodbye", "backchannel"].includes(u.literal) &&
      !banterish &&
      !["tease", "insult", "thanks", "reaction", "exclamation", "backchannel"].includes(
        socialAct ?? "",
      ) &&
      !answeringOpenQuestion
    ) {
      triggeredBy.push("input is too short to disambiguate");
    }

    // 3. Uncertainty about their own input — hedged turns
    // BUT: hedged speech from an emotionally open place ("Pata nahi...
    // khush hoon... kuch change ho gaya") is honesty, not ambiguity.
    // Clarifying a vulnerable confession is the one move a friend never makes.
    if (u.speakerGoal === "express-uncertainty" && ctx.emotion.vulnerability <= 0.35) {
      triggeredBy.push("user expressed uncertainty about their own input");
    }

    // 4. Conflicting memories — retrieval returned competing candidates
    if (u.context.memoryConflict) {
      triggeredBy.push("two memories compete at near-equal relevance");
    }

    // 5. Multiple interpretations from perception
    if (u.context.ambiguityTagged) {
      triggeredBy.push("behavior analysis flagged ambiguity");
    }

    // 6. Repair / rejection — the user is correcting AURA's reading.
    // A rejection is a failed understanding; confirm before continuing.
    if (u.move === "Repair") {
      triggeredBy.push("user is repairing the previous reading");
    }

    if (triggeredBy.length > 0) {
      return {
        required: true,
        reason: "Clarification required before generation",
        triggeredBy,
      };
    }

    return {
      required: false,
      reason: "Signals are sufficient; proceed to generation",
    };
  }
}
