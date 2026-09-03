/**
 * AutonomousConversationEngine — global, provider-independent decision for
 * whether / when / how AURA should continue conversation.
 *
 * Architecture rules (from the phase brief):
 *  - ONE global module. No provider-local copies.
 *  - Consumes EXISTING cognitive signals; never re-implements them.
 *  - Silence (WAIT) is a valid decision.
 *  - Curiosity is separated from "should a question be asked".
 *  - Closure is respected.
 *  - Timing is a signal, never a fixed "speak after X sec" trigger.
 *  - Relevant memory ≠ interesting memory: only surface memories with a
 *    strong contextual reason.
 *  - Internal tuples (initiativeScore, signal names, flags, scores) never
 *    leave this module into the prompt (see formatAutonomousBlock).
 *
 * evaluateAutonomous is a PURE, deterministic function of its input so it is
 * trivially unit-testable. The in-memory feedback tracker is kept off the
 * pure path (a separate recordOutcome() store) to preserve determinism.
 */

import type {
  AutonomousConversationDecision,
  AutonomousInput,
  AutonomousOpportunity,
  AutonomousAction,
  AutonomyLevel,
  UtteranceCategory,
} from "./types";

const clamp = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Audit sentinel: documents that every action in the vocabulary is reachable
 * (dead-branch audit target). Unused by design.
 */
const ALL_ACTIONS: readonly AutonomousAction[] = [
  "RESPOND_ONLY",
  "ACKNOWLEDGE",
  "OBSERVE",
  "CONTINUE",
  "FOLLOW_UP",
  "ASK",
  "EXPLORE",
  "OFFER",
  "RECALL",
  "PROACTIVELY_RETURN",
  "REFLECT",
  "CLARIFY",
  "PROACTIVELY_ENGAGE",
  "WAIT",
];

const clamp01 = clamp;

