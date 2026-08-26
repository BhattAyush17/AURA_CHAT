/**
 * ConfidenceManager — explicit confidence reasoning.
 *
 * Phase 11: fuses the canonical understanding's confidence with the
 * perceptual confidence. The understanding layer's reasoning becomes
 * part of the source list — the Executive's confidence is never a
 * black-box number.
 *
 * High → answer directly. Medium → answer cautiously.
 * Low → clarify first. Confidence influences strategy and wording.
 */

import type { ConversationContext } from "./ConversationContext";
import type { ConversationUnderstanding } from "./ConversationUnderstanding";
import type { Confidence, ConfidenceLabel } from "./ExecutionPlan";

export class ConfidenceManager {
  assess(ctx: ConversationContext, u: ConversationUnderstanding): Confidence {
    const sources: string[] = [];
    const stt = u.context.sttConfidence;

    // Perceptual confidence — STT is ground truth for what was heard
    let perceptual = stt;
    sources.push(`stt=${stt.toFixed(2)}`);

    // Interruption degrades what we can trust
    if (ctx.input.wasInterruption) {
      perceptual -= 0.1;
      sources.push("interruption");
    }

    // Memory conflict degrades interpretive confidence
    if (u.context.memoryConflict) {
      perceptual -= 0.1;
      sources.push("conflicting memories");
    }

    // Behavioral read strengthens or weakens the picture
    if (ctx.behaviorAnalysis?.intensity != null) {
      const aligned = 1 - Math.abs(ctx.behaviorAnalysis.intensity - ctx.emotion.tension);
      perceptual += (aligned - 0.5) * 0.1;
      sources.push("behavior aligned with emotion");
    }

    // Hedged / short input lowers confidence
    if (u.context.wordCount < 1 || u.raw.text.trim().length < 4) {
      perceptual -= 0.05;
      sources.push("minimal input");
    }

    // Phase 11: the understanding layer's interpretation confidence is
    // folded in — an unsure reading is an unsure answer. But a confident
    // READING must never rescue a broken HEARING: below stt 0.6 the
    // perceptual signal stays dominant.
    const fused =
      perceptual * 0.85 +
      (u.context.sttConfidence >= 0.6 ? u.confidence.value * 0.15 : 0) +
      (u.speakerGoal === "express-uncertainty" ? -0.05 : 0);

    // CUE exists for reasoning, not prompt inflation: the LLM receives
    // only the chosen strategy. Raw understanding reasoning stays in
    // telemetry; the prompt-visible source list carries one sanitized
    // provenance line instead of the interpretation internals.
    sources.push(
      u.confidence.value >= 0.7
        ? "understanding: confident reading"
        : "understanding: uncertain reading",
    );

    const value = Math.max(0, Math.min(1, Math.round(fused * 100) / 100));
    let label: ConfidenceLabel;
    if (value >= 0.7) label = "High";
    else if (value >= 0.45) label = "Medium";
    else label = "Low";

    return { value, label, sources };
  }
}
