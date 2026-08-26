/**
 * ReflectionEngine — lightweight self-evaluation after every completed turn.
 *
 * Answers: did I understand? was the strategy effective? was the user
 * satisfied? should I have clarified? was it too long?
 *
 * Reflection only improves subsequent turns. It never rewrites past ones.
 */

import type { ExecutionPlan, Strategy } from "./ExecutionPlan";

export type ReflectionSignal =
  | "good"
  | "clarified_too_late"
  | "too_long"
  | "too_short"
  | "misread"
  | "strategy_ineffective";

export interface TurnOutcome {
  plan: Readonly<ExecutionPlan>;
  userReactedNegatively: boolean; // interruption, frustration spike, disengagement
  userFollowedUp: boolean; // user continued the thread naturally
  nextTurnLengthDelta?: number; // user's next utterance length vs. current (words)
}

export interface ReflectionResult {
  signals: ReflectionSignal[];
  adjustments: Record<string, number>;
  notes: string[];
}

const MAX_HISTORY = 40;

interface HistoryEntry {
  strategy: Strategy;
  signals: ReflectionSignal[];
  outcomes: { reactedNegatively: boolean; followedUp: boolean };
}

export class ReflectionEngine {
  private history: HistoryEntry[] = [];

  /** Persistent tendency weights — tuned by reflection, used by future planners. */
  readonly weights = {
    clarifyBias: 0, // >0 → slightly more willing to clarify
    brevityBias: 0, // >0 → lean shorter
    warmthBias: 0, // >0 → lean warmer
  };

  reflect(outcome: TurnOutcome): ReflectionResult {
    const signals: ReflectionSignal[] = [];
    const notes: string[] = [];
    const plan = outcome.plan;

    // 1. Did the user reject the turn?
    if (outcome.userReactedNegatively) {
      if (plan.strategy.primary !== "Clarify" && plan.confidence.label === "Low") {
        signals.push("clarified_too_late");
        notes.push("low confidence without clarifying → user pushed back");
      } else if (plan.informationBudget === "Detailed" || plan.informationBudget === "DeepDive") {
        signals.push("too_long");
        notes.push("heavy response met with negative reaction");
      } else {
        signals.push("strategy_ineffective");
        notes.push(`negative reaction under ${plan.strategy.primary} strategy`);
      }
    }

    // 2. Depth calibration — did the length match the thread?
    // nextTurnLengthDelta (Phase 10: now wired by the live caller) sharpens
    // the too_short signal: a Tiny answer followed by the user writing MORE
    // is under-nourishment, not mere follow-up.
    if (outcome.userFollowedUp && plan.informationBudget === "Tiny") {
      if (outcome.nextTurnLengthDelta === undefined || outcome.nextTurnLengthDelta > 2) {
        signals.push("too_short");
        notes.push("user followed up — turn may have been under-nourished");
      } else {
        notes.push("user followed up briefly; Tiny turn was proportionate");
      }
    }
    if (outcome.nextTurnLengthDelta !== undefined) {
      notes.push(
        `length delta: ${outcome.nextTurnLengthDelta > 0 ? "+" : ""}${outcome.nextTurnLengthDelta} words`,
      );
    }
    if (outcome.userReactedNegatively && plan.informationBudget === "DeepDive") {
      signals.push("too_long");
    }

    // 3. Did clarification help when it was used?
    if (plan.strategy.primary === "Clarify" && outcome.userFollowedUp) {
      signals.push("good");
      notes.push("clarification unblocked the conversation");
    } else if (
      plan.clarification.required === false &&
      outcome.userReactedNegatively &&
      plan.confidence.label !== "High"
    ) {
      // Only blame the missing clarification when the plan was actually unsure.
      signals.push("clarified_too_late");
      notes.push("low/medium confidence without clarifying → user pushed back");
    }

    // 4. Positive evidence
    if (outcome.userFollowedUp && !outcome.userReactedNegatively) {
      signals.push("good");
      notes.push("thread continued naturally");
    }

    // 5. Interpretation trace — what did we think this turn was?
    // The canonical understanding is the only lens reflection has.
    notes.push(
      `move: ${plan.understanding.move} (${plan.understanding.confidence.value.toFixed(2)})`,
    );
    notes.push(`expected: ${plan.understanding.expected}`);

    // Persist
    this.history.push({
      strategy: plan.strategy.primary,
      signals,
      outcomes: {
        reactedNegatively: outcome.userReactedNegatively,
        followedUp: outcome.userFollowedUp,
      },
    });
    if (this.history.length > MAX_HISTORY) this.history.shift();

    // Update persistent weights (small, ratcheted steps)
    const adjustments: Record<string, number> = {};
    if (signals.includes("clarified_too_late")) {
      this.weights.clarifyBias = Math.min(1, this.weights.clarifyBias + 0.05);
      adjustments.clarifyBias = this.weights.clarifyBias;
    }
    if (signals.includes("too_long")) {
      this.weights.brevityBias = Math.min(1, this.weights.brevityBias + 0.05);
      adjustments.brevityBias = this.weights.brevityBias;
    }
    if (signals.includes("too_short")) {
      this.weights.brevityBias = Math.max(-1, this.weights.brevityBias - 0.05);
      adjustments.brevityBias = this.weights.brevityBias;
    }
    if (outcome.userReactedNegatively && plan.tone.warmth < 0.5) {
      this.weights.warmthBias = Math.min(1, this.weights.warmthBias + 0.05);
      adjustments.warmthBias = this.weights.warmthBias;
    }

    return { signals, adjustments, notes };
  }

  /** Rolling strategy-effectiveness stats — for observability. */
  stats(): { strategy: Strategy; goodRate: number; sampleSize: number }[] {
    const byStrategy = new Map<Strategy, { good: number; total: number }>();
    for (const entry of this.history) {
      const cur = byStrategy.get(entry.strategy) ?? { good: 0, total: 0 };
      cur.total++;
      if (!entry.outcomes.reactedNegatively && entry.outcomes.followedUp) cur.good++;
      byStrategy.set(entry.strategy, cur);
    }
    return [...byStrategy.entries()]
      .map(([strategy, { good, total }]) => ({
        strategy,
        goodRate: total > 0 ? Math.round((good / total) * 100) / 100 : 0,
        sampleSize: total,
      }))
      .sort((a, b) => b.sampleSize - a.sampleSize);
  }
}