function scoreOpportunities(input: AutonomousInput): AutonomousOpportunity {
  const s = input.social.conversational_momentum;
  const emo = input.emotion;
  const inM = input.initiativeMetrics;
  const justSpoke = input.auraJustSpoke === true;
  const interrupted = input.userInterrupted === true;

  // Cross-sense relevance (RELEVANCE ONLY — never an independent "speak now"
  // trigger). Music/atmosphere/sense enrich an opportunity already present
  // (continuation, offer, explore, curiosity) but are always overridden by
  // closure / interruption / just-spoke short-circuits upstream.
  const musicRelevance = input.hasMusicContext === true ? 0.15 : 0;
  const atmosphereRelevance = input.atmospherePresent === true ? 0.12 : 0;
  const senseRelevance =
    (input.senseSnapshot && input.senseSnapshot.sourceCount > 0 ? 0.1 : 0) +
    (input.senseSnapshot?.musicDetected && !input.hasMusicContext ? 0.06 : 0);

  const user_carrying = clamp01(
    (s.user_elaborating ? 0.55 : 0) +
      (input.speakerGoal === "tell-story" ? 0.3 : 0) +
      (input.literal === "story" ? 0.3 : 0) +
      (s.storytelling ? 0.25 : 0),
  );

  const user_yielding = clamp01(
    (s.user_elaborating ? 0 : 0.45) +
      (input.speakerGoal === "inform" || input.speakerGoal === "seek-information" ? 0.3 : 0) +
      (inM.lastUserRespondedToQuestion ? 0.2 : 0) +
      (input.move === "Comfort" ? 0.15 : 0),
  );

  const conversation_momentum = clamp01(
    0.3 +
      (s.topic_depth >= 2 ? 0.2 : 0) +
      (s.exploratory ? 0.15 : 0) +
      (emo.engagement > 0.6 ? 0.2 : 0) +
      emo.energy * 0.1,
  );

  const emotional_opportunity = clamp01(
    emo.warmth * 0.4 +
      emo.vulnerability * 0.45 +
      (input.shared.emotionUnresolved ? 0.3 : 0) +
      (emo.arc === "peak" ? 0.15 : 0),
  );

  const curiosity_opportunity = clamp01(
    (input.speakerGoal === "share-excitement" ? 0.4 : 0) +
      (s.exploratory ? 0.25 : 0) +
      (emo.engagement > 0.7 ? 0.2 : 0) +
      (input.literal === "opinion" ? 0.15 : 0),
  );

  const continuity_opportunity = clamp01(
    (input.shared.topicUnfinished ? 0.45 : 0) +
      (s.unfinished_thought ? 0.35 : 0) +
      (input.move === "Continue" ? 0.25 : 0) +
      (s.topic_depth >= 2 ? 0.1 : 0),
  );

  // Relevant memory (has strong contextual reason) vs merely-interesting memory.
  const memory_interesting_only = clamp01(input.memoryInterestingButNotRelevant ? 0.9 : 0);
  const memory_opportunity = clamp01(
    (input.memory.hasPersonalHistory && input.memory.retrievedCount > 0 ? 0.5 : 0) +
      (input.planMemoryPolicy === "Required" ? 0.4 : 0) +
      (input.planMemoryPolicy === "Optional" ? 0.2 : 0) -
      memory_interesting_only * 0.6,
  );

  const social_opportunity = clamp01(
    0.5 +
      (input.social.should_continue_listening ? -0.15 : 0.2) +
      user_yielding * 0.3 -
      (s.user_wants_space ? 0.4 : 0) -
      input.questionFatigue * 0.35 -
      emo.vulnerability * 0.25 -
      input.frustration * 0.25,
  );

  const knowledge_gap = clamp01(
    (input.expected === "information" || input.expected === "advice" ? 0.5 : 0) +
      (input.strategy === "Answer" ? 0.3 : 0) +
      (input.shared.openQuestion ? 0.2 : 0),
  );

  const topic_energy = clamp01(
    emo.energy * 0.4 + emo.engagement * 0.4 + (s.exploratory || s.storytelling ? 0.2 : 0),
  );

  const closure_signal = clamp01(
    (input.literal === "goodbye" ? 1 : 0) +
      (input.speakerGoal === "close" ? 0.8 : 0) +
      (input.literal === "backchannel" && input.move === "Close" ? 0.5 : 0) +
      (s.user_wants_space ? 0.3 : 0),
  );

  const silence_value = clamp01(
    (input.timing.silenceDurationMs > 8000 ? 0.8 : 0) +
      (s.user_wants_space ? 0.6 : 0) +
      (input.shared.repairPending ? 0.4 : 0) +
      input.questionFatigue * 0.3 +
      (input.move === "Wait" ? 0.5 : 0),
  );

  const recent_question_fatigue = clamp01(
    input.questionFatigue + (input.lastUserGaveShortAnswer === true ? 0.25 : 0),
  );

  // Cost of speaking over the user / of re-initiating right after AURA spoke.
  const interruption_cost = clamp01(
    (interrupted ? 0.8 : 0) +
      (justSpoke ? 0.5 : 0) +
      (s.user_elaborating ? 0.4 : 0) +
      (input.move === "Wait" ? 0.5 : 0),
  );

  // Urgency: how much AURA genuinely needs/owes information right now.
  const urgency = clamp01(
    knowledge_gap * 0.5 +
      (input.shared.openQuestion ? 0.3 : 0) +
      (input.expected === "advice" ? 0.2 : 0) +
      input.frustration * 0.15,
  );

  const curiosity_detected = clamp01(curiosity_opportunity);

  return {
    user_carrying,
    user_yielding,
    conversation_momentum,
    emotional_opportunity,
    curiosity_opportunity,
    continuity_opportunity,
    memory_opportunity,
    memory_interesting_only,
    social_opportunity,
    knowledge_gap,
    topic_energy,
    closure_signal,
    silence_value,
    recent_question_fatigue,
    interruption_cost,
    urgency,
    curiosity_detected,
  };
}

function autonomyLevel(o: AutonomousOpportunity): AutonomyLevel {
  if (o.social_opportunity > 0.72 && o.topic_energy > 0.62) return "PROACTIVE";
  if (o.social_opportunity > 0.5 && o.topic_energy > 0.42) return "BALANCED";
  if (o.silence_value > 0.55 || o.user_carrying > 0.6) return "RESTRAINED";
  return "HOLD";
}

function permissionFor(o: AutonomousOpportunity): "allowed" | "discouraged" | "prohibited" {
  if (o.closure_signal >= 0.9 || o.interruption_cost >= 0.7) return "prohibited";
  if (o.recent_question_fatigue > 0.7 || o.interruption_cost >= 0.45) return "discouraged";
  return "allowed";
}

