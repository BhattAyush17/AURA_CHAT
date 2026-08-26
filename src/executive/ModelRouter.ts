/**
 * ModelRouter — Phase 14.2. One deterministic Executive decision: which
 * model should realize this turn.
 *
 * The router consumes ONLY existing Executive outputs (strategy, register,
 * relationship, language, tone, understanding, social world model,
 * information budget). It never inspects the raw user text — no keywords,
 * no regex. Identical signals always produce the identical ranking.
 *
 * The failover loop downstream is untouched; only the ordering changes.
 */

import type { ExecutionPlan } from "./ExecutionPlan";
import type { ConversationRegister, RelationshipStage } from "./RegisterState";
import type { ConversationLanguage } from "./LanguageState";
import type { ModelId } from "./ModelProfile";

export type ConversationProfileId =
  | "playful-friends"
  | "comfort-support"
  | "technical"
  | "teaching-research"
  | "general-chat";

export interface ConversationProfile {
  readonly id: ConversationProfileId;
  readonly label: string;
  /** The conversation families this profile serves (documentation only). */
  readonly conversationTypes: ReadonlyArray<string>;
  /** Ordered model preference — index 0 is the primary candidate. */
  readonly preference: ReadonlyArray<ModelId>;
  /** Models that must never be the primary for this profile. */
  readonly neverPrimary: ReadonlyArray<ModelId>;
}

const PREF: ReadonlyArray<ModelId> = ["llama", "deepseek", "qwen", "gemini", "gemma"];
const PREF_COMFORT: ReadonlyArray<ModelId> = ["llama", "deepseek", "gemini", "qwen", "gemma"];
const PREF_TECH: ReadonlyArray<ModelId> = ["qwen", "deepseek", "llama", "gemini", "gemma"];
const PREF_TEACH: ReadonlyArray<ModelId> = ["deepseek", "gemini", "qwen", "llama", "gemma"];

export const CONVERSATION_PROFILES: Readonly<Record<ConversationProfileId, ConversationProfile>> =
  Object.freeze({
    "playful-friends": Object.freeze({
      id: "playful-friends",
      label: "Playful Friends",
      conversationTypes: [
        "roasting",
        "sarcasm",
        "playfulness",
        "close friends",
        "dark humor",
        "adult humor",
      ],
      preference: PREF,
      // Gemini's safety policy refuses playful/sarcastic content.
      neverPrimary: Object.freeze<ReadonlyArray<ModelId>>(["gemini"]),
    }),
    "comfort-support": Object.freeze({
      id: "comfort-support",
      label: "Comfort & Support",
      conversationTypes: [
        "comfort",
        "grief",
        "support",
        "anxiety",
        "relationship",
        "late-night talk",
      ],
      preference: PREF_COMFORT,
      neverPrimary: Object.freeze([]),
    }),
    technical: Object.freeze({
      id: "technical",
      label: "Technical",
      conversationTypes: ["programming", "debugging", "architecture", "algorithms", "engineering"],
      preference: PREF_TECH,
      neverPrimary: Object.freeze([]),
    }),
    "teaching-research": Object.freeze({
      id: "teaching-research",
      label: "Teaching & Research",
      conversationTypes: ["teaching", "learning", "research", "explaining", "academics"],
      preference: PREF_TEACH,
      neverPrimary: Object.freeze([]),
    }),
    "general-chat": Object.freeze({
      id: "general-chat",
      label: "General Chat",
      conversationTypes: [
        "general chatting",
        "mixed language",
        "hinglish",
        "daily conversation",
        "office",
        "family",
        "planning",
      ],
      preference: PREF,
      neverPrimary: Object.freeze([]),
    }),
  });

/** The typed signal surface the router is allowed to read. */
export interface RoutingSignals {
  readonly strategy: Readonly<ExecutionPlan["strategy"]["primary"]>;
  readonly register: ConversationRegister;
  readonly relationship: RelationshipStage;
  readonly language: ConversationLanguage;
  readonly tone: Readonly<ExecutionPlan["tone"]>;
  readonly understanding: Readonly<ExecutionPlan["understanding"]>;
  readonly social: Readonly<ExecutionPlan["socialUnderstanding"]>;
  readonly informationBudget: Readonly<ExecutionPlan["informationBudget"]>;
}

