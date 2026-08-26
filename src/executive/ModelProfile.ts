/**
 * ModelProfile — immutable capability registry for the models AURA can
 * route to. Phase 14.2: routing decisions rank these profiles; they are
 * never modified at runtime.
 *
 * Model IDs are logical (llama/qwen/deepseek/gemini/gemma). The concrete
 * OpenRouter identifiers live in MODEL_OPENROUTER_IDS — the only place
 * provider strings are pinned.
 */

export type ModelId = "llama" | "qwen" | "deepseek" | "gemini" | "gemma";

export interface ModelProfile {
  readonly id: ModelId;
  /** Display name. */
  readonly name: string;
  /** What the model is genuinely strong at (conversational terms). */
  readonly strengths: ReadonlyArray<string>;
  /** Known limitations — e.g. safety-gated refusals on playful content. */
  readonly weaknesses: ReadonlyArray<string>;
  /** The conversation families it fits best. */
  readonly conversationTypes: ReadonlyArray<string>;
  /** 0–1: how aggressively the model's safety policy gates content. */
  readonly safetyLevel: number;
  /** 0–1: stylistic/verbal creativity (banter, storytelling). */
  readonly creativity: number;
  /** 0–1: analytical depth. */
  readonly reasoning: number;
  readonly latency: "low" | "medium" | "high";
}

export const MODEL_PROFILES: Readonly<Record<ModelId, ModelProfile>> = Object.freeze({
  llama: Object.freeze({
    id: "llama",
    name: "Meta Llama 3.3 70B",
    strengths: [
      "emotional conversations",
      "friendship",
      "playful banter",
      "sarcasm",
      "roasting",
      "long conversations",
      "storytelling",
      "companionship",
    ],
    weaknesses: [],
    conversationTypes: ["playful", "comfort", "general chat"],
    safetyLevel: 0.3,
    creativity: 0.85,
    reasoning: 0.6,
    latency: "medium",
  }),
  qwen: Object.freeze({
    id: "qwen",
    name: "Qwen 2.5 72B",
    strengths: [
      "programming",
      "architecture",
      "debugging",
      "deep reasoning",
      "planning",
      "technical discussions",
    ],
    weaknesses: ["less conversational warmth"],
    conversationTypes: ["technical"],
    safetyLevel: 0.4,
    creativity: 0.5,
    reasoning: 0.9,
    latency: "medium",
  }),
  deepseek: Object.freeze({
    id: "deepseek",
    name: "DeepSeek V3",
    strengths: [
      "analytical reasoning",
      "balanced emotional conversations",
      "philosophy",
      "long-form discussion",
      "education",
    ],
    weaknesses: [],
    conversationTypes: ["teaching", "research", "balanced chat"],
    safetyLevel: 0.35,
    creativity: 0.7,
    reasoning: 0.9,
    latency: "low",
  }),
  gemini: Object.freeze({
    id: "gemini",
    name: "Gemini 2.0 Flash",
    strengths: [
      "factual QA",
      "summarization",
      "documentation",
      "structured extraction",
      "educational explanations",
    ],
    weaknesses: [
      "conservative safety",
      "playful conversations",
      "sarcasm",
      "profanity",
      "dark humor",
    ],
    conversationTypes: ["teaching", "reference"],
    safetyLevel: 0.75,
    creativity: 0.35,
    reasoning: 0.75,
    latency: "low",
  }),
  gemma: Object.freeze({
    id: "gemma",
    name: "Gemma 3 27B",
    strengths: ["emergency fallback"],
    weaknesses: ["last-resort capability"],
    conversationTypes: [],
    safetyLevel: 0.5,
    creativity: 0.5,
    reasoning: 0.5,
    latency: "medium",
  }),
});

/** The only place concrete OpenRouter model strings are pinned. */
export const MODEL_OPENROUTER_IDS: Readonly<Record<ModelId, string>> = Object.freeze({
  llama: "meta-llama/llama-3.3-70b-instruct:free",
  qwen: "qwen/qwen-2.5-72b-instruct",
  deepseek: "deepseek/deepseek-chat",
  gemini: "google/gemini-2.0-flash-lite-001",
  gemma: "google/gemma-3-27b-it",
});

/** Order every preference list must respect — Gemma is always last. */
export const EMERGENCY_FALLBACK: ModelId = "gemma";

/** Turn a ranked preference into the provider queue used by the failover loop. */
export function buildModelQueue(ranking: ReadonlyArray<ModelId>): ReadonlyArray<string> {
  return ranking.map((id) => MODEL_OPENROUTER_IDS[id]);
}