function categoryFor(action: AutonomousAction, shouldSpeak: boolean): UtteranceCategory {
  if (!shouldSpeak) return "WAIT";
  if (action === "PROACTIVELY_RETURN" || action === "PROACTIVELY_ENGAGE") {
    return "AUTONOMOUS_REENGAGEMENT";
  }
  if (action === "CONTINUE" || action === "FOLLOW_UP" || action === "EXPLORE") {
    return "AUTONOMOUS_CONTINUATION";
  }
  return "USER_TURN_RESPONSE";
}

function phraseFor(o: AutonomousOpportunity, level: AutonomyLevel): string {
  if (level === "PROACTIVE") {
    if (o.curiosity_opportunity > 0.5) return "what the user said clearly sparked genuine interest";
    if (o.memory_opportunity > 0.5) return "a shared memory with the user is worth coming back to";
    return "there is a natural next step to take here";
  }
  if (level === "BALANCED")
    return o.continuity_opportunity > 0.5
      ? "to keep the ongoing thread moving"
      : "to go a little deeper into the user's point";
  if (level === "RESTRAINED") return "to keep this brief and leave the user space";
  return "to hold and let the user take the lead";
}

/**
 * Prospective confidence used to gate autonomous actions. Low confidence on an
 * otherwise attractive autonomous opportunity ⇒ wait (scenario 16).
 */
function prospectiveConfidence(o: AutonomousOpportunity): number {
  return clamp01(
    0.5 +
      o.social_opportunity * 0.2 -
      o.recent_question_fatigue * 0.3 -
      o.interruption_cost * 0.35 +
      o.conversation_momentum * 0.15,
  );
}

