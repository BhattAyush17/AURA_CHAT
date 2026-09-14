/**
 * AURA Phase 3 — Mode B: Local Browser Memory Store
 *
 * localStorage-backed memory with emotional tag matching,
 * keyword overlap scoring, and recency-sorted retrieval.
 *
 * Storage key: "aura_memories_{user_id}"
 * Cap: 50 entries, FIFO eviction on overflow
 * Scope: single browser, single device
 *
 * Returns the exact same shape as Supabase mode so L3+
 * layers never know which storage backend is active.
 */

import { auraTelemetry } from "@/telemetry/RuntimeTelemetry";

// ─── Memory Tiers ─────────────────────────────────────────────────

export type MemoryTier = "ephemeral" | "short_term" | "durable";

export interface LocalMemoryEntry {
  content: string;
  emotional_tags: Record<string, number>;
  timestamp: number; // epoch ms
  keywords: string[];
  tier: MemoryTier;
}

export interface MemoryResult {
  content: string;
  metadata: Record<string, any>;
  similarity: number;
  emotional_match: number;
}

// ─── Constants ───────────────────────────────────────────────────

const MAX_ENTRIES = 50;
const MAX_RESULTS = 5;
const SIMILARITY_FLOOR = 0.6;
const DEDUPE_WINDOW_MS = 5000; // 5s window to prevent duplicate stores

// Tier-specific caps
const TIER_CAPS: Record<MemoryTier, number> = {
  ephemeral: 5, // Very short-lived, current interaction only
  short_term: 20, // Active session/recent thread
  durable: 30, // Stable meaningful information
};

// Tier decay: ephemeral expires after 5 minutes, short_term after 2 hours
const TIER_TTL_MS: Record<MemoryTier, number> = {
  ephemeral: 5 * 60 * 1000, // 5 minutes
  short_term: 2 * 60 * 60 * 1000, // 2 hours
  durable: Infinity, // Never expires automatically
};

// Stopwords for keyword extraction (English + Hindi/Hinglish)
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "out",
  "off",
  "over",
  "under",
  "again",
  "then",
  "once",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "all",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "because",
  "but",
  "and",
  "or",
  "if",
  "while",
  "about",
  "up",
  "what",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
  "am",
  "it",
  "its",
  "my",
  "me",
  "we",
  "our",
  "you",
  "your",
  "he",
  "him",
  "she",
  "her",
  "they",
  "them",
  "i",
  // Hindi / Hinglish
  "mujhe",
  "hai",
  "hain",
  "ka",
  "ki",
  "ke",
  "ko",
  "se",
  "ne",
  "par",
  "ye",
  "wo",
  "kya",
  "aur",
  "ya",
  "nahi",
  "ho",
  "tha",
  "thi",
  "bhi",
  "mein",
  "hum",
  "tum",
  "aap",
  "yeh",
  "woh",
  "kab",
  "kaise",
]);

// ─── Storage Helpers ─────────────────────────────────────────────

function storageKey(userId: string, tier?: MemoryTier): string {
  if (tier) return `aura_memories_${tier}_${userId}`;
  return `aura_memories_${userId}`;
}

function loadEntries(userId: string, tier?: MemoryTier): LocalMemoryEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(userId, tier));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEntries(userId: string, entries: LocalMemoryEntry[], tier?: MemoryTier): void {
  try {
    localStorage.setItem(storageKey(userId, tier), JSON.stringify(entries));
  } catch (e) {
    console.warn("[LocalMemory] Failed to save:", e);
  }
}

function loadAllEntries(userId: string): LocalMemoryEntry[] {
  return [
    ...loadEntries(userId, "ephemeral"),
    ...loadEntries(userId, "short_term"),
    ...loadEntries(userId, "durable"),
  ];
}

function isExpired(entry: LocalMemoryEntry): boolean {
  const ttl = TIER_TTL_MS[entry.tier];
  if (ttl === Infinity) return false;
  return Date.now() - entry.timestamp > ttl;
}

function evictExpired(entries: LocalMemoryEntry[]): LocalMemoryEntry[] {
  return entries.filter((e) => !isExpired(e));
}

// ─── Keyword Extraction ──────────────────────────────────────────

export function extractKeywords(text: string, maxKeywords: number = 6): string[] {
  const words = text.toLowerCase().match(/\w+/g) || [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const w of words) {
    if (w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w) && !seen.has(w)) {
      seen.add(w);
      result.push(w);
      if (result.length >= maxKeywords) break;
    }
  }
  return result;
}

// ─── Scoring Functions ───────────────────────────────────────────

/**
 * Score emotional tag overlap between current state and a memory entry.
 * Uses cosine-like overlap: sum of min(a,b) / max(sum(a), 1)
 */
function scoreEmotionalMatch(
  currentState: Record<string, number>,
  entryTags: Record<string, number>,
): number {
  const currentKeys = Object.keys(currentState);
  if (currentKeys.length === 0) return 0;

  let overlap = 0;
  let totalCurrent = 0;

  for (const key of currentKeys) {
    const cv = currentState[key] || 0;
    const ev = entryTags[key] || 0;
    overlap += Math.min(cv, ev);
    totalCurrent += cv;
  }

  return totalCurrent > 0 ? overlap / totalCurrent : 0;
}

