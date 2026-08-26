/**
 * InitiativePolicy — explicitly decides what AURA should do with the
 * conversational turn: Continue, Ask, Wait, Observe, Redirect, End.
 *
 * Phase 11: consumes the canonical ConversationUnderstanding. Farewell
 * and floor-holding are interpreted once, by understand(); this policy
 * only decides the turn's behavior.
 *
 * Initiative is a cognitive decision, not random LLM behavior.
 */

import type { ConversationContext } from "./ConversationContext";
import type { ConversationUnderstanding } from "./ConversationUnderstanding";
import type { Initiative } from "./ExecutionPlan";
import type { Strategy } from "./ExecutionPlan";

export interface InitiativeDecision {
  initiative: Initiative;
  reasons: string[];
}

export class InitiativePolicy {
  decide(
    ctx: ConversationContext,
    u: ConversationUnderstanding,
    strategy: Strategy,
    clarificationRequired: boolean = false,
  ): InitiativeDecision {
    const reasons: string[] = [];
    const emo = ctx.emotion;

    // End: explicit goodbye
    if (u.literal === "goodbye") {
      return { initiative: "End", reasons: ["explicit farewell signal"] };
    }

    // Ask: clarification is required — the Executive must ask before
    // anything else. This is the clarification outlet (WP3): a plan that
    // requires clarification but holds the thread would be unobservable.
    if (clarificationRequired) {
      reasons.push("clarification required → one question before proceeding");
      return { initiative: "Ask", reasons };
    }

    // Wait: the user is mid-thought or trailing
    if (ctx.input.wasInterruption || emo.vulnerability > 0.7) {
      reasons.push("user interrupted or highly vulnerable");
      return { initiative: "Wait", reasons };
    }

    // Wait: the user is holding the floor ("wait…", "let me explain…")
    if (u.literal === "thinking" || u.move === "Wait") {
      reasons.push("user holds the floor — yield, do not push");
      return { initiative: "Wait", reasons };
    }

    // Observe: nothing actionable, don't manufacture engagement
    if (strategy === "Observe" || strategy === "Listen") {
      reasons.push("listening strategy → no push");
      return { initiative: "Observe", reasons };
    }

    // Ask: long silence, stalled thread, or clarification needed
    if (u.context.silenceMs > 8000) {
      reasons.push("long silence after established conversation");
      return { initiative: "Ask", reasons };
    }
    if (strategy === "Clarify" || strategy === "Ask") {
      reasons.push("strategy requires a question");
      return { initiative: "Ask", reasons };
    }

    // Redirect: thread has gone stale or drifted off-track
    if (u.context.turnCount > 20) {
      reasons.push("thread very long → natural redirection warranted");
      return { initiative: "Redirect", reasons };
    }

    // Continue: default — hold the thread
    reasons.push("healthy thread, clear strategy");
    return { initiative: "Continue", reasons };
  }
}
