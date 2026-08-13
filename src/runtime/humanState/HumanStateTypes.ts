/**
 * AURA Phase F - Human State & Affective Intelligence
 * Core Type Definitions
 */

export interface HumanStateDimension {
  /** Numerical estimate of the dimension. Range depends on dimension (typically -1.0 to 1.0 or 0.0 to 1.0) */
  estimate: number;
  /** 0.0 to 1.0 representing how reliable this estimate is based on available evidence */
  confidence: number;
}

export interface EvidenceReference {
  source: string;
  feature: string;
  observationId?: string;
  contribution: "supporting" | "contradicting";
}

export interface HumanStateHypothesis {
  /** The semantic label, e.g., "possible frustration", "uncertain affective state" */
  type: string;
  /** 0.0 to 1.0 representing certainty */
  confidence: number;
  /** List of observed evidence supporting this hypothesis (e.g., "increased vocal intensity") */
  supportingEvidence: string[];
  /** Structured references to the evidence supporting this hypothesis */
  supportingReferences?: EvidenceReference[];
  /** List of observed evidence contradicting this hypothesis (e.g., "neutral linguistic content") */
  contradictingEvidence: string[];
  /** Structured references to the evidence contradicting this hypothesis */
  contradictingReferences?: EvidenceReference[];
}

export interface AffectiveState {
  /** -1.0 (withdrawn/negative) to 1.0 (engaged/positive) */
  valence: HumanStateDimension;
  /** -1.0 (calm/low energy) to 1.0 (excited/agitated) */
  arousal: HumanStateDimension;
  /** 0.0 (relaxed) to 1.0 (high tension) */
  tension: HumanStateDimension;
  /** 0.0 (withdrawn) to 1.0 (highly engaged) */
  engagement: HumanStateDimension;

  hypotheses: HumanStateHypothesis[];
}

export interface ConversationalState {
  intent?: string;
  topic?: string;
  momentum?: number;
  completion?: number;
  uncertainty?: number;
}

export interface HumanState {
  affective: AffectiveState;
  conversational: ConversationalState;
  lastUpdated: number;
}

export const createInitialHumanState = (): HumanState => ({
  affective: {
    valence: { estimate: 0, confidence: 0 },
    arousal: { estimate: 0, confidence: 0 },
    tension: { estimate: 0, confidence: 0 },
    engagement: { estimate: 0, confidence: 0 },
    hypotheses: [],
  },
  conversational: {},
  lastUpdated: Date.now(),
});
