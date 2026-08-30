/**
 * MusicAssociationFilter — determines if a music-related utterance represents
 * a meaningful personal association worth storing as durable memory.
 *
 * Only stores compact associations like:
 *   "Counting Stars → nostalgic/school association"
 *
 * Does NOT store:
 *   - Generic reactions ("nice song", "cool", "play this")
 *   - Every positive reaction
 *   - Every playback event
 *   - Entire conversation transcripts
 *
 * Uses pattern matching and contextual signals, NOT LLM inference.
 */

export interface MusicAssociationCandidate {
  trackId: string;
  trackTitle: string;
  artist: string;
  association: string; // e.g., "nostalgic", "school memory", "special meaning"
  sentimentOrFeeling: string;
  confidence: number; // 0-1
  observedAt: number;
  source: "music_reaction" | "explicit_statement";
}

interface MusicReactionContext {
  currentTrack: { id: string; title: string; artist: string } | null;
  isPlaying: boolean;
  currentSection?: string;
  positionMs?: number;
}

// Patterns that indicate meaningful personal associations
const PERSONAL_ASSOCIATION_PATTERNS = [
  // Direct nostalgia/reminsicense
  /\breminds?\s*(me|us)?\s*(of|about)/i,
  /\bthoughts?\s*(of|about|on)\s*(me|us|my|the)/i,
  /\bmakes?\s*(me|us)\s*(think|feel|remember)/i,
  /\balways\s+(makes|reminds|gets)\s*/i,
  /\bever\s+(since|makes|brings)/i,
  /\bsince\s+(then|that|we|i)/i,

  // Emotional connections
  /\bspecial\s+(to|for|with|me)/i,
  /\bfavorite\s+(song|track|artist|album)/i,
  /\bthis\s+(song|track|tune)\s+is\s+(my|so|the)/i,
  /\bmy\s+(favorite|best|most-loved)\s+(song|track|artist)/i,
  /\bcloseto\s+(my|me|heart)/i,
  /\bhit\s+(me|us)\s*(right)?\s*in\s*(the)?\s*(feelings?|heart)/i,

  // Memory triggers
  /\bback\s+(when|in|to)\s+(we|i|school|college|home|those)/i,
  /\bdays?\s+(of|in|back|when)\s+(we|i|school|high school|college)/i,
  /\bused\s+to\s+(listen|hear|play|love)/i,
  /\btakes?\s*(me|us)\s*back/i,
  /\bpulls?\s*(me|us)\s*right\s*back/i,

  // Personal meaning
  /\bmeaningful?\s+(to|for|with|me)/i,
  /\bhas\s+(so\s+)?(much|a)\s+(meaning|value|significance)\s+(to|for|me)/i,
  /\bperfect\s+(for|to|with)\s+(me|us|this)/i,
  /\bexactly\s+(what|how|when|where)/i,

  // Relationship to life events
  /\bgraduation|prom|homecoming|wedding|funeral/i,
  /\bafter\s+(we|i|they|the)/i,
  /\bwhen\s+(we|i|they)\s+(were|was|got|had)/i,
  /\byears?\s+(ago|old|back|before)/i,
];

// Patterns that indicate generic/negligible reactions (should NOT store)
const GENERIC_REACTION_PATTERNS = [
  // Simple positive reactions
  /\bnice\s*(song|track|tune|music)?$/i,
  /\bcool\s*(song|track|tune|music)?$/i,
  /\bgood\s*(song|track|tune|music)?$/i,
  /\bokay\s*(song|track)?$/i,
  /\bok\s*(song|track)?$/i,
  /\bplay\s*(this|that|it)?$/i,
  /\bskip\s*(this|that)?$/i,
  /\bnext\s*(song|track)?$/i,
  /\bpause\s*(it|this)?$/i,
  /\bresume\s*(it|this)?$/i,

  // Neutral/minimal
  /^\s*(yeah|yes|no|yep|nope|sure|ok|okay)\s*$/i,
  /^\s*(nice|cool|good)\s*$/i,

  // Just music/song/track mentions without personal connection
  /\b(song|track|music|tune|artist)\s+(is|was|looks?)\s+(nice|cool|good|okay|alright)/i,
];

// Strong association indicators (high confidence)
const STRONG_ASSOCIATION_INDICATORS = [
  /\breminds\s+me\s+of/i,
  /\btakes?\s+me\s+back/i,
  /\bfavorite\s+(song|track|artist)/i,
  /\bspecial\s+to\s+(me|us|my heart)/i,
  /\balways\s+(makes|reminds|gets)\s+me/i,
  /\bpulls?\s+me\s+right\s+back/i,
];

// Moderate association indicators (medium confidence)
const MODERATE_ASSOCIATION_INDICATORS = [
  /\bwhen\s+(i|we)\s+(were|was|got|had)/i,
  /\bdays?\s+(of|in|back)\s+(we|i)/i,
  /\bmakes?\s+(me|us)\s+(think|feel)/i,
  /\bhas\s+(much|a)\s+(meaning|value)/i,
];

