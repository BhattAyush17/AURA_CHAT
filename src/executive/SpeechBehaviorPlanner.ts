/**
 * SpeechBehaviorPlanner — separates behavior from wording.
 *
 * The Executive defines how AURA should sound this turn; the Speech
 * Planner translates these into TTS parameters downstream.
 */

import type { ConversationContext } from "./ConversationContext";
import type { ConversationUnderstanding } from "./ConversationUnderstanding";
import type { ExecutionPlan, SpeechBehavior, Strategy } from "./ExecutionPlan";
import { clamp01 } from "./util";

export class SpeechBehaviorPlanner {
  plan(
    ctx: ConversationContext,
    u: ConversationUnderstanding,
    strategy: Strategy,
    budgetWords: number,
  ): SpeechBehavior {
    const emo = ctx.emotion;

    // Base pace: emotional state drives tempo
    let speechSpeed = 1.0;
    let energy = 0.5;
    let warmth = 0.5;
    let emphasis = 0.4;

    if (emo.frustration > 0.6) {
      speechSpeed = 1.1;
      energy = 0.65;
      emphasis = 0.6;
    } else if (emo.vulnerability > 0.6) {
      speechSpeed = 0.85;
      energy = 0.35;
      warmth = 0.85;
      emphasis = 0.5;
    } else if (emo.tension > 0.7) {
      speechSpeed = 0.8;
      energy = 0.3;
      warmth = 0.7;
      emphasis = 0.35;
    } else if (emo.energy > 0.7) {
      speechSpeed = 1.05;
      energy = 0.75;
      warmth = 0.6;
      emphasis = 0.5;
    }

    // Strategy refines expression
    switch (strategy) {
      case "Comfort":
        speechSpeed = Math.min(speechSpeed, 0.9);
        warmth = Math.max(warmth, 0.85);
        break;
      case "Encourage":
        energy = Math.max(energy, 0.7);
        warmth = Math.max(warmth, 0.75);
        break;
      case "Challenge":
        energy = Math.max(energy, 0.6);
        emphasis = Math.max(emphasis, 0.65);
        warmth = Math.min(warmth, 0.6);
        break;
      case "Clarify":
      case "Ask":
        speechSpeed = Math.min(speechSpeed, 0.95);
        break;
      case "Answer":
        emphasis = Math.max(emphasis, 0.45);
        break;
      default:
        break;
    }

    // Budget-aware pacing: long budgets breathe slower
    if (budgetWords > 60) {
      speechSpeed = Math.min(speechSpeed, 0.95);
      emphasis = Math.max(emphasis, 0.5);
    }

    // Identity mode tint
    if (ctx.identity.mode === "philosophical") {
      speechSpeed = Math.min(speechSpeed, 0.85);
      warmth = clamp01(warmth + 0.1);
    } else if (ctx.identity.mode === "chaotic" || ctx.identity.mode === "genz") {
      speechSpeed = Math.max(speechSpeed, 1.0);
      energy = clamp01(energy + 0.15);
    }

    // Thinking pauses: genuine uncertainty gets audible hesitation —
    // the understanding layer already decided whether the user hesitated.
    const hesitant = u.social.some((s) => s.name === "hesitation");
    const thinkingPauses =
      strategy === "Clarify" ? 1 : hesitant || emo.tension > 0.6 || emo.vulnerability > 0.4 ? 1 : 0;
    const reflectionPauses = strategy === "Reflect" || strategy === "Observe" ? 1 : 0;

    // Ending softness: gentle topics end softly
    const endingSoftness = emo.vulnerability > 0.4 || strategy === "Comfort" ? 0.8 : 0.5;

    return {
      pauseBeforeMs: strategy === "Reflect" || strategy === "Observe" ? 900 : 450,
      speechSpeed: Math.round(speechSpeed * 100) / 100,
      energy: clamp01(energy),
      warmth: clamp01(warmth),
      emphasis: clamp01(emphasis),
      thinkingPauses,
      reflectionPauses,
      endingSoftness: clamp01(endingSoftness),
    };
  }
}
