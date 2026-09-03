import { PersonModel } from "./PersonModel";
import { BehavioralShiftDetector } from "./BehavioralShiftDetector";
import { TrajectoryPredictor } from "./TrajectoryPredictor";
import { MomentumTracker } from "./MomentumTracker";
import { StanceDecider } from "./StanceDecider";
import { ContributionPlanner } from "./ContributionPlanner";
import { InterruptionPolicy } from "./InterruptionPolicy";
import { QuestionEvaluator } from "./QuestionEvaluator";
import { ContinuitySignals } from "./ContinuitySignals";
import type { SocialDecisionObject, SocialCognitionSnapshot, BehavioralShift, ContinuitySignal } from "./SocialDecision";
import type { ConversationalMomentum } from "./SocialDecision";

export interface TurnInput {
  text: string;
  userId: string;
  wordCount: number;
  isQuestion: boolean;
  userInitiated: boolean;
  backendVulnerability: number;
  backendTension: number;
  backendEnergy: number;
  backendPlayfulness: number;
  backendGoal?: string;
  clarificationRequired: boolean;
  auraAskedQuestionThisTurn: boolean;
  isAuraInterrupted: boolean;
  silenceMs: number;
  recentHistory: { text: string; isUser: boolean; timestamp: number }[];
  questionFatigue?: number;
  momentumOverride?: ConversationalMomentum;
}

export class SocialCognitionEngine {
  readonly personModel = new PersonModel();
  readonly shiftDetector = new BehavioralShiftDetector();
  readonly trajectoryPredictor = new TrajectoryPredictor();
  readonly momentumTracker = new MomentumTracker();
  readonly stanceDecider = new StanceDecider();
  readonly contributionPlanner = new ContributionPlanner();
  readonly interruptionPolicy = new InterruptionPolicy();
  readonly questionEvaluator = new QuestionEvaluator();
  readonly continuitySignals = new ContinuitySignals();

  private lastDecision: SocialDecisionObject | null = null;
  private previousPositionChange = false;

  /**
   * Process a user turn and produce a SocialDecisionObject.
   * Must be called AFTER the existing plan is generated but BEFORE response generation.
   */
  processTurn(input: TurnInput): SocialDecisionObject {
    const text = input.text;
    const now = Date.now();

    // 1. Update person model
    this.personModel.setUserId(input.userId);
    this.personModel.observeTurn(
      text,
      input.wordCount,
      input.isQuestion,
      undefined,
      input.backendPlayfulness,
    );

    // 2. Detect behavioral shift
    const shift = this.shiftDetector.observe(
      text,
      input.wordCount,
      input.backendPlayfulness,
      input.backendEnergy,
      input.backendTension,
    );

    // 3. Predict trajectory
    const trajectory = this.trajectoryPredictor.predict(
      text,
      input.wordCount,
      input.isQuestion,
      input.backendGoal ? [input.backendGoal] : undefined,
    );

    // 4. Update momentum
    const momentum = this.momentumTracker.update(
      text,
      input.wordCount,
      input.userInitiated,
      input.auraAskedQuestionThisTurn,
      input.isAuraInterrupted,
      input.backendVulnerability,
      input.backendEnergy,
    );

    // 5. Check for continuity signals
    const continuitySignal = this.continuitySignals.detect(text, input.recentHistory);
    this.previousPositionChange = continuitySignal?.type === "position_change";

    // 6. Decide AURA stance
    const stance = this.stanceDecider.decide(
      input.backendVulnerability,
      input.backendTension,
      input.backendEnergy,
      input.isQuestion,
      trajectory.intent === "storytelling",
      input.backendGoal,
      momentum,
      this.previousPositionChange,
    );

    // 7. Plan contribution
    const purpose = this.determinePurpose(trajectory.intent, input.backendVulnerability);
    const { contribution, mode } = this.contributionPlanner.plan(
      stance,
      momentum,
      trajectory.intent,
      purpose,
      input.backendVulnerability,
      input.wordCount,
    );

    // 8. Evaluate interruption
    const isAmbiguous = trajectory.intent === "story_continuation" || trajectory.intent === "emotional_elaboration";
    const isCorrection = input.backendGoal === "repair" || !!(input.backendGoal === "test-aura");
    const { shouldInterrupt, score: interruptionScore } = this.interruptionPolicy.evaluate(
      input.silenceMs,
      isAmbiguous,
      isCorrection,
      input.momentumOverride ?? momentum,
      input.backendVulnerability,
      input.backendEnergy,
      input.questionFatigue ?? 0,
    );

    // 9. Evaluate question
    const isGenuinelyCurious = trajectory.intent === "planning" || trajectory.intent === "unknown";
    const { shouldAsk, value: questionValue } = this.questionEvaluator.evaluate(
      input.clarificationRequired,
      isGenuinelyCurious,
      input.momentumOverride ?? momentum,
      input.backendVulnerability,
      input.questionFatigue ?? 0,
      false,
    );

    // 10. Build decision object
    const decision: SocialDecisionObject = {
      purpose,
      current_topic: momentum.topic,
      user_state: this.getUserState(input.backendVulnerability, input.backendTension, input.backendEnergy),
      conversational_momentum: momentum,
      predicted_direction: {
        intent: trajectory.intent,
        confidence: trajectory.confidence,
      },
      relevant_memory: null,
      behavioral_shift: shift,
      aura_stance: stance,
      contribution_type: contribution,
      response_mode: mode,
      should_question: shouldAsk,
      should_interrupt: shouldInterrupt,
      should_challenge: stance === "challenge",
      should_continue_listening: mode === "listen" || mode === "acknowledge",
      continuity_signal: continuitySignal,
      question_value: questionValue,
      interruption_score: interruptionScore,
      confidence: this.computeOverallConfidence(shift, trajectory.confidence, input.backendVulnerability),
      timestamp: now,
    };

    this.lastDecision = decision;
    return decision;
  }

