import type { ConversationalMomentum, MomentumCarrier } from "./SocialDecision";

export class MomentumTracker {
  private recentUserWords: number[] = [];
  private recentAuraQuestion: boolean[] = [];
  private previousTopics: string[] = [];
  private auraInterrupted = false;

  update(
    text: string,
    wordCount: number,
    userInitiated: boolean,
    auraAskedQuestionThisTurn: boolean,
    isAuraInterrupted: boolean,
    backendVulnerability: number,
    backendEnergy: number,
  ): ConversationalMomentum {
    // Track word counts
    this.recentUserWords.push(wordCount);
    if (this.recentUserWords.length > 5) this.recentUserWords.shift();

    // Track AURA question pattern
    this.recentAuraQuestion.push(auraAskedQuestionThisTurn);
    if (this.recentAuraQuestion.length > 5) this.recentAuraQuestion.shift();

    this.auraInterrupted = isAuraInterrupted;

    // Extract topic keywords
    const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const topicWords = words.filter(
      (w) => !["this", "that", "there", "about", "what", "when", "where", "which", "would", "could", "should", "their", "they're", "there's", "something", "nothing", "everything"].includes(w)
    );
    const newTopics = topicWords.length > 0 ? [topicWords.slice(0, 3).join(", ")] : [];
    this.previousTopics.push(...newTopics);
    if (this.previousTopics.length > 10) this.previousTopics.splice(0, this.previousTopics.length - 10);

    // Carrier determination
    const avgWords = this.recentUserWords.reduce((a, b) => a + b, 0) / Math.max(this.recentUserWords.length, 1);
    const recentAuraQuestions = this.recentAuraQuestion.filter(Boolean).length;

    let carrier: MomentumCarrier;
    if (avgWords > 25 && recentAuraQuestions <= 1) {
      carrier = "USER_HIGH";
    } else if (avgWords > 10 || wordCount > 15) {
      carrier = "USER_MEDIUM";
    } else if (recentAuraQuestions >= 3) {
      carrier = "AURA_LOW";
    } else {
      carrier = "BALANCED";
    }

    // Topic depth: how many previous mentions of recent keywords
    const currentTopicWords = new Set(topicWords);
    const previousMentions = this.previousTopics.filter((t) =>
      [...currentTopicWords].some((w) => t.includes(w))
    ).length;
    const topicDepth = Math.min(previousMentions / 3, 1);

    // Unfinished thought: text trailing with ellipsis, "and...", "so..."
    const trimmed = text.trim();
    const unfinishedThought = trimmed.endsWith("...") || trimmed.endsWith("..") || trimmed.endsWith("and") || trimmed.endsWith("but") || trimmed.endsWith("so") || trimmed.endsWith("or");

    // User elaborating: increasing word count over recent turns
    const userElaborating = this.recentUserWords.length >= 3 &&
      this.recentUserWords[this.recentUserWords.length - 1] >
        this.recentUserWords.slice(0, -1).reduce((a, b) => a + b, 0) /
          (this.recentUserWords.length - 1) * 1.3;

    // User wants space: short replies, low energy, high vulnerability or withdrawal
    const userWantsSpace = wordCount <= 3 && (backendVulnerability > 0.5 || backendEnergy < 0.3);

    // Conversational quality flags
    const exploratory = text.includes("?") && wordCount > 10 && !text.toLowerCase().includes("bye");
    const argumentative = wordCount > 8 && (text.includes("but") || text.includes("actually") || text.includes("no, ") || text.includes("not true"));
    const storytelling = wordCount > 25 && !text.includes("?");

    return {
      carrier,
      topic: topicWords.slice(0, 3).join(", ") || "unknown",
      topic_depth: Math.round(topicDepth * 100) / 100,
      unfinished_thought: unfinishedThought,
      user_elaborating: userElaborating,
      aura_recently_interrupted: this.auraInterrupted,
      user_wants_space: userWantsSpace,
      exploratory,
      argumentative,
      storytelling,
    };
  }

  reset(): void {
    this.recentUserWords = [];
    this.recentAuraQuestion = [];
    this.previousTopics = [];
    this.auraInterrupted = false;
  }
}
