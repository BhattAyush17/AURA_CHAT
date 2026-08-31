/**
 * ContextualRelevanceEngine — lightweight, deterministic, pure.
 *
 * Evaluates what is socially/contextually meaningful right now.
 * NEVER feeds initiativeScore or any autonomous-speech gating.
 *
 * The engine is a pure function of its input — trivially testable.
 */

import type {
  SocialContext,
  SocialPresenceInput,
  RelevanceItem,
  SignalCategory,
  RelevanceScore,
} from "./types";
import { RELEVANCE_THRESHOLDS, SIGNAL_TO_CONTENT_AREA } from "./types";

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

const MUSIC_KEYWORDS =
  /\b(song|music|track|play|sing|listen|hear|beat|melody|tune|album|artist|band|guitar|piano|drum|lyric|concert|spotify|youtube|shazam|soundtrack)\b/i;

const ENVIRONMENT_KEYWORDS =
  /\b(room|outside|weather|light|dark|noise|quiet|sound|hear|smell|feel|temperature|cold|hot|warm|breeze|wind|rain|sun|moon|star|cloud|air|atmosphere|vibe|ambience|environment|around)\b/i;

/**
 * Evaluate what matters in the current conversational moment.
 * Returns ranked relevance items, highest first, with active influence areas.
 */
export function evaluateSocialContext(input: SocialPresenceInput): SocialContext {
  const items: RelevanceItem[] = [];

  // 1. USER EMOTION
  evaluateUserEmotion(input, items);

  // 2. TOPIC CONTINUITY
  evaluateTopicContinuity(input, items);

  // 3. MUSIC RELEVANCE
  evaluateMusicRelevance(input, items);

  // 4. ATMOSPHERE RELEVANCE
  evaluateAtmosphereRelevance(input, items);

  // 5. MEMORY RELEVANCE
  evaluateMemoryRelevance(input, items);

  // 6. RELATIONSHIP SHIFT
  evaluateRelationshipShift(input, items);

  // 7. SILENCE CONTEXT
  evaluateSilenceContext(input, items);

  // 8. INTERRUPTION CONTEXT
  evaluateInterruptionContext(input, items);

  // Sort by relevance descending
  items.sort((a, b) => b.relevance - a.relevance);

  // Keep only items above WEAK threshold (or top 5, whichever is fewer)
  const filtered = items.filter((item) => item.relevance >= RELEVANCE_THRESHOLDS.WEAK).slice(0, 5);

  const dominantCategory = filtered.length > 0 ? filtered[0].category : null;

  const activeInfluenceAreas = [...new Set(filtered.flatMap((item) => item.canInfluence))];

  return {
    items: filtered,
    dominantCategory,
    activeInfluenceAreas,
    timestamp: Date.now(),
  };
}

function evaluateUserEmotion(input: SocialPresenceInput, items: RelevanceItem[]): void {
  // High frustration or vulnerability is almost always relevant
  if (input.emotion.frustration >= RELEVANCE_THRESHOLDS.MEANINGFUL) {
    items.push({
      category: "USER_FRUSTRATION",
      relevance: clamp01(input.emotion.frustration + 0.15),
      reason: frustrationReason(input.emotion.frustration),
      canInfluence: [...SIGNAL_TO_CONTENT_AREA.USER_FRUSTRATION],
    });
  }

  if (input.emotion.vulnerability >= RELEVANCE_THRESHOLDS.MEANINGFUL) {
    items.push({
      category: "USER_VULNERABILITY",
      relevance: clamp01(input.emotion.vulnerability + 0.15),
      reason: vulnerabilityReason(input.emotion.vulnerability),
      canInfluence: [...SIGNAL_TO_CONTENT_AREA.USER_VULNERABILITY],
    });
  }

  // Broad emotional energy (not frustration/vulnerability-specific)
  const emotionalIntensity = clamp01(
    (input.emotion.energy + input.emotion.warmth + input.emotion.engagement) / 3,
  );
  if (emotionalIntensity >= RELEVANCE_THRESHOLDS.MEANINGFUL) {
    items.push({
      category: "USER_EMOTION",
      relevance: emotionalIntensity,
      reason: emotionReason(input.emotion),
      canInfluence: [...SIGNAL_TO_CONTENT_AREA.USER_EMOTION],
    });
  }
}

function evaluateTopicContinuity(input: SocialPresenceInput, items: RelevanceItem[]): void {
  if (input.socialMomentum.unfinished_thought) {
    items.push({
      category: "TOPIC_CONTINUITY",
      relevance: 0.65,
      reason: "user's thought appears unfinished — continue naturally rather than pivot",
      canInfluence: [...SIGNAL_TO_CONTENT_AREA.TOPIC_CONTINUITY],
    });
  }
  if (input.socialMomentum.topic_depth >= 3) {
    items.push({
      category: "TOPIC_CONTINUITY",
      relevance: 0.6,
      reason: "topic has significant depth — stay present rather than redirect",
      canInfluence: [...SIGNAL_TO_CONTENT_AREA.TOPIC_CONTINUITY],
    });
  }
}