  /**
   * Format the decision object into a compact LLM prompt block.
   * This is the ONLY output to the LLM — minimal context.
   */
  formatForPrompt(decision: SocialDecisionObject, questionFatigue?: number): string {
    const lines: string[] = [];
    lines.push("[CONVERSATIONAL INTENT]");

    lines.push(`purpose: ${decision.purpose}`);
    lines.push(`topic: ${decision.current_topic}`);

    // User state
    const state = this.userStateForPrompt(decision);
    if (state) lines.push(`user_state: ${state}`);

    // Trajectory
    if (decision.predicted_direction.confidence > 0.4) {
      lines.push(`predicted: ${decision.predicted_direction.intent.replace(/_/g, " ")} (${(decision.predicted_direction.confidence * 100).toFixed(0)}%)`);
    }

    // Momentum note
    const carrier = decision.conversational_momentum.carrier;
    if (carrier === "USER_HIGH") {
      lines.push("note: user is carrying this conversation — respond naturally, no need to lead");
    } else if (carrier === "USER_MEDIUM") {
      lines.push("note: user is contributing — stay responsive");
    } else if (carrier === "AURA_LOW") {
      lines.push("note: user is less engaged — be brief");
    }

    // Storytelling / elaborating — listen
    if (decision.conversational_momentum.storytelling && decision.conversational_momentum.unfinished_thought) {
      lines.push("note: user may be mid-thought — let them continue");
    } else if (decision.conversational_momentum.storytelling) {
      lines.push("note: user is sharing — listen naturally");
    }

    lines.push("[/CONVERSATIONAL INTENT]");

    // Behavioral shift — only if meaningful
    if (decision.behavioral_shift && decision.behavioral_shift.confidence > 0.5) {
      lines.push(`[OBSERVATION]\n${decision.behavioral_shift.description}\n[/OBSERVATION]`);
    }

    // Continuity signal — only if organic
    if (decision.continuity_signal && decision.continuity_signal.organic) {
      lines.push(`[CONTINUITY]\n${decision.continuity_signal.description}\n[/CONTINUITY]`);
    }

    // Stance + contribution (compact)
    lines.push("[RESPONSE DECISION]");

    if (decision.should_challenge) {
      lines.push("stance: challenge (respectful, not confrontational)");
    } else {
      lines.push(`stance: ${decision.aura_stance.replace(/_/g, " ")}`);
    }

    if (decision.contribution_type !== "none") {
      lines.push(`contribution: ${decision.contribution_type}`);
    }

    if (decision.should_continue_listening) {
      lines.push("mode: continue listening");
    } else if (decision.response_mode === "challenge") {
      lines.push("mode: engage directly");
    } else {
      lines.push("mode: respond naturally");
    }

    if (!decision.should_question) {
      const fatigue = questionFatigue !== undefined ? ` (fatigue ${(questionFatigue * 100).toFixed(0)}%)` : "";
      lines.push(`question: no${fatigue}`);
    } else if (decision.should_question) {
      lines.push("question: one natural question ok");
    }

    lines.push("[/RESPONSE DECISION]");

    return lines.join("\n");
  }

