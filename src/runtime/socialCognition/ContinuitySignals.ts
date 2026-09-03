import type { ContinuitySignal } from "./SocialDecision";

export class ContinuitySignals {
  private previousPositions: Map<string, { position: string; timestamp: number }> = new Map();

  /**
   * Check for topic recurrence and position changes from transcript context.
   */
  detect(
    text: string,
    recentHistory: { text: string; isUser: boolean; timestamp: number }[],
  ): ContinuitySignal | null {
    const lower = text.toLowerCase();
    const now = Date.now();

    // Topic recurrence: user revisits a topic mentioned in earlier turns
    const topicKeywords = lower.split(/\s+/).filter((w) => w.length > 4 && !["about", "there", "their", "which", "where"].includes(w));
    const earlierTexts = recentHistory
      .filter((t) => t.isUser && t.text.toLowerCase() !== lower)
      .map((t) => t.text.toLowerCase());

    for (const keyword of topicKeywords) {
      const mentions = earlierTexts.filter((t) => t.includes(keyword)).length;
      if (mentions >= 2) {
        return {
          type: "topic_recurrence",
          confidence: Math.min(0.4 + mentions * 0.1, 0.75),
          description: `You've come back to "${keyword}" a few times.`,
          organic: mentions >= 3,
        };
      }
    }

    // Position change: user expresses view that differs from prior expressed view
    const positionDeclarations = [
      { pattern: /want|prefer|like|don't like|hate|love|think|believe/i, category: "preference" },
    ];

    for (const decl of positionDeclarations) {
      if (decl.pattern.test(lower)) {
        const matched = lower.match(decl.pattern)?.[0] || "";
        const key = `${decl.category}:${matched}`;
        const prior = this.previousPositions.get(key);

        if (prior) {
          // Compare current expressed position with prior
          const priorAge = now - prior.timestamp;
          if (priorAge > 60000) {
            // Found a position that differs from earlier (simple heuristic)
            this.previousPositions.set(key, { position: matched, timestamp: now });
            return {
              type: "position_change",
              confidence: 0.55,
              description: `That sounds different from what you were saying earlier.`,
              organic: true,
            };
          }
        }
        this.previousPositions.set(key, { position: matched, timestamp: now });
      }
    }

    return null;
  }

  reset(): void {
    this.previousPositions.clear();
  }
}
