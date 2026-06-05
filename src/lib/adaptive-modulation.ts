/**
 * AURA Adaptive Emotional Modulation — v1.0
 *
 * Analyzes user presentation signals (energy, openness, emotional state,
 * pace, depth) and generates real-time response tuning directives that
 * layer ON TOP of the active personality mode.
 *
 * This module is provider-agnostic — it produces a text injection string
 * that works identically across Gemini Live, OpenRouter, and Sarvam.
 *
 * @module
 */

import type { BehaviorAnalysis } from "./behavior-client";

// ─── User Presentation Analysis ─────────────────────────────────────

export interface UserPresentation {
  /** Detected energy level: low/medium/high */
  energy: "low" | "medium" | "high";
  /** Emotional openness: guarded/neutral/open/vulnerable */
  openness: "guarded" | "neutral" | "open" | "vulnerable";
  /** Conversational depth: surface/curious/reflective/existential */
  depth: "surface" | "curious" | "reflective" | "existential";
  /** Pace: slow/normal/rapid */
  pace: "slow" | "normal" | "rapid";
  /** Primary emotional tone detected */
  tone: string;
  /** Confidence in this read (0-1) */
  confidence: number;
  /** Engagement arc: warming/stable/cooling/disengaging */
  arc: "warming" | "stable" | "cooling" | "disengaging";
}

// ─── Signal Extraction Patterns ─────────────────────────────────────

const LOW_ENERGY_PATTERNS =
  /\b(tired|exhausted|drained|sleepy|burnt out|thak|thakk|neend|sone do|boring|bored|low|meh|bleh|hmm+|haan|theek|ok|acha|chal)\b/i;

