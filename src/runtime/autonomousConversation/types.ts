/**
 * AutonomousConversation — types for the provider-independent, global
 * "whether / when / how AURA should naturally continue" decision.
 *
 * This is an orchestration layer. It consumes existing cognitive signals
 * (ConversationUnderstanding, ExecutionPlan, Adaptive Attention initiative
 * metrics, Social Cognition, Emotion, Memory, Atmosphere, Music, Timing) and
 * produces ONE canonical decision that every provider (OpenRouter, Sarvam,
 * Gemini) consumes through the shared cognitive block.
 *
 * It never re-implements any underlying cognitive system, and it never leaks
 * internal scores or controller/flags into the prompt (see formatAutonomousBlock).
 */

import type { Initiative, Strategy, MemoryPolicy } from "@/executive/ExecutionPlan";
import type {
  LiteralMeaning,
  ConversationMove,
  SpeakerGoal,
  ExpectedResponse,
} from "@/executive/ConversationUnderstanding";
import type { ConversationalMomentum } from "@/runtime/socialCognition/SocialDecision";
import type { InitiativeMetrics } from "@/runtime/attention/AdaptiveAttentionLayer";

// ─── Action vocabulary ───────────────────────────────────────────────

/**
 * The full autonomous action space. WAIT is a first-class decision: it is
 * valid for AURA to hold silence. Not every turn produces speech.
 */
export type AutonomousAction =
  | "RESPOND_ONLY" // Answer the user's explicit question/request directly.
  | "ACKNOWLEDGE" // Recognize emotion/state first; keep it short.
  | "OBSERVE" // Acknowledge without pushing; user holds the floor.
  | "CONTINUE" // Keep an unfinished/active thread moving.
  | "FOLLOW_UP" // Extend user's point with a natural, unpushed pivot.
  | "ASK" // Ask a genuine question (socially justified, low fatigue).
  | "EXPLORE" // Open up a thread / new angle the user surfaced.
  | "OFFER" // Offer support/help/next step (not a forced question).
  | "RECALL" // Fold a relevant durable memory in naturally.
  | "PROACTIVELY_RETURN" // Proactively return to a RELEVANT previous topic.
  | "REFLECT" // Offer a natural reflective observation (not a question).
  | "CLARIFY" // Resolve an ambiguity/repair before proceeding.
  | "PROACTIVELY_ENGAGE" // Initiate on a strong emotive/cognitive opening.
  | "WAIT"; // Hold silence; do not manufacture speech.

export type AutonomyLevel = "HOLD" | "RESTRAINED" | "BALANCED" | "PROACTIVE";

/**
 * Utterance category — separates a response to the user's turn from an
 * autonomous, unsolicited AURA utterance. Future presence/timing systems use
 * this to decide when an unsolicited utterance is actually appropriate.
 */
export type UtteranceCategory =
  | "USER_TURN_RESPONSE" // A direct reply to what the user just said.
  | "AUTONOMOUS_CONTINUATION" // Continue an active thread unprompted.
  | "AUTONOMOUS_REENGAGEMENT" // Proactively return to/reopen a relevant thread.
  | "WAIT"; // No speech.

// ─── Evaluated opportunity signals ───────────────────────────────────

/**
 * The scored opportunity model. Each term is derived from existing signals.
 * These are INTERNAL — the prompt renderer never prints them.
 */
export interface AutonomousOpportunity {
  /** User is elaborating / carrying the thread (value low ⇒ user yielded). */
  user_carrying: number;
  /** User yielded the floor and AURA may speak. */
  user_yielding: number;
  /** Overall conversational momentum 0–1. */
  conversation_momentum: number;
  /** An emotional opening worth acknowledging 0–1. */
  emotional_opportunity: number;
  /** AURA's own curiosity about what the user said 0–1. */
  curiosity_opportunity: number;
  /** A thread wants continuation 0–1. */
  continuity_opportunity: number;
  /** A durable/personal memory is relevant 0–1. */
  memory_opportunity: number;
  /** A memory exists but is only "interesting" (not relevant) 0–1. */
  memory_interesting_only: number;
  /** It is socially appropriate to engage 0–1. */
  social_opportunity: number;
  /** There is a real knowledge gap AURA could address 0–1. */
  knowledge_gap: number;
  /** The topic has energy 0–1. */
  topic_energy: number;
  /** The user is signalling closure 0–1. */
  closure_signal: number;
  /** Silence is more appropriate than speech 0–1. */
  silence_value: number;
  /** Fatigue with repeated questions 0–1 (from initiative metrics). */
  recent_question_fatigue: number;
  /** Cost of interrupting the user right now 0–1 (interruption / just-spoke). */
  interruption_cost: number;
  /** How urgently AURA genuinely needs/answers information 0–1. */
  urgency: number;
  /**
   * Pure information: AURA noticed something curious. This is SEPARATE from
   * whether a question SHOULD be asked — high curiosity with low social
   * opportunity must NOT force a question.
   */
  curiosity_detected: number;
}

// ─── Decision ────────────────────────────────────────────────────────