export function evaluateMusicAssociation(
  text: string,
  context: MusicReactionContext,
): MusicAssociationCandidate | null {
  // Must have a current track to associate
  if (!context.currentTrack) return null;

  const lower = text.toLowerCase();

  // Check if it's a generic reaction first (fast rejection)
  for (const pattern of GENERIC_REACTION_PATTERNS) {
    if (pattern.test(lower)) {
      return null;
    }
  }

  // Check for personal association patterns
  let hasPersonalAssociation = false;
  let confidence = 0;
  let associationType = "";

  for (const pattern of PERSONAL_ASSOCIATION_PATTERNS) {
    if (pattern.test(lower)) {
      hasPersonalAssociation = true;
      associationType = extractAssociationType(lower);
      break;
    }
  }

  if (!hasPersonalAssociation) {
    return null;
  }

  // Determine confidence based on indicator strength
  for (const pattern of STRONG_ASSOCIATION_INDICATORS) {
    if (pattern.test(lower)) {
      confidence = 0.85;
      break;
    }
  }

  if (confidence === 0) {
    for (const pattern of MODERATE_ASSOCIATION_INDICATORS) {
      if (pattern.test(lower)) {
        confidence = 0.65;
        break;
      }
    }
  }

  if (confidence === 0) {
    confidence = 0.5;
  }

  // Extract sentiment/feeling
  const sentimentOrFeeling = extractSentiment(lower);

  return {
    trackId: context.currentTrack.id,
    trackTitle: context.currentTrack.title,
    artist: context.currentTrack.artist,
    association: associationType,
    sentimentOrFeeling,
    confidence,
    observedAt: Date.now(),
    source: "music_reaction",
  };
}

function extractAssociationType(text: string): string {
  if (/\bnostalgic?\b/i.test(text)) return "nostalgic";
  if (/\b(memory|memories)\b/i.test(text)) return "memory_associated";
  if (/\b(school|college|high school|university)\b/i.test(text)) return "school_life";
  if (/\b(wedding|graduation|prom|ceremony)\b/i.test(text)) return "life_event";
  if (/\b(broke up|relationship|dating|boyfriend|girlfriend|ex)\b/i.test(text))
    return "relationship";
  if (/\b(friend|bestie|companion)\b/i.test(text)) return "friendship";
  if (/\b(family|parent|sibling|mother|father|brother|sister)\b/i.test(text)) return "family";
  if (/\b(travel|vacation|trip|holiday|journey)\b/i.test(text)) return "travel";
  if (/\b(concert|live|festival)\b/i.test(text)) return "live_music_memory";
  if (/\b(rain|rainy|snow|storm|weather)\b/i.test(text)) return "weather_association";
  if (/\bnight|late\s*night|midnight/i.test(text)) return "time_of_day";
  if (/\b(summer|winter|autumn|fall|spring|season)\b/i.test(text)) return "seasonal";
  if (/\b(home|house|room|kitchen|living)\b/i.test(text)) return "place";
  if (/\b(work|job|career|office)\b/i.test(text)) return "work_related";
  if (/\b(movie|film|show|series|scene)\b/i.test(text)) return "movie_tv_association";
  if (/\b(game|gaming|xbox|playstation|nintendo)\b/i.test(text)) return "gaming";
  if (/\b(book|read|reading|chapter)\b/i.test(text)) return "literary";
  if (/\bspecial\s+to\s+(me|us|my heart)/i.test(text)) return "special_personal";
  if (/\bfavorite\b/i.test(text)) return "favorite";
  if (/\balways\b/i.test(text)) return "recurring_association";
  if (/\bheart|emotion/i.test(text)) return "emotional";
  if (/\breminds?\s+(me|us)\s+of/i.test(text)) return "direct_reminder";
  return "personal_association";
}

function extractSentiment(text: string): string {
  if (/\b(happy|joy|glad|excited|love|loved)\b/i.test(text)) return "positive";
  if (/\b(sad|melancholy|longing|miss)\b/i.test(text)) return "bittersweet";
  if (/\b(peaceful|calm|relaxed|serene)\b/i.test(text)) return "peaceful";
  if (/\b(energetic|excited| pumped|thrilled)\b/i.test(text)) return "energetic";
  if (/\b(nostalgic|wistful|reminiscent)\b/i.test(text)) return "nostalgic";
  if (/\b(romantic|tender|intimate)\b/i.test(text)) return "romantic";
  if (/\b(emotional|moved|touched)\b/i.test(text)) return "emotional";
  return "mixed";
}

/**
 * Format a music association for memory storage.
 * Returns a compact string representation suitable for durable memory.
 */
export function formatMusicAssociationForMemory(candidate: MusicAssociationCandidate): string {
  return `${candidate.trackTitle} by ${candidate.artist} → ${candidate.association} (${candidate.sentimentOrFeeling})`;
}
