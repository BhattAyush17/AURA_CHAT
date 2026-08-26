/**
 * ExecutionPlan — the canonical conversational intent.
 *
 * Produced by the ConversationExecutive. Consumed by the Prompt Builder,
 * Speech Planner, and Runtime. Nothing else may override it.
 *
 * The LLM never decides these values. The Executive does.
 */

import type { ConversationContext } from "./ConversationContext";
import type { LanguageState } from "./LanguageState";
import type { RegisterState, RelationshipStage } from "./RegisterState";
import type { ConversationUnderstanding } from "./ConversationUnderstanding";
import type { SocialUnderstanding } from "./SocialWorldModel";

// ─── Strategies ─────────────────────────────────────────────────────

export type Strategy =
  | "Answer"
  | "Ask"
  | "Clarify"
  | "Comfort"
  | "Encourage"
  | "Challenge"
  | "Observe"
  | "Reflect"
  | "Redirect"
  | "Summarize"
  | "Listen";

// ─── Policy domains ─────────────────────────────────────────────────

export type ClarificationDecision =
  | { required: true; reason: string; triggeredBy: ReadonlyArray<string> }
  | { required: false; reason: string };

export type MemoryPolicy = "Required" | "Optional" | "Ignore";

export type InformationBudget = "Tiny" | "Short" | "Normal" | "Detailed" | "DeepDive";

export type Initiative = "Continue" | "Ask" | "Wait" | "Observe" | "Redirect" | "End";

export type ConfidenceLabel = "High" | "Medium" | "Low";

export interface Confidence {
  value: number; // 0–1 composite
  label: ConfidenceLabel;
  sources: ReadonlyArray<string>;
}

// ─── Tone ───────────────────────────────────────────────────────────

export interface Tone {
  warmth: number; // 0–1
  energy: number; // 0–1
  formality: number; // 0–1
  humor: number; // 0–1
  directness: number; // 0–1
}

// ─── Speech behavior (TTS-facing, decoupled from wording) ───────────

export interface SpeechBehavior {
  pauseBeforeMs: number; // Silence before first utterance
  speechSpeed: number; // 0.7–1.3
  energy: number; // 0–1
  warmth: number; // 0–1
  emphasis: number; // 0–1
  thinkingPauses: number; // Expected internal hesitations (0–2)
  reflectionPauses: number; // Longer reflective silences (0–1)
  endingSoftness: number; // 0–1, how gently the response ends
}

// ─── Observable thinking ────────────────────────────────────────────

export type ThinkingBehaviorKind = "none" | "hesitation" | "considering" | "uncertain" | "curious";

export interface ThinkingBehavior {
  kind: ThinkingBehaviorKind;
  utterance: string | null; // e.g. "Hmm…", "Let me think…"
  reason: string | null; // Genuine source: uncertainty or strategy — never filler
}

// ─── The plan ───────────────────────────────────────────────────────

export interface ExecutionPlan {
  readonly context: Readonly<ConversationContext>;
  readonly strategy: Readonly<{
    primary: Strategy;
    secondary: Strategy | null;
  }>;
  readonly language: Readonly<LanguageState>; // Phase 8: canonical register
  readonly register: Readonly<RegisterState>; // Phase 8.1: canonical register
  readonly relationship: RelationshipStage; // Phase 8.1: deterministic ladder
  readonly tone: Readonly<Tone>;
  readonly clarification: ClarificationDecision;
  readonly initiative: Initiative;
  readonly memoryPolicy: MemoryPolicy;
  // Phase 13B: the policy is a decision; the content is what the LLM can
  // actually reference. Both must reach the prompt or the decision is
  // unfulfillable.
  readonly memoryContent: ReadonlyArray<string>;
  readonly informationBudget: InformationBudget;
  readonly speechBehavior: Readonly<SpeechBehavior>;
  readonly thinkingBehavior: Readonly<ThinkingBehavior>;
  readonly confidence: Readonly<Confidence>;

  // Phase 11: the canonical interpretation this plan was built on.
  // Everything downstream may read it; nothing re-interprets.
  readonly understanding: Readonly<ConversationUnderstanding>;

  // Phase 12: the social forces probably influencing this conversation.
  // Evidence only — the Executive decided from it; the LLM never sees it.
  readonly socialUnderstanding: Readonly<SocialUnderstanding>;

  // Explainability — why did the Executive choose this?
  readonly rationale: ReadonlyArray<string>;

  // Deterministic timing of the executive loop itself (target < 50ms)
  readonly executiveTimeMs: number;
}

// ─── Builder ────────────────────────────────────────────────────────

export interface PlanBuildInput {
  context: ConversationContext;
  strategy: { primary: Strategy; secondary: Strategy | null };
  language: LanguageState;
  register: RegisterState;
  relationship: RelationshipStage;
  tone: Tone;
  clarification: ClarificationDecision;
  initiative: Initiative;
  memoryPolicy: MemoryPolicy;
  memoryContent: ReadonlyArray<string>;
  informationBudget: InformationBudget;
  speechBehavior: SpeechBehavior;
  thinkingBehavior: ThinkingBehavior;
  confidence: Confidence;
  understanding: ConversationUnderstanding;
  socialUnderstanding: SocialUnderstanding;
  rationale: string[];
  executiveTimeMs: number;
}

export function buildExecutionPlan(input: PlanBuildInput): Readonly<ExecutionPlan> {
  return Object.freeze({
    context: Object.freeze(input.context),
    strategy: Object.freeze({ ...input.strategy }),
    language: Object.freeze({ ...input.language }),
    register: Object.freeze({ ...input.register }),
    relationship: input.relationship,
    tone: Object.freeze({ ...input.tone }),
    clarification:
      input.clarification.required === false
        ? Object.freeze({ required: false, reason: input.clarification.reason })
        : Object.freeze({
            required: true,
            reason: input.clarification.reason,
            triggeredBy: Object.freeze(input.clarification.triggeredBy),
          }),
    initiative: input.initiative,
    memoryPolicy: input.memoryPolicy,
    memoryContent: Object.freeze(input.memoryContent),
    informationBudget: input.informationBudget,
    speechBehavior: Object.freeze({ ...input.speechBehavior }),
    thinkingBehavior: Object.freeze({
      kind: input.thinkingBehavior.kind,
      utterance: input.thinkingBehavior.utterance,
      reason: input.thinkingBehavior.reason,
    }),
    confidence: Object.freeze({
      value: input.confidence.value,
      label: input.confidence.label,
      sources: Object.freeze(input.confidence.sources),
    }),
    understanding: Object.freeze(input.understanding),
    socialUnderstanding: Object.freeze(input.socialUnderstanding),
    rationale: Object.freeze(input.rationale),
    executiveTimeMs: input.executiveTimeMs,
  });
}