export interface AutonomousConversationDecision {
  /** Whether AURA should produce speech this turn. False ⇒ WAIT. */
  shouldSpeak: boolean;
  action: AutonomousAction;
  /** Response vs autonomous initiation — for future presence/timing systems. */
  utteranceCategory: UtteranceCategory;
  /** Policy-level permission gating initiative. */
  permission: "allowed" | "discouraged" | "prohibited";
  /** 0–1 composite initiative; higher = more proactive speech. */
  initiativeScore: number;
  /** 0–1 how urgently AURA needs/answers information. */
  urgency: number;
  /** 0–1 cost of speaking over the user / re-initiation cost. */
  interruptionCost: number;
  /** 0–1 confidence in the decision. */
  confidence: number;
  /** Human-readable reason (telemetry/explainability only — never in the prompt). */
  reason?: string;
  /** A natural continuation phrase AURA may use (prompt-safe, optional). */
  topicContinuation?: string;
  /** Curiosity info surfaced for downstream use (never leaked on its own). */
  curiosityOpportunity?: number;
  emotionalOpportunity?: number;
  memoryOpportunity?: boolean;
  /** Compact, natural-language guidance rendered into the prompt. */
  responseGuidance?: string;
  /** Full internal signal trace — for tests/telemetry/debug; NEVER rendered to prompt. */
  rawSignals: AutonomousOpportunity;
}

// ─── Input contract ──────────────────────────────────────────────────

/**
 * Real-time, provider-supplied presence/timing signals for the current turn.
 * These are OPTIONAL and default to their neutral value when unavailable —
 * never fabricated. Providers thread real acoustic/turn-taking signals here so
 * the global engine consumes the same truth regardless of provider/transport.
 */
export interface AutonomousRuntimeSignals {
  /** The user barge-in / talked-over AURA this turn (true ⇒ suppress initiative). */
  wasInterruption?: boolean;
  /** Measured silence since the last speech activity (ms). */
  silenceDurationMs?: number;
  /** AURA produced speech earlier in this turn / very recently. */
  auraJustSpoke?: boolean;
}

/**
 * The fully-materialized input to the engine. The engine is a pure function
 * of this snapshot so it is trivially and deterministically testable. The
 * RuntimeManager builds this from live, existing signals.
 */
export interface AutonomousInput {
  planInitiative: Initiative;
  strategy: Strategy;
  literal: LiteralMeaning;
  move: ConversationMove;
  speakerGoal: SpeakerGoal;
  expected: ExpectedResponse;
  shared: {
    openQuestion: boolean;
    repairPending: boolean;
    topicUnfinished: boolean;
    emotionUnresolved: boolean;
  };
  emotion: {
    tension: number;
    energy: number;
    warmth: number;
    engagement: number;
    frustration: number;
    vulnerability: number;
    arc: string;
  };
  memory: {
    hasPersonalHistory: boolean;
    retrievedCount: number;
    relevanceScores: readonly number[];
  };
  timing: {
    silenceDurationMs: number;
    turnCount: number;
  };
  /**
   * Presence / turn-taking signals. When unavailable, these default to their
   * neutral value (false) — never fabricated.
   */
  userInterrupted?: boolean;
  auraJustSpoke?: boolean;
  /** The user's last utterance was a short/terse answer (repeated-short-answer fatigue). */
  lastUserGaveShortAnswer?: boolean;
  /** A memory exists that is merely interesting, with NO strong contextual relevance. */
  memoryInterestingButNotRelevant?: boolean;
  frustration: number;
  initiativeMetrics: InitiativeMetrics;
  social: {
    should_question: boolean;
    should_continue_listening: boolean;
    question_value: number;
    conversational_momentum: Pick<
      ConversationalMomentum,
      | "user_elaborating"
      | "unfinished_thought"
      | "user_wants_space"
      | "topic_depth"
      | "exploratory"
      | "storytelling"
      | "argumentative"
    >;
  };
  questionFatigue: number;
  planMemoryPolicy: MemoryPolicy;
  /**
   * Music state (binary presence). Consumed by the engine as a RELEVANCE
   * signal only — it may enrich an existing opportunity (e.g. a music-aware
   * OFFER) but never independently forces speech. Never overrides closure or
   * interruption.
   */
  hasMusicContext: boolean;
  /**
   * Environmental/contextual grounding present (binary). Consumed as a
   * relevance signal — adds contextual depth to momentum/topic-energy so AURA
   * may add grounded context when an opportunity already exists. Never forces
   * speech on its own.
   */
  atmospherePresent: boolean;
  /**
   * Compact, normalized snapshot of the live sense layer (music/voice/etc).
   * Deliberately coarse so the pure engine stays deterministic and cheap; the
   * rich sensor detail lives in the perception layer, not here.
   */
  senseSnapshot?: {
    /** At least one non-conversational signal detected (music, environment, etc). */
    musicDetected: boolean;
    /** Non-conversational voice/acoustic activity detected. */
    voicesDetected: boolean;
    /** Number of distinct sense sources reporting evidence this cycle. */
    sourceCount: number;
  };
}