  /**
   * Get diagnostic snapshot for the UI.
   * NO extra LLM, Supabase, or embedding calls.
   */
  getDiagnostics(): SocialCognitionSnapshot | null {
    if (!this.lastDecision) return null;
    const d = this.lastDecision;
    return {
      purpose: d.purpose,
      current_topic: d.current_topic,
      momentum: d.conversational_momentum.carrier,
      predicted_trajectory: `${d.predicted_direction.intent} (${(d.predicted_direction.confidence * 100).toFixed(0)}%)`,
      behavioral_shift: d.behavioral_shift ? `${d.behavioral_shift.type} (${(d.behavioral_shift.confidence * 100).toFixed(0)}%)` : "none",
      aura_stance: d.aura_stance,
      response_mode: d.response_mode,
      should_question: d.should_question,
      should_interrupt: d.should_interrupt,
      contribution: d.contribution_type,
      confidence: d.confidence,
      timestamp: d.timestamp,
    };
  }

  /**
   * Get the last decision object (for diagnostics).
   */
  getLastDecision(): SocialDecisionObject | null {
    return this.lastDecision ? { ...this.lastDecision } : null;
  }

  /**
   * Refresh question fatigue values externally (from RuntimeManager/AttentionLayer).
   */
  updateQuestionFatigue(fatigue: number): void {
    // Store for use in next processTurn call
    if (this.lastDecision) {
      this.lastDecision.question_value = fatigue;
    }
  }

  reset(): void {
    this.shiftDetector.reset();
    this.momentumTracker.reset();
    this.continuitySignals.reset();
    this.lastDecision = null;
    this.previousPositionChange = false;
  }

  private determinePurpose(trajectory: string, vulnerability: number): string {
    if (vulnerability > 0.5) return "emotional support";
    switch (trajectory) {
      case "story_continuation":
      case "storytelling":
        return "listen to story";
      case "decision_uncertainty":
        return "help clarify thinking";
      case "emotional_elaboration":
        return "hold space";
      case "planning":
        return "discuss plans";
      case "venting":
        return "vent";
      case "information_seeking":
        return "provide information";
      case "opinion_sharing":
        return "exchange perspectives";
      case "reflection":
        return "reflect together";
      case "closure":
        return "close naturally";
      default:
        return "conversation";
    }
  }

  private getUserState(vulnerability: number, tension: number, energy: number): string {
    if (vulnerability > 0.6) return "vulnerable";
    if (tension > 0.6) return "tense";
    if (energy > 0.7) return "energetic";
    if (energy < 0.3) return "withdrawn";
    return "neutral";
  }

  private userStateForPrompt(decision: SocialDecisionObject): string {
    const m = decision.conversational_momentum;
    if (m.user_wants_space) return "user seems to want space";
    if (m.user_elaborating) return "user is elaborating";
    if (m.unfinished_thought) return "user may not have finished speaking";
    return "";
  }

  private computeOverallConfidence(
    shift: BehavioralShift | null,
    trajectoryConf: number,
    vulnerability: number,
  ): number {
    // Confidence is higher when we have clear signals
    let base = 0.5;
    if (shift && shift.confidence > 0.5) base += 0.1;
    if (trajectoryConf > 0.5) base += 0.1;
    if (vulnerability > 0.3) base += 0.05;
    return Math.round(Math.min(base, 0.95) * 100) / 100;
  }
}

let engineInstance: SocialCognitionEngine | null = null;

export function getSocialCognitionEngine(): SocialCognitionEngine {
  if (!engineInstance) {
    engineInstance = new SocialCognitionEngine();
  }
  return engineInstance;
}
