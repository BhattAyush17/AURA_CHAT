/**
 * SocialPresence — contextual relevance model for what matters right now.
 *
 * Architecture rule: this layer evaluates SIGNIFICANCE, not initiative.
 * It answers "what is socially/contextually meaningful?" AFTER the autonomous
 * engine decides "should AURA speak or wait?".
 *
 * Strict separation:
 *   AutonomousDecision → speak/wait
 *   SocialPresence     → what matters (only if speak is appropriate)
 *
 * NEVER feeds into initiativeScore, conversation_momentum, curiosity_opportunity,
 * knowledge_gap, topic_energy, or interruption_cost.
 *
 * Produces a compact, ranked set of relevance items that reach the LLM
 * through the shared cognitive block — identical for all providers.
 */

export type SignalCategory =
  | "USER_EMOTION"
  | "USER_FRUSTRATION"
  | "USER_VULNERABILITY"
  | "TOPIC_CONTINUITY"
  | "MUSIC_RELEVANCE"
  | "ATMOSPHERE_RELEVANCE"
  | "MEMORY_RELEVANCE"
  | "RELATIONSHIP_SHIFT"
  | "SILENCE_CONTEXT"
  | "INTERRUPTION_CONTEXT"
  | "AURA_STATE";

/**
 * What aspect of AURA's response this signal can legitimately influence.
 * NEVER includes "shouldSpeak".
 */
export type ContentArea =
  | "CONTENT"
  | "TONE"
  | "EMOTIONAL_EXPRESSION"
  | "TOPIC_SELECTION"
  | "MEMORY_SELECTION"
  | "MUSIC_COMMENTARY"
  | "CONTINUATION_STYLE";

/**
 * Bounded relevance: 0.0 = irrelevant, 1.0 = central to the moment.
 * These are NOT initiative scores — they describe significance, not urgency.
 */
export type RelevanceScore = number; // 0.0 – 1.0

export interface RelevanceItem {
  category: SignalCategory;
  relevance: RelevanceScore;
  reason: string;
  canInfluence: ContentArea[];
}

export interface SocialContext {
  items: RelevanceItem[];
  dominantCategory: SignalCategory | null;
  /** Which ContentAreas are actively relevant this turn. */
  activeInfluenceAreas: ContentArea[];
  timestamp: number;
}

/**
 * Input snapshot for the purely-evaluative SocialPresenceEngine.
 * All fields are read-only existing signals — never fabricated.
 */
export interface SocialPresenceInput {
  emotion: {
    tension: number;
    energy: number;
    warmth: number;
    engagement: number;
    frustration: number;
    vulnerability: number;
  };
  music: {
    hasActiveTrack: boolean;
    isPlaying: boolean;
    title: string | null;
    artist: string | null;
  };
  atmospherePresent: boolean;
  memory: {
    hasPersonalHistory: boolean;
    retrievedCount: number;
    maxRelevanceScore: number;
  };
  timing: {
    silenceDurationMs: number;
    turnCount: number;
  };
  userInterrupted: boolean;
  auraJustSpoke: boolean;
  socialMomentum: {
    user_elaborating: boolean;
    unfinished_thought: boolean;
    user_wants_space: boolean;
    topic_depth: number;
    exploratory: boolean;
    storytelling: boolean;
    argumentative: boolean;
  };
  relationshipStage: string;
  /** The autonomous decision's action (already gated — only evaluated when speak is appropriate). */
  autonomousAction: string;
  /** Number of distinct sense sources reporting. */
  senseSourceCount: number;
  /** Whether the user's text references music or song. */
  userMentionsMusic: boolean;
  /** Whether the user's text references the environment. */
  userMentionsEnvironment: boolean;
}

export const RELEVANCE_THRESHOLDS = {
  HIGH: 0.7,
  MEANINGFUL: 0.55,
  WEAK: 0.3,
  IRRELEVANT: 0.0,
} as const;

export const SIGNAL_TO_CONTENT_AREA: Record<SignalCategory, ContentArea[]> = {
  USER_EMOTION: ["TONE", "EMOTIONAL_EXPRESSION", "CONTENT"],
  USER_FRUSTRATION: ["TONE", "EMOTIONAL_EXPRESSION", "CONTENT"],
  USER_VULNERABILITY: ["TONE", "EMOTIONAL_EXPRESSION", "CONTENT"],
  TOPIC_CONTINUITY: ["CONTINUATION_STYLE", "TOPIC_SELECTION", "CONTENT"],
  MUSIC_RELEVANCE: ["MUSIC_COMMENTARY", "CONTENT", "TONE"],
  ATMOSPHERE_RELEVANCE: ["CONTENT", "TONE", "TOPIC_SELECTION"],
  MEMORY_RELEVANCE: ["MEMORY_SELECTION", "CONTENT"],
  RELATIONSHIP_SHIFT: ["TONE", "CONTENT", "CONTINUATION_STYLE"],
  SILENCE_CONTEXT: ["TONE", "CONTENT"],
  INTERRUPTION_CONTEXT: ["TONE", "CONTINUATION_STYLE"],
  AURA_STATE: ["TONE", "EMOTIONAL_EXPRESSION", "CONTENT"],
};
