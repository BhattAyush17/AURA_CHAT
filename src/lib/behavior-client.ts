import { ENDPOINTS } from "@/config/api";
import { emitLatency } from "@/components/LatencyMeter";
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
): Promise<BehaviorAnalysis | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);

    const ideologyHint = mode ? (MODE_TO_IDEOLOGY[mode] ?? null) : null;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
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
