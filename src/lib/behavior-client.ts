import { ENDPOINTS } from "@/config/api";
import { emitLatency } from "@/components/LatencyMeter";
import { getCredential } from "@/lib/credentials";
// API_SECRET import removed

export interface LanguageProfile {
  mode: "hindi_native" | "hinglish" | "mixed" | "english";
  is_informal: boolean;
  has_abuse: boolean;
  devanagari_ratio: number;
  hinglish_count: number;
}

export interface BehaviorAnalysis {
  act: string | null;
  tags: string[];
  template: string | null;
  source: string | null;
  energy: string;
  behavior_instructions: string;
  emotional_state: string;
  intensity: number;
  sensing_state?: {
    energy: number;
    warmth: number;
    engagement: number;
    trust: number;
    tension: number;
    arc: string;
    arc_turns: number;
    mode: string;
    session_turn: number;
    chroma_ready: boolean;
    response_delay_hint: number;
  };
  status: string;
  memory_layer?: string;
  memory_enrichment?: string;
  language_profile?: LanguageProfile;
  frustration?: number;
  playfulness?: number;
  vulnerability?: number;
  trust?: number;
  anxiety?: number;
}

const MODE_TO_IDEOLOGY: Record<string, string> = {
  chaotic: "RAW_CHAOTIC_MALE_HOSTEL",
  genz: "GENZ_PLAYFUL_BOND_DEEP_UNDERCURRENT",
  balanced: "PLAYFUL_PROFESSIONAL_FRIENDSHIP_BALANCED",
  professional: "FORMAL_PROFESSIONAL_COLLABORATIVE",
  supportive: "EMOTIONALLY_INTELLIGENT_DEEP_SUPPORTIVE",
  philosophical: "MINIMAL_PHILOSOPHICAL_MALE_INTROSPECTIVE",
  caring: "EMOTIONALLY_INTELLIGENT_DEEP_SUPPORTIVE",
  latenight: "LATE_NIGHT_RAW_HONEST",
};

export async function analyzeBehavior(
  userText: string,
  sessionId: string,
  audioRms: number = 0.02,
  pauseMs: number = 0,
  mode?: string,
  apiKey?: string,
  userId?: string,
  wasInterrupted: boolean = false,
): Promise<BehaviorAnalysis | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);

    const ideologyHint = mode ? (MODE_TO_IDEOLOGY[mode] ?? null) : null;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-OpenRouter-Key": getCredential("openrouter_api_key") || "",
      "X-Gemini-Key": getCredential("aura_gemini_api_key") || "",
      "X-Cohere-Key": getCredential("cohere_api_key") || "",
      "X-Pinecone-Key": getCredential("pinecone_api_key") || "",
      "X-Redis-Url": getCredential("redis_url") || "",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    // X-Internal-Key removed — it was a VITE_ variable, visible in the JS bundle.
    // The backend now validates the Origin header instead.

    const backendStart = performance.now();
    const response = await fetch(ENDPOINTS.analyze, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user_text: userText,
        session_id: sessionId,
        user_id: userId || "",
        audio_rms: audioRms,
        pause_ms: pauseMs,
        ideology_hint: ideologyHint,
        was_interrupted: wasInterrupted,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!response.ok) return null;
    const result = await response.json();
    emitLatency("backendAnalysis", performance.now() - backendStart);
    if (result.memory_layer) {
      emitLatency("memoryLayer", result.memory_layer);
    }
    return result as BehaviorAnalysis;
  } catch {
    return null;
  }
}

export async function isBehaviorEngineAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(ENDPOINTS.health, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SPECULATIVE PRE-FETCH
// ═══════════════════════════════════════════════════════════════════
// Fire a lightweight /api/analyze during user speech (before turnComplete).
// The backend can serve this from Redis hot-cache in <5ms. If the final
// transcript is close enough to the speculative input, we skip the
// post-turnComplete call entirely — saving 100-200ms.

/** Module-scoped debounce state (no re-renders) */
let _lastSpecTime = 0;
let _lastSpecText = "";

/** Hit-rate tracking for observability */
let _specHits = 0;
let _specMisses = 0;

/**
 * Fire a speculative analyze call during user speech.
 * Shorter timeout than regular analyze — if it doesn't return fast,
 * we'll just use the regular post-turnComplete call.
 *
 * @param partialText - Partial transcript from inputTranscription
 * @param sessionId  - Current session ID
 * @param signal     - AbortSignal for cancellation on new partials
 * @param userId     - Optional user ID
 */
export async function speculativeAnalyze(
  partialText: string,
  sessionId: string,
  signal: AbortSignal,
  userId?: string,
): Promise<BehaviorAnalysis | null> {
  try {
    const timeout = setTimeout(() => {
      // No-op: AbortController handles cancellation
    }, 300);

    const response = await fetch(ENDPOINTS.analyze, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Speculative": "true",
      },
      body: JSON.stringify({
        user_text: partialText,
        session_id: sessionId,
        user_id: userId || "",
        audio_rms: 0.02,
        pause_ms: 0,
      }),
      signal,
    });

    clearTimeout(timeout);
    if (!response.ok) return null;
    return (await response.json()) as BehaviorAnalysis;
  } catch {
    return null; // Aborted or timed out — totally fine
  }
}

/**
 * Gate: should we fire a speculative call for this partial text?
 *
 * Rules:
 *  - At least 4 words (enough semantic signal for analysis)
 *  - At least 500ms since last speculative call (debounce)
 *  - Text differs from last speculated text (no duplicate calls)
 */
export function shouldSpeculate(partialText: string): boolean {
  const words = partialText.trim().split(/\s+/);
  if (words.length < 4) return false;

  const now = performance.now();
  if (now - _lastSpecTime < 500) return false;

  if (partialText === _lastSpecText) return false;

  _lastSpecTime = now;
  _lastSpecText = partialText;
  return true;
}

/**
 * Check if a speculative result is close enough to the final transcript
 * to be usable without a fresh /api/analyze call.
 *
 * Uses word overlap ratio: if ≥70% of words match, the speculative
 * result is good enough (emotional tone and intent rarely change
 * in the last 1-2 words of a sentence).
 */
export function isSpeculativeResultUsable(speculativeInput: string, finalInput: string): boolean {
  const specWords = new Set(speculativeInput.toLowerCase().split(/\s+/));
  const finalWords = finalInput.toLowerCase().split(/\s+/);
  if (finalWords.length === 0) return false;

  let matches = 0;
  for (const w of finalWords) {
    if (specWords.has(w)) matches++;
  }

  return matches / finalWords.length >= 0.7;
}

/**
 * Record a speculative hit or miss for observability.
 * Stores cumulative hit rate in sessionStorage.
 */
export function logSpeculativeResult(hit: boolean): void {
  if (hit) _specHits++;
  else _specMisses++;

  const total = _specHits + _specMisses;
  const rate = total > 0 ? Math.round((_specHits / total) * 100) : 0;
  console.log(`[SPECULATIVE] ${hit ? "HIT" : "MISS"} | rate: ${rate}% (${_specHits}/${total})`);

  try {
    sessionStorage.setItem(
      "aura_spec_stats",
      JSON.stringify({
        hits: _specHits,
        misses: _specMisses,
        rate,
      }),
    );
  } catch {}
}