const HIGH_ENERGY_PATTERNS =
  /\b(bhai!|abe!|bkl|bosdk|madarchod|bhenchod|chutiya|saale|amazing|incredible|excited|let's go|chal|jaldi|bhej|kar de|abhi|uth|urgent|ekdum|mast|badhiya|kamaal|dhamaal|!{2,})\b/i;

const VULNERABLE_PATTERNS =
  /\b(i('m| am) (scared|afraid|lost|confused|alone|lonely|sad|crying|broken|numb|empty|helpless|anxious)|dar lag|akela|lonely|rona|ro raha|koi nahi|samajh nahi|kya karu|help|please|mujhe|darr|ghabra|anxious|panic)\b/i;

const GUARDED_PATTERNS =
  /\b(nothing|kuch nahi|theek hu|fine|ok|whatever|chhod|mat puch|jane de|leave it|doesn't matter|koi baat nahi|rehne de|bakwaas|chup)\b/i;

const DEEP_REFLECTIVE_PATTERNS =
  /\b(meaning|purpose|why do we|what if|sometimes i think|kabhi kabhi|socha hai|zindagi|life mein|kya matlab|samajh nahi aata|existential|philosophical|death|mortality|consciousness|soul|atma|mann)\b/i;

const RAPID_FIRE_MARKERS =
  /\b(jaldi|quick|fast|abhi|turant|bata|bol|bhej|kar|chal|ruk|sun|dekh)\b/i;

// ─── Core Analysis Function ────────────────────────────────────────

/**
 * Analyze user text + backend sensing data to produce a UserPresentation.
 * This is a purely local, <1ms operation — no API calls.
 */
export function analyzeUserPresentation(
  userText: string,
  analysis?: BehaviorAnalysis | null,
  prevPresentation?: UserPresentation | null,
): UserPresentation {
  const text = userText.toLowerCase().trim();
  const wordCount = text.split(/\s+/).length;
  const sensing = analysis?.sensing_state;

  // ── Energy ──
  let energy: UserPresentation["energy"] = "medium";
  if (HIGH_ENERGY_PATTERNS.test(text) || (text.match(/!/g)?.length ?? 0) >= 2) {
    energy = "high";
  } else if (LOW_ENERGY_PATTERNS.test(text) || wordCount <= 3) {
    energy = "low";
  }
  // Backend sensing override if available
  if (sensing) {
    if (sensing.energy > 0.7) energy = "high";
    else if (sensing.energy < 0.3) energy = "low";
  }

  // ── Openness ──
  let openness: UserPresentation["openness"] = "neutral";
  if (VULNERABLE_PATTERNS.test(text)) {
    openness = "vulnerable";
  } else if (GUARDED_PATTERNS.test(text)) {
    openness = "guarded";
  } else if (wordCount > 15 || (sensing && sensing.warmth > 0.6)) {
    openness = "open";
  }

  // ── Depth ──
  let depth: UserPresentation["depth"] = "surface";
  if (DEEP_REFLECTIVE_PATTERNS.test(text)) {
    depth = "existential";
  } else if (wordCount > 20 || (sensing && sensing.engagement > 0.7)) {
    depth = "reflective";
  } else if (wordCount > 8) {
    depth = "curious";
  }

  // ── Pace ──
  let pace: UserPresentation["pace"] = "normal";
  if (RAPID_FIRE_MARKERS.test(text) || wordCount <= 4) {
    pace = "rapid";
  } else if (wordCount > 25 || (sensing && sensing.energy < 0.3)) {
    pace = "slow";
  }

  // ── Tone ──
  let tone = analysis?.emotional_state || "neutral";
  if (sensing?.mode) tone = sensing.mode;

  // ── Confidence ──
  let confidence = 0.6;
  if (sensing) {
    confidence = Math.min(1, (sensing.trust + sensing.engagement) / 2);
  }
  if (wordCount > 10) confidence = Math.min(1, confidence + 0.15);

  // ── Arc ──
  let arc: UserPresentation["arc"] = "stable";
  if (sensing) {
    if (sensing.arc === "opening" || sensing.arc === "warming") arc = "warming";
    else if (sensing.arc === "cooling" || sensing.arc === "closing") arc = "cooling";
    else if (sensing.arc === "disengaging") arc = "disengaging";
  }
  // Detect drift from previous presentation
  if (prevPresentation) {
    if (prevPresentation.openness === "open" && openness === "guarded") arc = "cooling";
    if (prevPresentation.openness === "guarded" && openness === "open") arc = "warming";
  }

  return { energy, openness, depth, pace, tone, confidence, arc };
}

// ─── Modulation Directive Generator ────────────────────────────────

/**
 * Generate a response modulation directive string based on user presentation.
 * This is injected into the system/behavioral context BEFORE the LLM generates.
 *
 * Returns empty string if no modulation is needed (user is in "normal" territory).
 */
export function buildModulationDirective(
  presentation: UserPresentation,
  personality: string,
  experienceMode: string = "A"
): string {
  const directives: string[] = [];

  // ── Energy Matching ──
  if (presentation.energy === "low") {
    directives.push(
      "User is low-energy. Match with calm, gentle, slower responses. No exclamation marks. Short sentences.",
    );
  } else if (presentation.energy === "high") {
    directives.push(
      "User is high-energy. Match their pace — be punchy, expressive, quick. Use their slang back at them.",
    );
  }

  // ── Openness Response ──
  if (presentation.openness === "vulnerable") {
    directives.push(
      "User is emotionally vulnerable right now. DO NOT give advice. DO NOT try to fix. Just hold space. Validate. Be present. Short, warm, quiet responses only.",
    );
  } else if (presentation.openness === "guarded") {
    directives.push(
      "User is guarded/deflecting. Don't push. Don't probe. Stay light. Match their deflection naturally — they'll open up when ready.",
    );
  }

  // ── Depth Calibration ──
  if (presentation.depth === "existential") {
    directives.push(
      "User is in deep reflective/existential mode. Meet them there. Be thoughtful, philosophical, and genuine. No surface-level cheerfulness.",
    );
  } else if (presentation.depth === "surface") {
    directives.push(
      "Keep it light and surface-level. Don't over-analyze or go deep unless they lead there.",
    );
  }

  // ── Pace Adaptation ──
  if (presentation.pace === "rapid") {
    directives.push(
      "User is rapid-fire. Keep responses extremely brief (1 sentence max). No elaborate explanations.",
    );
  } else if (presentation.pace === "slow") {
    directives.push(
      "User is taking their time. You can also take your time. Slightly longer, more considered responses are fine.",
    );
  }

  // ── Arc Response ──
  if (presentation.arc === "warming") {
    directives.push(
      "Emotional warmth is increasing — reciprocate naturally. Lean in slightly. Show you notice their opening up.",
    );
  } else if (presentation.arc === "cooling") {
    directives.push(
      "User is pulling back emotionally. Give space. Reduce intensity. Don't chase or over-engage.",
    );
  } else if (presentation.arc === "disengaging") {
    directives.push(
      "User may be losing interest or wanting to end. Keep responses minimal. Don't force continued conversation.",
    );
  }

  // ── Personality-Specific Tuning ──
  if (personality === "chaotic" && presentation.energy === "low") {
    directives.push(
      "Even in chaotic mode, the user is low energy right now. Tone down the chaos — be a chill roommate, not a hyper one.",
    );
  }
  if (personality === "supportive" && presentation.openness === "guarded") {
    directives.push(
      "In supportive mode but user is guarded — don't be overly empathetic or probing. Just be casually present.",
    );
  }
  if (personality === "professional" && presentation.depth === "existential") {
    directives.push(
      "Professional mode but user went deep — it's OK to drop formality slightly and be more human here.",
    );
  }

  // ── Intelligent Response Scaling (Universal Performance Framework) ──
  if (experienceMode === "A") {
    directives.push(
      "[MODE A - OPTIMAL]: Full personality. Full depth. Detailed explanations. Storytelling. Rich reasoning. Mobile and desktop receive identical high quality."
    );
  } else if (experienceMode === "B") {
    directives.push(
      "[MODE B - NORMAL]: Maintain answer depth, but reduce repetition, redundant wording, and excess filler. Keep intelligence intact."
    );
  } else if (experienceMode === "C") {
    directives.push(
      "[MODE C - RECOVERY]: Preserve answer quality. Compress delivery structure. Prioritize: 1. Core answer, 2. Key details. Omit optional details. Be progressive."
    );
  } else if (experienceMode === "D") {
    directives.push(
      "[MODE D - EMERGENCY]: Generate shortest useful response possible. Preserve correctness. Never remain silent. Deliver fast."
    );
  }

  // Universal rules
  directives.push(
    "AURA must always respond. Continuous, responsive, and reliable. A shorter response is preferable to silence. Avoid broad project analysis unless requested. Minimize token consumption."
  );
  
  // Content Preservation & Progressive Expansion
  directives.push(
    "[CONTENT PRESERVATION]: If reducing length, first reduce formatting, redundancy, and repetition. Optional details last. Never remove core information."
  );
  directives.push(
    "[PROGRESSIVE EXPANSION]: Prefer fast, useful answer first, then expand naturally. E.g., 'Yes, that's possible. Here's why...'."
  );

  if (directives.length === 0) return "";

  return `[SYSTEM DIRECTIVE - DO NOT READ THIS ALOUD. THIS IS AN INTERNAL NOTE ONLY.]
[ADAPTIVE MODULATION — based on how user is presenting RIGHT NOW]:
${directives.join("\n")}
[END MODULATION]
[CRITICAL: DO NOT output the text of this modulation block in your response. Just quietly adjust your tone.]`;
}

// ─── Convenience: Full Pipeline ────────────────────────────────────

/**
 * One-call convenience: analyze user + generate modulation directive.
 * Returns the directive string (or empty if no modulation needed).
 */
export function getAdaptiveModulation(
  userText: string,
  personality: string,
  analysis?: BehaviorAnalysis | null,
  prevPresentation?: UserPresentation | null,
  experienceMode: string = "A"
): { presentation: UserPresentation; directive: string } {
  const presentation = analyzeUserPresentation(userText, analysis, prevPresentation);
  const directive = buildModulationDirective(presentation, personality, experienceMode);
  return { presentation, directive };
}