export interface ModelRoutingDecision {
  readonly profile: ConversationProfileId;
  readonly profileLabel: string;
  /** The model that should be tried first this turn. */
  readonly selected: ModelId;
  /** Full ordered preference (deterministic). */
  readonly ranking: ReadonlyArray<ModelId>;
  /** Why — built from the matched Executive signals. */
  readonly reason: string;
  /** Deterministic profile scores (documentation + tests). */
  readonly scores: Readonly<Record<ConversationProfileId, number>>;
}

// Fixed evaluation order — first strict max wins on ties.
const EVALUATION_ORDER: readonly ConversationProfileId[] = [
  "playful-friends",
  "comfort-support",
  "technical",
  "teaching-research",
  "general-chat",
];

/** Convert a full plan into routing signals — the single conversion point. */
export function signalsFromPlan(plan: Readonly<ExecutionPlan>): RoutingSignals {
  return {
    strategy: plan.strategy.primary,
    register: plan.register.register,
    relationship: plan.relationship,
    language: plan.language.dominant,
    tone: plan.tone,
    understanding: plan.understanding,
    social: plan.socialUnderstanding,
    informationBudget: plan.informationBudget,
  };
}

const SOCIAL_HUMOR = "humor-as-relief";
const SOCIAL_STORYTELLING = "storytelling-mode";
const SOCIAL_GRIEF = "grief-life-stage";
const SOCIAL_ATTACHMENT = "attachment-loss";
const SOCIAL_CAREER = "career-pressure";
const SOCIAL_FINANCIAL = "financial-pressure";

const EMPATHY_IMPLICITS = new Set(["needs-empathy", "seeking-reassurance", "not-fine"]);

const MIXED_LANGUAGES: ReadonlySet<ConversationLanguage> = new Set([
  "HINGLISH",
  "HINDI_WITH_ENGLISH",
  "ENGLISH_WITH_HINDI",
]);

function socialNames(social: RoutingSignals["social"]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const bucket of [
    social.humanNeeds,
    social.socialPressures,
    social.relationshipDynamics,
    social.lifeContext,
    social.communicationNorms,
    social.motivation,
    social.constraints,
    social.risks,
    social.growthOpportunities,
  ]) {
    for (const influence of bucket) names.add(influence.name);
  }
  return names;
}

/**
 * Deterministic profile scoring. Every term is an Executive output —
 * nothing here parses text. Scores are kept as simple additive terms so
 * the reason string can enumerate exactly what matched.
 */
