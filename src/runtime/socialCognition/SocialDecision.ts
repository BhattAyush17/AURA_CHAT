export type AuraStance =
  | "agree"
  | "partially_agree"
  | "disagree"
  | "challenge"
  | "question"
  | "clarify"
  | "neutral"
  | "acknowledge"
  | "alternative_perspective";

export type ContributionType =
  | "observation"
  | "opinion"
  | "interpretation"
  | "connection"
  | "counterpoint"
  | "analogy"
  | "curiosity"
  | "humor"
  | "reaction"
  | "information"
  | "reflection"
  | "none";

export type ResponseMode =
  | "listen"
  | "respond"
  | "acknowledge"
  | "challenge"
  | "ask"
  | "reflect"
  | "react";

export type MomentumCarrier = "USER_HIGH" | "USER_MEDIUM" | "BALANCED" | "AURA_LOW";

export type BehavioralShiftType =
  | "message_length_change"
  | "energy_change"
  | "playfulness_change"
  | "decisiveness_change"
  | "topic_change"
  | "question_pattern_change"
  | "emotional_intensity_change"
  | "none";

export type TrajectoryIntent =
  | "story_continuation"
  | "decision_uncertainty"
  | "emotional_elaboration"
  | "planning"
  | "information_seeking"
  | "venting"
  | "storytelling"
  | "opinion_sharing"
  | "reflection"
  | "closure"
  | "unknown";

export interface PersonObservation {
  id: string;
  label: string;
  category: string;
  evidence_count: number;
  confidence: number;
  last_observed: number;
  first_observed: number;
  significance: number;
  samples: string[];
}

export interface BehavioralShift {
  type: BehavioralShiftType;
  confidence: number;
  previous_behavior: string;
  current_behavior: string;
  description: string;
}

export interface TrajectoryPrediction {
  intent: TrajectoryIntent;
  confidence: number;
  cue: string;
}

export interface ConversationalMomentum {
  carrier: MomentumCarrier;
  topic: string;
  topic_depth: number;
  unfinished_thought: boolean;
  user_elaborating: boolean;
  aura_recently_interrupted: boolean;
  user_wants_space: boolean;
  exploratory: boolean;
  argumentative: boolean;
  storytelling: boolean;
}

export interface ContinuitySignal {
  type: "topic_recurrence" | "position_change" | "pattern_change";
  confidence: number;
  description: string;
  organic: boolean;
}

export interface SocialDecisionObject {
  purpose: string;
  current_topic: string;
  user_state: string;
  conversational_momentum: ConversationalMomentum;
  predicted_direction: { intent: string; confidence: number };
  relevant_memory: string | null;
  behavioral_shift: BehavioralShift | null;
  aura_stance: AuraStance;
  contribution_type: ContributionType;
  response_mode: ResponseMode;
  should_question: boolean;
  should_interrupt: boolean;
  should_challenge: boolean;
  should_continue_listening: boolean;
  continuity_signal: ContinuitySignal | null;
  question_value: number;
  interruption_score: number;
  confidence: number;
  timestamp: number;
}

export interface SocialCognitionSnapshot {
  purpose: string;
  current_topic: string;
  momentum: MomentumCarrier;
  predicted_trajectory: string;
  behavioral_shift: string;
  aura_stance: AuraStance;
  response_mode: ResponseMode;
  should_question: boolean;
  should_interrupt: boolean;
  contribution: ContributionType;
  confidence: number;
  timestamp: number;
}
