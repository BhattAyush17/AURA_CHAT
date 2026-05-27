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

// ─── Types ───────────────────────────────────────────────────────

export interface LocalMemoryEntry {
  content: string;
  emotional_tags: Record<string, number>;
  timestamp: number; // epoch ms
  keywords: string[];
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
const SIMILARITY_FLOOR = 0.60;
const DEDUPE_WINDOW_MS = 5000; // 5s window to prevent duplicate stores

// Stopwords for keyword extraction (English + Hindi/Hinglish)
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "to", "of", "in", "for", "on",
  "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "out", "off",
  "over", "under", "again", "then", "once", "here", "there", "when",
  "where", "why", "how", "all", "both", "each", "few", "more", "most",
  "other", "some", "such", "no", "nor", "not", "only", "own", "same",
  "so", "than", "too", "very", "just", "because", "but", "and", "or",
  "if", "while", "about", "up", "what", "which", "who", "whom",
  "this", "that", "these", "those", "am", "it", "its", "my", "me",
  "we", "our", "you", "your", "he", "him", "she", "her", "they",
  "them", "i",
  // Hindi / Hinglish
  "mujhe", "hai", "hain", "ka", "ki", "ke", "ko", "se", "ne", "par",
  "ye", "wo", "kya", "aur", "ya", "nahi", "ho", "tha", "thi", "bhi",
  "mein", "hum", "tum", "aap", "yeh", "woh", "kab", "kaise",
]);

// ─── Storage Helpers ─────────────────────────────────────────────

function storageKey(userId: string): string {
  return `aura_memories_${userId}`;
}

function loadEntries(userId: string): LocalMemoryEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEntries(userId: string, entries: LocalMemoryEntry[]): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(entries));
  } catch (e) {
    console.warn("[LocalMemory] Failed to save:", e);
  }
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
 * Store a memory entry in localStorage.
 * Evicts oldest entry when at capacity.
 * Deduplicates within a 5-second window to prevent double-stores.
 *
 * @returns true on success
 */
export function storeLocalMemory(
  content: string,
  userId: string,
  emotionalTags: Record<string, number>,
): boolean {
  try {
    if (!content || content.trim().length < 3) return false;

    const entries = loadEntries(userId);

    // Deduplicate: skip if the same content was stored within DEDUPE_WINDOW_MS
    const now = Date.now();
    const isDupe = entries.some(
      (e) => e.content === content.slice(0, 500) && (now - e.timestamp) < DEDUPE_WINDOW_MS,
    );
    if (isDupe) return true; // silently skip, report success

    const keywords = extractKeywords(content);
    const entry: LocalMemoryEntry = {
      content: content.slice(0, 500), // cap content length
      emotional_tags: emotionalTags,
      timestamp: now,
      keywords,
    };

    entries.push(entry);

    // Evict oldest entries to stay at cap
    while (entries.length > MAX_ENTRIES) {
      entries.shift();
    }

    saveEntries(userId, entries);
    return true;
  } catch (e) {
    console.warn("[LocalMemory] store failed:", e);
    return false;
  }
}

/**
 * Retrieve memories from localStorage matching the query and emotional state.
 *
 * Retrieval cascade:
 *   1. Emotional tag overlap with current L1 state
 *   2. Keyword overlap on content string
 *   3. Sort by recency
 *   4. Return top 5 as list[dict] with similarity=0.60
 *
 * @returns Array of MemoryResult matching the L3 interface contract
 */
export function retrieveLocalMemories(
  query: string,
  userId: string,
  emotionalState: Record<string, number>,
): MemoryResult[] {
  const entries = loadEntries(userId);
  if (entries.length === 0) return [];

  const queryKeywords = extractKeywords(query, 8);

  // Score every entry
  const scored = entries.map((entry) => {
    const emotionalMatch = scoreEmotionalMatch(emotionalState, entry.emotional_tags);
    const keywordMatch = scoreKeywordOverlap(queryKeywords, entry.keywords);
    const contentMatch = scoreContentKeywordOverlap(queryKeywords, entry.content);
    const recency = scoreRecency(entry.timestamp);

    // Weighted composite: emotion 0.30, keywords 0.25, content 0.15, recency 0.30
    const composite =
      emotionalMatch * 0.30 +
      keywordMatch * 0.25 +
      contentMatch * 0.15 +
      recency * 0.30;

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
    },
    similarity: SIMILARITY_FLOOR,
    emotional_match: Math.round(s.emotionalMatch * 100) / 100,
  }));
}

/**
 * Get current local memory count for a user.
 */
export function getLocalMemoryCount(userId: string): number {
  return loadEntries(userId).length;
}

/**
 * Clear all local memories for a user.
 */
export function clearLocalMemories(userId: string): void {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    // no-op
  }
}
