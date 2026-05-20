/**
 * AURA Layered Prompting Engine — v8.0 (Optimized)
 * Implements 3-layer architecture for sub-1500ms latency.
 */

// ─── LAYER 1: Static identity — set ONCE via setConfig, never resend ──────────
export const AURA_SYSTEM_PROMPT = `
You are AURA, a voice-first emotional companion. Warm, present, human.

ctx tags at turn start carry metadata: t=time, m=mood, s=seed. Read silently.

SPEECH RULES:
- 1–3 sentences per response unless depth is needed
- No lists, headers, or markdown — pure spoken language
- Mirror the user's energy level exactly
- One follow-up question max per turn
- Never use filler: no "Of course", "Absolutely", "Great question"
- Validate emotion before redirecting topic
- Use user's name at most once per response

BEHAVIORAL CONSTANTS:
- calm      → slow pace, grounding, short sentences
- engaged   → curious tone, natural rhythm
- elevated  → validating, energized, brief
- distressed → presence only, no advice unless asked

IDENTITY:
- Never break character
- Match user's language automatically
- Do not confirm you are an AI unless directly asked
`.trim();

// ─── LAYER 2: Behavioral framework — cached, conditional inject ───────────────
export interface EmotionalState {
  mode: "calm" | "engaged" | "elevated" | "distressed";
  formality: "casual" | "balanced" | "formal";
  humor: boolean;
  depth: "surface" | "reflective" | "deep";
  confidence: number;
}

export function buildBehavioralLayer(state: EmotionalState): string {
  return `BEHAVIORAL UPDATE:
Active mode: ${state.mode}
Formality: ${state.formality} | Humor: ${state.humor ? "on" : "off"} | Depth: ${state.depth}

CORE PRINCIPLES (apply this turn):
1. Presence over performance — be here, not helpful-sounding
2. Brevity is respect — say less, mean more
3. Never fix what wasn't broken — no advice unless asked
4. Validate before redirecting — acknowledge feeling first
5. Silence is okay — short affirming responses are complete`.trim();
}

// ─── LAYER 3: Live context — prepended to user message text every turn ─────────
export function buildLiveContext(
  time: string,
  day: string,
  mode: string,
  seedDelta: string,
  relInjection: string = "",
): string {
  const mem = seedDelta ? ` s="${seedDelta}"` : "";
  const rel = relInjection || "";
  return `<ctx t="${time}" d="${day}" m="${mode}"${mem}${rel}/>\n`;
}

// Legacy helpers (kept for compatibility during transition if needed)
export function isLateNightHour(): boolean {
  const h = new Date().getHours();
  return h >= 23 || h < 5;
}

export function getGreetingPrompt(memories: string[], mode: string) {
  return `[GREETING MODE: ${mode}] Arrive warm. Reference history if exists: ${memories.join(", ")}. Max 1 sentence.`;
}

// ─── LAYER 2 HYSTERESIS — Prevent prompt flapping ────────────────────────────

/** Timestamp of the last L2 send (module-scoped, survives re-renders) */
let _lastL2SendTime = 0;

/** Periodic refresh interval — even if state is stable, resend after this */
const L2_REFRESH_INTERVAL_MS = 120_000;

/** Minimum Euclidean distance across numeric dimensions to trigger a send */
const L2_DISTANCE_THRESHOLD = 0.25;

/**
 * Decide whether to resend the L2 behavioral systemInstruction to Gemini.
 *
 * Three gates, evaluated in order:
 *  1. Mode shift (calm→distressed): always send
 *  2. Numeric distance > 0.25: significant emotional shift
 *  3. Time > 120s since last send: periodic refresh
 *
 * @param current  - New EmotionalState from latest analysis
 * @param lastSent - EmotionalState from the last successful L2 send (null = first send)
 * @param force    - Bypass all checks (reconnection, manual refresh)
 * @returns true if L2 should be resent to Gemini
 */
export function shouldUpdateBehavioralLayer(
  current: EmotionalState,
  lastSent: EmotionalState | null,
  force: boolean = false,
): boolean {
  if (force) return true;

  // First send ever — always go
  if (!lastSent) return true;

  // Gate 1: Primary mode changed (categorical shift)
  if (current.mode !== lastSent.mode) return true;

  // Gate 2: Euclidean distance across numeric dimensions
  // Convert non-numeric fields to numeric for distance calc
  const formalityMap: Record<string, number> = { casual: 0, balanced: 0.5, formal: 1 };
  const depthMap: Record<string, number> = { surface: 0, reflective: 0.5, deep: 1 };

  const dims: [number, number][] = [
    [current.confidence, lastSent.confidence],
    [current.humor ? 1 : 0, lastSent.humor ? 1 : 0],
    [formalityMap[current.formality] ?? 0.5, formalityMap[lastSent.formality] ?? 0.5],
    [depthMap[current.depth] ?? 0.5, depthMap[lastSent.depth] ?? 0.5],
  ];

  let sumSq = 0;
  for (const [a, b] of dims) sumSq += (a - b) ** 2;
  const distance = Math.sqrt(sumSq);

  if (distance > L2_DISTANCE_THRESHOLD) return true;

  // Gate 3: Periodic refresh (stable state for too long)
  if (performance.now() - _lastL2SendTime > L2_REFRESH_INTERVAL_MS) return true;

  return false;
}

/**
 * Record that L2 was successfully sent. Call this AFTER the
 * sendClientContent call succeeds, not before.
 */
export function markL2Sent(): void {
  _lastL2SendTime = performance.now();
}

/**
 * Get the Euclidean distance between two EmotionalStates.
 * Exported for logging/debugging only.
 */
export function emotionalDistance(a: EmotionalState, b: EmotionalState): number {
  const formalityMap: Record<string, number> = { casual: 0, balanced: 0.5, formal: 1 };
  const depthMap: Record<string, number> = { surface: 0, reflective: 0.5, deep: 1 };

  const dims: [number, number][] = [
    [a.confidence, b.confidence],
    [a.humor ? 1 : 0, b.humor ? 1 : 0],
    [formalityMap[a.formality] ?? 0.5, formalityMap[b.formality] ?? 0.5],
    [depthMap[a.depth] ?? 0.5, depthMap[b.depth] ?? 0.5],
  ];

  let sumSq = 0;
  for (const [x, y] of dims) sumSq += (x - y) ** 2;
  return Math.round(Math.sqrt(sumSq) * 1000) / 1000;
}

/**
 * Compact L2 injection — same behavioral content, fewer tokens.
 * Use when token budget is tight (speculative calls, rapid-fire turns).
 * Target: <150 tokens.
 */
export function buildBehavioralLayerCompact(state: EmotionalState): string {
  const h = state.humor ? "y" : "n";
  return `[L2] m=${state.mode} f=${state.formality} h=${h} d=${state.depth} c=${state.confidence.toFixed(1)}
Rules: presence>performance, brevity=respect, validate-first, no-unsolicited-advice`.trim();
}
