/**
 * AcknowledgementGuard — prevents mechanical acknowledgement repetition.
 *
 * A lightweight deterministic layer that decides whether/how to acknowledge
 * based on conversation patterns, NOT LLM inference.
 *
 * Tracks only: frequency and patterns, NOT content.
 */

export type AcknowledgementLevel = "skip" | "brief" | "full";

interface AcknowledgementState {
  recentAcknowledges: number[]; // timestamps of recent acknowledgement turns
  consecutiveNoAck: number; // turns since last acknowledgement
  lastUserWasQuestion: boolean;
  conversationMode: "information" | "casual" | "deep" | "venting";
}

const MAX_RECENT_ACKS = 5;
const ACK_WINDOW_MS = 60000; // 1 minute window
const MIN_ACK_INTERVAL = 2; // At least 2 turns between acknowledgements in casual mode
const CASUAL_ACK_THRESHOLD = 0.6; // In casual mode, ack if score > this

export class AcknowledgementGuard {
  private state: AcknowledgementState = {
    recentAcknowledges: [],
    consecutiveNoAck: 0,
    lastUserWasQuestion: false,
    conversationMode: "casual",
  };

  /**
   * Decide the acknowledgement level for this turn.
   *
   * @param params - Current turn context
   * @returns AcknowledgementLevel recommendation
   */
  decide(params: {
    userText: string;
    isQuestion: boolean;
    urgency: number; // 0-1, how time-sensitive is the response
    energy: number; // 0-1, conversation energy
    mode: "information" | "casual" | "deep" | "venting";
  }): AcknowledgementLevel {
    const { userText, isQuestion, urgency, energy, mode } = params;

    // Update state
    this.state.conversationMode = mode;
    this.state.lastUserWasQuestion = isQuestion;

    // Clean old acknowledgements
    const now = Date.now();
    this.state.recentAcknowledges = this.state.recentAcknowledges.filter(
      (t) => now - t < ACK_WINDOW_MS,
    );

    // High urgency → skip acknowledgement, respond directly
    if (urgency > 0.7) {
      this.recordNoAck();
      return "skip";
    }

    // Very low energy (exhausted/withdrawn) → skip acknowledgement
    if (energy < 0.2) {
      this.recordNoAck();
      return "skip";
    }

    // Vent mode → presence matters more than acknowledgement
    if (mode === "venting" || mode === "deep") {
      if (this.state.consecutiveNoAck >= 3) {
        this.recordAck();
        return "brief";
      }
      this.recordNoAck();
      return "skip";
    }

    // Information mode → respond directly, no acknowledgement needed
    if (mode === "information") {
      this.recordNoAck();
      return "skip";
    }

    // Calculate acknowledgement score
    const score = this.calculateAckScore();

    // High question frequency → brief acknowledgement OK
    if (isQuestion && this.state.recentAcknowledges.length < 2) {
      this.recordAck();
      return "brief";
    }

    // Low score → skip acknowledgement
    if (score < CASUAL_ACK_THRESHOLD) {
      this.recordNoAck();
      return "skip";
    }

    // Check interval constraint
    if (this.state.recentAcknowledges.length > 0) {
      const lastAck = this.state.recentAcknowledges[this.state.recentAcknowledges.length - 1];
      const turnsSinceAck = this.state.consecutiveNoAck;
      if (turnsSinceAck < MIN_ACK_INTERVAL) {
        this.recordNoAck();
        return "skip";
      }
    }

    // Score is high enough and interval is respected
    this.recordAck();
    return this.state.recentAcknowledges.length <= 2 ? "brief" : "skip";
  }

  private calculateAckScore(): number {
    let score = 0.5; // baseline

    // Recent acknowledgement frequency
    const ackFreq = this.state.recentAcknowledges.length / MAX_RECENT_ACKS;
    score -= ackFreq * 0.4; // More acks recently = lower score

    // Consecutive turns without acknowledgement
    score += Math.min(this.state.consecutiveNoAck * 0.1, 0.3);

    // Last user message was a question → slightly higher score
    if (this.state.lastUserWasQuestion) {
      score += 0.1;
    }

    return Math.max(0, Math.min(1, score));
  }

  private recordAck(): void {
    this.state.recentAcknowledges.push(Date.now());
    if (this.state.recentAcknowledges.length > MAX_RECENT_ACKS) {
      this.state.recentAcknowledges.shift();
    }
    this.state.consecutiveNoAck = 0;
  }

  private recordNoAck(): void {
    this.state.consecutiveNoAck++;
  }

  /**
   * Get acknowledgement guidance as a string directive for the prompt.
   */
  getDirective(level: AcknowledgementLevel): string {
    switch (level) {
      case "skip":
        return "do not acknowledge — respond directly";
      case "brief":
        return "brief acknowledgement only if natural, otherwise respond directly";
      case "full":
        return "acknowledge warmly, then respond";
    }
  }

  /**
   * Get safe diagnostic summary for the diagnostics panel.
   */
  getDiagnosticSummary(): { recentAcks: number; consecutiveNoAck: number; mode: string } {
    return {
      recentAcks: this.state.recentAcknowledges.length,
      consecutiveNoAck: this.state.consecutiveNoAck,
      mode: this.state.conversationMode,
    };
  }

  reset(): void {
    this.state = {
      recentAcknowledges: [],
      consecutiveNoAck: 0,
      lastUserWasQuestion: false,
      conversationMode: "casual",
    };
  }
}

export const acknowledgementGuard = new AcknowledgementGuard();