function evaluateMusicRelevance(input: SocialPresenceInput, items: RelevanceItem[]): void {
  if (!input.music.hasActiveTrack) return;

  let relevance: RelevanceScore = 0;
  let reason = "";

  // User explicitly mentions music → highly relevant
  if (input.userMentionsMusic) {
    relevance = 0.8;
    reason = "user is discussing music — current track may be naturally referenced";
  }
  // Emotionally intense moment + music
  else if (input.emotion.warmth > 0.6 && input.emotion.engagement > 0.5 && input.music.isPlaying) {
    relevance = 0.5;
    reason = "music matches the current emotional tone — may be acknowledged if it feels natural";
  }
  // Music is playing but unrelated to conversation → low relevance
  else if (input.music.isPlaying) {
    relevance = 0.2;
    reason = "music is present but unrelated to current conversation";
  }

  if (relevance >= RELEVANCE_THRESHOLDS.WEAK) {
    items.push({
      category: "MUSIC_RELEVANCE",
      relevance,
      reason,
      canInfluence: [...SIGNAL_TO_CONTENT_AREA.MUSIC_RELEVANCE],
    });
  }
}

function evaluateAtmosphereRelevance(input: SocialPresenceInput, items: RelevanceItem[]): void {
  if (!input.atmospherePresent) return;

  // User mentions environment → atmosphere may be relevant
  if (input.userMentionsEnvironment) {
    items.push({
      category: "ATMOSPHERE_RELEVANCE",
      relevance: 0.7,
      reason: "user acknowledges the environment — atmosphere may naturally enter the response",
      canInfluence: [...SIGNAL_TO_CONTENT_AREA.ATMOSPHERE_RELEVANCE],
    });
  }
}

function evaluateMemoryRelevance(input: SocialPresenceInput, items: RelevanceItem[]): void {
  if (!input.memory.hasPersonalHistory) return;
  if (input.memory.retrievedCount === 0) return;

  // Memory is only relevant if the match is strong
  if (input.memory.maxRelevanceScore >= RELEVANCE_THRESHOLDS.MEANINGFUL) {
    items.push({
      category: "MEMORY_RELEVANCE",
      relevance: clamp01(input.memory.maxRelevanceScore),
      reason: "a relevant memory from earlier conversation matches the current moment",
      canInfluence: [...SIGNAL_TO_CONTENT_AREA.MEMORY_RELEVANCE],
    });
  }
}

function evaluateRelationshipShift(input: SocialPresenceInput, items: RelevanceItem[]): void {
  // Detect if something changed in the interaction dynamic
  if (input.socialMomentum.argumentative && input.emotion.tension > 0.5) {
    items.push({
      category: "RELATIONSHIP_SHIFT",
      relevance: 0.55,
      reason: "conversation has an argumentative tone — stay grounded, avoid escalation",
      canInfluence: [...SIGNAL_TO_CONTENT_AREA.RELATIONSHIP_SHIFT],
    });
  }
}

function evaluateSilenceContext(input: SocialPresenceInput, items: RelevanceItem[]): void {
  if (input.timing.silenceDurationMs > 5000) {
    // Silence that persists is contextually meaningful — not an initiative trigger,
    // but it may inform tone (e.g., user may be gathering thoughts).
    let relevance: RelevanceScore;
    let reason: string;

    if (input.timing.silenceDurationMs > 15000) {
      relevance = 0.5;
      reason = "extended silence — user may be reflecting or uncertain";
    } else if (input.timing.silenceDurationMs > 8000) {
      relevance = 0.35;
      reason = "notable silence — pause may reflect thoughtfulness rather than an invitation";
    } else {
      relevance = 0.2;
      reason = "brief silence — natural pause in conversation";
    }

    if (relevance >= RELEVANCE_THRESHOLDS.WEAK) {
      items.push({
        category: "SILENCE_CONTEXT",
        relevance,
        reason,
        canInfluence: [...SIGNAL_TO_CONTENT_AREA.SILENCE_CONTEXT],
      });
    }
  }
}

function evaluateInterruptionContext(input: SocialPresenceInput, items: RelevanceItem[]): void {
  if (input.userInterrupted) {
    items.push({
      category: "INTERRUPTION_CONTEXT",
      relevance: 0.5,
      reason: "user spoke over AURA — respond naturally without referencing the interruption",
      canInfluence: [...SIGNAL_TO_CONTENT_AREA.INTERRUPTION_CONTEXT],
    });
  }
}

function frustrationReason(f: number): string {
  if (f > 0.8) return "user appears frustrated — respond with patience and acknowledgment";
  if (f > 0.6) return "user seems frustrated — avoid dismissiveness";
  return "user may be slightly frustrated — keep tone gentle";
}

function vulnerabilityReason(v: number): string {
  if (v > 0.8) return "user appears emotionally vulnerable — respond with care and presence";
  if (v > 0.6) return "user may be emotionally open — be present and avoid deflection";
  return "user seems emotionally exposed — respond gently";
}

function emotionReason(e: SocialPresenceInput["emotion"]): string {
  if (e.energy > 0.7 && e.warmth > 0.6)
    return "user is engaged and warm — match their energy naturally";
  if (e.energy > 0.7) return "user has high energy — reciprocate without forcing energy";
  if (e.warmth > 0.6) return "user feels warm — respond with matching warmth";
  if (e.energy < 0.3) return "user seems low-energy — keep pace measured and calm";
  return "user's emotional state is neutral";
}

export { MUSIC_KEYWORDS, ENVIRONMENT_KEYWORDS };