/**
 * Score keyword overlap between query keywords and memory entry keywords.
 */
function scoreKeywordOverlap(queryKeywords: string[], entryKeywords: string[]): number {
  if (queryKeywords.length === 0 || entryKeywords.length === 0) return 0;

  const entrySet = new Set(entryKeywords);
  let hits = 0;
  for (const kw of queryKeywords) {
    if (entrySet.has(kw)) hits++;
  }

  return hits / queryKeywords.length;
}

/**
 * Score keyword overlap on the raw content string (broader matching).
 */
function scoreContentKeywordOverlap(queryKeywords: string[], content: string): number {
  if (queryKeywords.length === 0 || !content) return 0;

  const contentLower = content.toLowerCase();
  let hits = 0;
  for (const kw of queryKeywords) {
    if (contentLower.includes(kw)) hits++;
  }

  return hits / queryKeywords.length;
}

/**
 * Recency score: exponential decay over 7 days
 */
function scoreRecency(timestampMs: number): number {
  const ageMs = Date.now() - timestampMs;
  const ageHours = ageMs / (1000 * 60 * 60);
  const ageDays = ageHours / 24;
  // Exponential decay: half-life of 3 days
  return Math.max(0, Math.exp(-0.231 * ageDays));
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Store a memory entry in localStorage with tier awareness.
 * Evicts oldest entries per tier when at capacity.
 * Deduplicates within a 5-second window to prevent double-stores.
 *
 * @param content - The memory content to store
 * @param userId - User identifier
 * @param emotionalTags - Emotional tags for this memory
 * @param tier - Memory tier (ephemeral/short_term/durable). Auto-detected if not specified.
 * @returns true on success
 */
export function storeLocalMemory(
  content: string,
  userId: string,
  emotionalTags: Record<string, number>,
  tier?: MemoryTier,
): boolean {
  try {
    if (!content || content.trim().length < 3) return false;

    const detectedTier = tier ?? inferMemoryTier(content, emotionalTags);
    const entries = loadEntries(userId, detectedTier);

    // Deduplicate: skip if the same content was stored within DEDUPE_WINDOW_MS
    const now = Date.now();
    const isDupe = entries.some(
      (e) => e.content === content.slice(0, 500) && now - e.timestamp < DEDUPE_WINDOW_MS,
    );
    if (isDupe) return true;

    const keywords = extractKeywords(content);
    const entry: LocalMemoryEntry = {
      content: content.slice(0, 500),
      emotional_tags: emotionalTags,
      timestamp: now,
      keywords,
      tier: detectedTier,
    };

    entries.push(entry);

    // Evict oldest entries to stay at cap (respect tier)
    while (entries.length > TIER_CAPS[detectedTier]) {
      entries.shift();
    }

    saveEntries(userId, entries, detectedTier);
    enforceGlobalQuota(userId);
    return true;
  } catch (e) {
    console.warn("[LocalMemory] store failed:", e);
    return false;
  }
}

function enforceGlobalQuota(userId: string) {
  try {
    let totalBytes = 0;
    const tiers: MemoryTier[] = ["ephemeral", "short_term", "durable"];
    const rawData: Record<string, string | null> = {
      ephemeral: null,
      short_term: null,
      durable: null,
    };

    // Estimate total size
    for (const t of tiers) {
      const raw = localStorage.getItem(storageKey(userId, t));
      rawData[t] = raw;
      if (raw) totalBytes += raw.length * 2; // UTF-16
    }

    const MAX_QUOTA = 4 * 1024 * 1024; // 4MB (80% of 5MB quota)

    if (totalBytes > MAX_QUOTA) {
      // Evict from lowest tier to highest
      for (const t of tiers) {
        const raw = rawData[t];
        if (!raw) continue;

        const entries = JSON.parse(raw) as LocalMemoryEntry[];
        let tierEvicted = false;

        while (entries.length > 0 && totalBytes > MAX_QUOTA) {
          const evicted = entries.shift();
          if (evicted) {
            const evictedBytes = JSON.stringify(evicted).length * 2;
            totalBytes -= evictedBytes;
            tierEvicted = true;
            auraTelemetry.trackMemoryEvicted(evictedBytes);
          }
        }

        if (tierEvicted) {
          saveEntries(userId, entries, t);
        }

        if (totalBytes <= MAX_QUOTA) break;
      }
    }
  } catch (e) {
    console.warn("[LocalMemory] enforceGlobalQuota failed:", e);
  }
}

/**
 * Infer the appropriate memory tier based on content and emotional context.
 * This enables automatic tier assignment without explicit specification.
 */
function inferMemoryTier(content: string, emotionalTags: Record<string, number>): MemoryTier {
  const lower = content.toLowerCase();

  // Explicit preferences or important context → durable
  if (
    lower.includes("remember") ||
    lower.includes("always") ||
    lower.includes("never") ||
    lower.includes("important") ||
    lower.includes("preference") ||
    lower.includes("remind me") ||
    Object.keys(emotionalTags).some((k) => k.includes("important") || k.includes("preference"))
  ) {
    return "durable";
  }

  // Music associations with personal meaning → durable
  if (
    lower.includes("reminds me") ||
    lower.includes("nostalgic") ||
    lower.includes("special") ||
    lower.includes("memory") ||
    lower.includes("meaning")
  ) {
    return "durable";
  }

  // Generic reactions → ephemeral
  if (
    lower.includes("nice") ||
    lower.includes("cool") ||
    lower.includes("okay") ||
    lower.includes("ok") ||
    lower.includes("sure") ||
    lower === "yeah" ||
    lower === "yes" ||
    lower === "no"
  ) {
    return "ephemeral";
  }

  // Default to short_term
  return "short_term";
}

/**
 * Retrieve memories from localStorage matching the query and emotional state.
 * Respects tier hierarchy: durable > short_term > ephemeral.
 * Automatically cleans expired entries.
 *
 * Retrieval cascade:
 *   1. Emotional tag overlap with current L1 state
 *   2. Keyword overlap on content string
 *   3. Sort by recency (within tier preference)
 *   4. Return top 5 as list[dict] with similarity=0.60
 *
 * @param query - Search query
 * @param userId - User identifier
 * @param emotionalState - Current emotional state for matching
 * @param options - Optional retrieval options
 * @returns Array of MemoryResult matching the L3 interface contract
 */
export function retrieveLocalMemories(
  query: string,
  userId: string,
  emotionalState: Record<string, number>,
  options?: {
    tier?: MemoryTier;
    includeExpired?: boolean;
  },
): MemoryResult[] {
  let entries = loadAllEntries(userId);

  // Filter by tier if specified
  if (options?.tier) {
    entries = entries.filter((e) => e.tier === options.tier);
  }

  // Remove expired entries unless explicitly included
  if (!options?.includeExpired) {
    entries = evictExpired(entries);
  }

  if (entries.length === 0) return [];

  const queryKeywords = extractKeywords(query, 8);

  // Score every entry with tier bonus
  const scored = entries.map((entry) => {
    const emotionalMatch = scoreEmotionalMatch(emotionalState, entry.emotional_tags);
    const keywordMatch = scoreKeywordOverlap(queryKeywords, entry.keywords);
    const contentMatch = scoreContentKeywordOverlap(queryKeywords, entry.content);
    const recency = scoreRecency(entry.timestamp);

    // Tier bonus: durable memories get priority boost
    const tierBonus = entry.tier === "durable" ? 0.15 : entry.tier === "short_term" ? 0.05 : 0;

    // Weighted composite: emotion 0.30, keywords 0.25, content 0.15, recency 0.30, tier 0.15
    const composite =
      emotionalMatch * 0.3 + keywordMatch * 0.25 + contentMatch * 0.15 + recency * 0.3 + tierBonus;

    return {
      entry,
      composite,
      emotionalMatch,
    };
  });

  // Sort by composite score descending
  scored.sort((a, b) => b.composite - a.composite);

  // Take top MAX_RESULTS
  const topResults = scored.slice(0, MAX_RESULTS);

  // Format to L3 contract
  return topResults.map((s) => ({
    content: s.entry.content,
    metadata: {
      emotional_tags: s.entry.emotional_tags,
      timestamp: s.entry.timestamp,
      keywords: s.entry.keywords,
      source: "local_browser",
      tier: s.entry.tier,
    },
    similarity: SIMILARITY_FLOOR,
    emotional_match: Math.round(s.emotionalMatch * 100) / 100,
  }));
}

/**
 * Get current local memory count for a user, optionally by tier.
 */
export function getLocalMemoryCount(userId: string, tier?: MemoryTier): number {
  if (tier) {
    return loadEntries(userId, tier).filter((e) => !isExpired(e)).length;
  }
  return loadAllEntries(userId).filter((e) => !isExpired(e)).length;
}

/**
 * Get memory counts broken down by tier.
 */
export function getMemoryCountsByTier(userId: string): Record<MemoryTier, number> {
  return {
    ephemeral: getLocalMemoryCount(userId, "ephemeral"),
    short_term: getLocalMemoryCount(userId, "short_term"),
    durable: getLocalMemoryCount(userId, "durable"),
  };
}

/**
 * Clear all local memories for a user, optionally by tier.
 */
export function clearLocalMemories(userId: string, tier?: MemoryTier): void {
  try {
    if (tier) {
      localStorage.removeItem(storageKey(userId, tier));
    } else {
      localStorage.removeItem(storageKey(userId, "ephemeral"));
      localStorage.removeItem(storageKey(userId, "short_term"));
      localStorage.removeItem(storageKey(userId, "durable"));
    }
  } catch {
    // no-op
  }
}