function decideAction(
  input: AutonomousInput,
  o: AutonomousOpportunity,
  level: AutonomyLevel,
): { action: AutonomousAction; shouldSpeak: boolean; reason: string } {
  const emo = input.emotion;
  const interrupted = input.userInterrupted === true;
  const justSpoke = input.auraJustSpoke === true;
  const shortAnswer = input.lastUserGaveShortAnswer === true;

  // 1) User interrupted AURA → suppress initiative entirely.
  if (interrupted) {
    return {
      action: "WAIT",
      shouldSpeak: false,
      reason: "user interrupted → initiative suppressed",
    };
  }

  // 2) AURA just spoke with no fresh user input → avoid immediate re-initiation.
  if (justSpoke && input.timing.silenceDurationMs < 1500) {
    return {
      action: "WAIT",
      shouldSpeak: false,
      reason: "AURA just spoke → no immediate unnecessary re-initiation",
    };
  }

  // 3) Closure — respect it above all. No push, no follow-up, no question.
  if (o.closure_signal >= 0.55) {
    return {
      action: "WAIT",
      shouldSpeak: o.closure_signal >= 0.9 || o.silence_value < 0.4,
      reason: `closure signal ${o.closure_signal.toFixed(2)} → respect thread end`,
    };
  }

  // 4) Repair pending — resolve before anything else.
  if (input.shared.repairPending || input.literal === "repair" || input.literal === "correction") {
    return { action: "CLARIFY", shouldSpeak: true, reason: "repair/ambiguity → clarify first" };
  }
  if (input.strategy === "Clarify") {
    return { action: "CLARIFY", shouldSpeak: true, reason: "strategy requires clarification" };
  }

  // 5) Frustration — never dismissive, never a facade question; reflect/acknowledge.
  if (emo.frustration > 0.6 || input.frustration > 0.6) {
    return {
      action: emo.vulnerability > 0.4 ? "ACKNOWLEDGE" : "REFLECT",
      shouldSpeak: true,
      reason: "frustrated user → reflect/acknowledge, not dismissive",
    };
  }

  // 6) Emotional openness — acknowledge before all else (empathy first).
  if (emo.vulnerability > 0.5 || input.shared.emotionUnresolved) {
    return {
      action: "ACKNOWLEDGE",
      shouldSpeak: true,
      reason: "vulnerable context → acknowledge first",
    };
  }

  // 7) Silence/space — user wants space or long pause. Silent is valid.
  if (o.silence_value >= 0.6) {
    return {
      action: "WAIT",
      shouldSpeak: false,
      reason: `silence valued ${o.silence_value.toFixed(2)} → do not auto-fill`,
    };
  }
  if (input.move === "Wait" || o.user_carrying > 0.6) {
    return {
      action: "OBSERVE",
      shouldSpeak: o.social_opportunity < 0.35 ? false : true,
      reason: "user holds the floor → observe, do not push",
    };
  }

  // 8) Repeated short answers → decreasing initiative (never an interview).
  if (shortAnswer && o.recent_question_fatigue > 0.55) {
    return {
      action: emo.vulnerability > 0.3 ? "ACKNOWLEDGE" : "OBSERVE",
      shouldSpeak: true,
      reason: "repeated short answers → low-key acknowledge, do not interrogate",
    };
  }

  // 9) Separation: curiosity ≠ question. High curiosity + low social
  //    opportunity MUST NOT force a question.
  const questionJustified = o.social_opportunity > 0.5 && o.recent_question_fatigue < 0.5;
  const confident = prospectiveConfidence(o) >= 0.5;

  // 10) User asked / requested → answer; optionally follow up.
  if (input.literal === "question" || input.literal === "request" || input.strategy === "Answer") {
    if (o.curiosity_detected > 0.5 && questionJustified && confident) {
      return {
        action: "FOLLOW_UP",
        shouldSpeak: true,
        reason: "answered + genuine curiosity + low fatigue",
      };
    }
    return {
      action: "RESPOND_ONLY",
      shouldSpeak: true,
      reason: "direct answer to explicit request",
    };
  }

  // 11) Relevant memory (NOT merely interesting) + curiosity → surface it.
  if (
    o.memory_opportunity > 0.6 &&
    o.memory_interesting_only < 0.5 &&
    o.curiosity_detected > 0.45 &&
    o.social_opportunity > 0.5
  ) {
    return {
      action:
        input.move === "Continue" || o.continuity_opportunity > 0.5
          ? "PROACTIVELY_RETURN"
          : "RECALL",
      shouldSpeak: true,
      reason: "durable, relevant memory + curiosity → surface naturally",
    };
  }

  // 12) Thread continuation.
  if (o.continuity_opportunity > 0.55 && o.social_opportunity > 0.45) {
    return { action: "CONTINUE", shouldSpeak: true, reason: "active thread wants continuation" };
  }

  // 13) Proactive engagement only on a strong + confident opening.
  if (level === "PROACTIVE" && o.curiosity_opportunity > 0.5 && questionJustified && confident) {
    return {
      action: "PROACTIVELY_ENGAGE",
      shouldSpeak: true,
      reason: "strong opening + curiosity + social clearance + confidence",
    };
  }
  if (level === "PROACTIVE" && o.topic_energy > 0.6 && confident) {
    return { action: "EXPLORE", shouldSpeak: true, reason: "high energy topic worth exploring" };
  }

  // 14) Autonomous opportunity exists but confidence is low → WAIT, don't force.
  if ((o.curiosity_opportunity > 0.5 || level === "PROACTIVE") && !confident) {
    return {
      action: "WAIT",
      shouldSpeak: false,
      reason: "autonomous opportunity but low confidence → wait",
    };
  }

  // 15) Socially justified genuine question — need/opportunity, never forced.
  if (o.curiosity_detected > 0.4 && questionJustified) {
    return {
      action: "ASK",
      shouldSpeak: true,
      reason: "curiosity + social clearance + low fatigue",
    };
  }

  // 16) Offer support/next step rather than a question.
  if (o.knowledge_gap > 0.3 && o.social_opportunity > 0.4) {
    return {
      action: "OFFER",
      shouldSpeak: true,
      reason: "can offer a next step without forcing a question",
    };
  }

  // 17) Default — respond to what was said, no push.
  return {
    action: "RESPOND_ONLY",
    shouldSpeak: true,
    reason: "fallback: respond without over-reaching",
  };
}