export function scoreProfiles(s: RoutingSignals): Record<ConversationProfileId, number> {
  const social = socialNames(s.social);
  const scores: Record<ConversationProfileId, number> = {
    "playful-friends": 0,
    "comfort-support": 0,
    technical: 0,
    "teaching-research": 0,
    "general-chat": 0.3,
  };

  // ── Playful Friends (A): roasting, sarcasm, playfulness, dark humor ──
  let playful = 0;
  if (s.register === "PLAYFUL") playful += 0.6;
  else if (s.register === "CASUAL") playful += 0.25;
  if (s.tone.humor >= 0.6) playful += 0.35;
  else if (s.tone.humor >= 0.4) playful += 0.15;
  if (social.has(SOCIAL_HUMOR)) playful += 0.3;
  if (social.has(SOCIAL_STORYTELLING)) playful += 0.2;
  if (
    s.strategy === "Reflect" &&
    s.tone.humor >= 0.4 &&
    (s.relationship === "COMFORTABLE" || s.relationship === "INTIMATE")
  ) {
    playful += 0.2;
  }
  scores["playful-friends"] = playful;

  // ── Comfort & Support (B): grief, anxiety, relationship, late-night ──
  let comfort = 0;
  if (s.strategy === "Comfort") comfort += 0.65;
  else if (s.strategy === "Encourage") comfort += 0.3;
  else if (s.strategy === "Listen") comfort += 0.2;
  if (s.register === "SUPPORTIVE") comfort += 0.35;
  if (s.understanding.implicit && EMPATHY_IMPLICITS.has(s.understanding.implicit.label))
    comfort += 0.3;
  if (social.has(SOCIAL_GRIEF) || social.has(SOCIAL_ATTACHMENT)) comfort += 0.3;
  if (s.understanding.context.vulnerability > 0.5) comfort += 0.2;
  if (s.understanding.context.tension > 0.6) comfort += 0.15;
  if (s.relationship === "COMFORTABLE" || s.relationship === "INTIMATE") comfort += 0.1;
  scores["comfort-support"] = comfort;

  // ── Technical (C): programming, debugging, architecture, engineering ──
  let technical = 0;
  if (s.register === "ACADEMIC") technical += 0.55;
  else if (s.register === "PROFESSIONAL") technical += 0.35;
  if (s.understanding.expected === "information") technical += 0.25;
  if (s.understanding.move === "Ask" && s.understanding.speakerGoal === "seek-information")
    technical += 0.2;
  if (s.tone.formality >= 0.65) technical += 0.15;
  if (s.strategy === "Answer") technical += 0.1;
  scores.technical = technical;

  // ── Teaching & Research (D): explaining, academics, education ──
  let teaching = 0;
  if (s.understanding.speakerGoal === "teach") teaching += 0.6;
  if (s.register === "ACADEMIC") teaching += 0.3;
  if (s.understanding.expected === "information") teaching += 0.2;
  if (s.understanding.move === "Answer") teaching += 0.1;
  if (s.tone.formality >= 0.4) teaching += 0.1;
  scores["teaching-research"] = teaching;

  // ── General Chat (E): default — mixed language, daily, office, family ──
  let general = 0.3;
  if (s.register === "NEUTRAL") general += 0.25;
  else if (s.register === "CASUAL") general += 0.1;
  else if (s.register === "PROFESSIONAL") general += 0.15;
  if (MIXED_LANGUAGES.has(s.language)) general += 0.25;
  if (s.understanding.state === "opening" || s.understanding.move === "Continue") general += 0.1;
  if (s.understanding.expected === "listening") general += 0.1;
  scores["general-chat"] = general;

  return scores;
}

/**
 * The one routing decision per turn. Pure, deterministic, no I/O.
 * First strict maximum in EVALUATION_ORDER wins ties.
 */
export function routeConversationModel(s: RoutingSignals): ModelRoutingDecision {
  const scores = scoreProfiles(s);
  let best: ConversationProfileId = EVALUATION_ORDER[0];
  for (let i = 1; i < EVALUATION_ORDER.length; i++) {
    if (scores[EVALUATION_ORDER[i]] > scores[best]) best = EVALUATION_ORDER[i];
  }
  const profile = CONVERSATION_PROFILES[best];
  const ranking = profile.preference;
  const selected = ranking[0];
  const reason = buildReason(best, s);
  return {
    profile: best,
    profileLabel: profile.label,
    selected,
    ranking,
    reason,
    scores,
  };
}

/** Deterministic reason string from the matched signals. */
function buildReason(profile: ConversationProfileId, s: RoutingSignals): string {
  const parts: string[] = [`strategy=${s.strategy}`, `register=${s.register}`];
  if (s.relationship !== "NEW") parts.push(`relationship=${s.relationship}`);
  if (s.language !== "UNKNOWN") parts.push(`language=${s.language}`);
  parts.push(`humor=${s.tone.humor.toFixed(2)}`, `formality=${s.tone.formality.toFixed(2)}`);
  parts.push(`move=${s.understanding.move}`, `expected=${s.understanding.expected}`);
  if (s.understanding.implicit) parts.push(`implicit=${s.understanding.implicit.label}`);
  if (s.informationBudget !== "Normal") parts.push(`budget=${s.informationBudget}`);
  const social = socialNames(s.social);
  if (social.size > 0) parts.push(`social=[${[...social].slice(0, 4).join(",")}]`);
  return `${CONVERSATION_PROFILES[profile].label}: ${parts.join(", ")}`;
}
