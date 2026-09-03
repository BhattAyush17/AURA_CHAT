import type { TrajectoryIntent, TrajectoryPrediction } from "./SocialDecision";

export class TrajectoryPredictor {
  predict(text: string, wordCount: number, isQuestion: boolean, goals?: string[]): TrajectoryPrediction {
    const lower = text.toLowerCase();

    // Story continuation: trailing open-ended patterns
    if (
      (lower.match(/and\s*$/i) || lower.match(/so\s*$/i) || lower.match(/but\s*$/i) || lower.match(/then\s*$/i)) &&
      wordCount > 5
    ) {
      return { intent: "story_continuation", confidence: 0.75, cue: "trailing connector" };
    }
    if (lower.includes("so yesterday") || lower.includes("so the other day") || lower.includes("and then")) {
      return { intent: "story_continuation", confidence: 0.7, cue: "past time reference" };
    }

    // Decision / uncertainty
    const uncertaintyPatterns = [
      "i don't know if",
      "not sure if",
      "thinking about",
      "considering",
      "maybe i should",
      "i've been thinking",
      "i'm trying to decide",
      "leaving",
      "should i",
    ];
    if (uncertaintyPatterns.some((p) => lower.includes(p))) {
      return { intent: "decision_uncertainty", confidence: 0.7, cue: "uncertainty marker" };
    }

    // Emotional elaboration
    const emotionPatterns = ["i don't know, it's just", "i feel like", "it's just that", "the thing is", "honestly"];
    if (emotionPatterns.some((p) => lower.includes(p))) {
      return { intent: "emotional_elaboration", confidence: 0.65, cue: "emotion preface" };
    }

    // Planning
    const planPatterns = ["going to", "planning to", "plan on", "i will try", "i'll try", "my plan"];
    if (planPatterns.some((p) => lower.includes(p))) {
      return { intent: "planning", confidence: 0.6, cue: "future orientation" };
    }

    // Information seeking
    if (isQuestion && wordCount > 5) {
      return { intent: "information_seeking", confidence: 0.7, cue: "direct question" };
    }
    if (lower.startsWith("what") || lower.startsWith("how") || lower.startsWith("why") || lower.startsWith("can you")) {
      return { intent: "information_seeking", confidence: 0.6, cue: "question word" };
    }

    // Venting
    const ventPatterns = ["i hate", "i can't stand", "it's so frustrating", "i'm so tired of", "annoying"];
    if (ventPatterns.some((p) => lower.includes(p))) {
      return { intent: "venting", confidence: 0.7, cue: "frustration marker" };
    }

    // Storytelling
    if (wordCount > 20 && !isQuestion && !lower.includes("?")) {
      return { intent: "storytelling", confidence: 0.55, cue: "long message" };
    }

    // Opinion sharing
    const opinionPatterns = ["i think", "in my opinion", "i believe", "my take is"];
    if (opinionPatterns.some((p) => lower.includes(p)) && !isQuestion) {
      return { intent: "opinion_sharing", confidence: 0.55, cue: "opinion marker" };
    }

    // Reflection
    if (wordCount > 10 && (lower.includes("maybe") || lower.includes("perhaps") || lower.includes("i wonder"))) {
      return { intent: "reflection", confidence: 0.5, cue: "reflection marker" };
    }

    // Closure
    if (lower.includes("bye") || lower.includes("good night") || lower.includes("see you") || lower.includes("talk later")) {
      return { intent: "closure", confidence: 0.8, cue: "farewell marker" };
    }

    return { intent: "unknown", confidence: 0.2, cue: "insufficient signal" };
  }
}