export function evaluateAutonomous(input: AutonomousInput): AutonomousConversationDecision {
  const o = scoreOpportunities(input);
  const level = autonomyLevel(o);
  const permission = permissionFor(o);
  const { action, shouldSpeak, reason } = decideAction(input, o, level);

  // Permission may hard-block speech even after a positive action was chosen.
  const finalSpeak = shouldSpeak && permission !== "prohibited";
  const finalAction: AutonomousAction = finalSpeak ? action : "WAIT";

  // Composite initiative: how proactive is AURA being?
  const baseline =
    o.topic_energy * 0.3 +
    o.curiosity_opportunity * 0.25 +
    o.conversation_momentum * 0.2 +
    o.memory_opportunity * 0.15 +
    o.continuity_opportunity * 0.1;
  const initiativeScore = clamp01(
    finalSpeak ? baseline * (level === "PROACTIVE" ? 1.15 : 1) : baseline * 0.35,
  );

  const confidence = prospectiveConfidence(o);

  const memoryOpportunity = o.memory_opportunity > 0.45 && o.memory_interesting_only < 0.5;

  return {
    shouldSpeak: finalSpeak,
    action: finalAction,
    utteranceCategory: categoryFor(finalAction, finalSpeak),
    permission,
    initiativeScore,
    urgency: o.urgency,
    interruptionCost: o.interruption_cost,
    confidence,
    reason,
    topicContinuation: finalSpeak ? phraseFor(o, level) : undefined,
    curiosityOpportunity: o.curiosity_detected,
    emotionalOpportunity: o.emotional_opportunity,
    memoryOpportunity,
    responseGuidance: buildGuidance(finalAction, o, finalSpeak),
    rawSignals: o,
  };
}

function buildGuidance(
  action: AutonomousAction,
  o: AutonomousOpportunity,
  shouldSpeak: boolean,
): string {
  if (!shouldSpeak) return "Hold; do not manufacture speech.";
  switch (action) {
    case "ACKNOWLEDGE":
      return "Lead with warm acknowledgment of how the user is feeling.";
    case "OBSERVE":
      return "Offer a light acknowledgment; let the user keep talking.";
    case "CONTINUE":
      return "Keep the active thread moving forward naturally.";
    case "FOLLOW_UP":
      return "Answer, then extend with one genuine, unpressed pivot.";
    case "ASK":
      return "Ask one genuine, open question — do not interrogate.";
    case "EXPLORE":
      return "Open up the angle the user surfaced; stay curious.";
    case "OFFER":
      return "Offer a relevant next step or support (not a question).";
    case "RECALL":
      return "Invoke the relevant memory naturally, as if remembering.";
    case "PROACTIVELY_RETURN":
      return "Naturally return to the earlier point that connects here.";
    case "REFLECT":
      return "Offer a calm, supportive reflection; do not interrogate.";
    case "CLARIFY":
      return "Resolve the ambiguity exactly once, then move on.";
    case "PROACTIVELY_ENGAGE":
      return "Follow the spark and engage with genuine interest.";
    case "WAIT":
      return "Hold; do not manufacture speech.";
    case "RESPOND_ONLY":
    default:
      return "Answer directly and concisely; do not over-reach.";
  }
}

// ─── Feedback loop (off the pure path, keeps evaluate() deterministic) ──

export interface AutonomousOutcome {
  actionTaken: AutonomousAction;
  askedQuestion: boolean;
  userAnswered: boolean;
  userElaborated: boolean;
  userDisengaged: boolean;
  userInterrupted: boolean;
  initiativeWasUseful: boolean;
  timestamp: number;
}

class AutonomousConversationEngineImpl {
  private static readonly instance: AutonomousConversationEngineImpl =
    new AutonomousConversationEngineImpl();

  private last: AutonomousConversationDecision | null = null;
  private recentOutcomes: AutonomousOutcome[] = [];

  static getInstance(): AutonomousConversationEngineImpl {
    return AutonomousConversationEngineImpl.instance;
  }

  evaluate(input: AutonomousInput): AutonomousConversationDecision {
    const decision = evaluateAutonomous(input);
    this.last = decision;
    return decision;
  }

  getLastDecision(): AutonomousConversationDecision | null {
    return this.last;
  }

  /** Record what happened after a response so future initiative can adapt. */
  recordOutcome(outcome: AutonomousOutcome): void {
    this.recentOutcomes.push(outcome);
    if (this.recentOutcomes.length > 24) this.recentOutcomes.shift();
  }

  getRecentOutcomes(): readonly AutonomousOutcome[] {
    return this.recentOutcomes;
  }

  clear(): void {
    this.last = null;
    this.recentOutcomes = [];
  }
}

export function getAutonomousConversationEngine(): AutonomousConversationEngineImpl {
  return AutonomousConversationEngineImpl.getInstance();
}
