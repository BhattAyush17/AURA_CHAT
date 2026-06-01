/**
 * useConversationalPauses — Semantic pause classification for AURA TTS pipeline.
 *
 * Core Principle: Pauses are driven by MEANING, not punctuation.
 * Humans pause based on:
 *   - Completion of ideas
 *   - Emotional emphasis
 *   - Invitation for user participation
 *   - Reflection or thinking moments
 *   - Topic transitions
 *
 * Pause Categories:
 *   CONTINUE            — 300–600ms  (more speech is clearly coming)
 *   EMPHASIS            — 700–1200ms (let the listener absorb the point)
 *   INTERJECTION_WINDOW — 1200–1800ms (natural conversational opening)
 *   THINKING            — 1000–2500ms (genuine reflection, used sparingly)
 *
 * Critical Rule: Normal sentence-to-sentence pauses must NEVER exceed 1s
 * unless the user is being invited to respond, the speaker is intentionally
 * reflecting, or a strong emotional effect is desired.
 *
 * @module
 */

import { useRef, useCallback } from "react";

// ─── Pause Category Types ───────────────────────────────────────────

export type PauseCategory =
  | "CONTINUE"
  | "EMPHASIS"
  | "INTERJECTION_WINDOW"
  | "THINKING";

export interface PauseClassification {
  category: PauseCategory;
  durationMs: number;
  /** Whether the system should be ready to stop TTS on user speech */
  listenForInterruption: boolean;
  /** Debug reason for the classification */
  reason: string;
}

export interface ConversationalContext {
  /** The sentence/clause just spoken */
  currentSentence: string;
  /** The next sentence/clause about to be spoken (if available) */
  nextSentence?: string;
  /** Index of current sentence in the full response (0-based) */
  sentenceIndex: number;
  /** Total number of sentences in the full response (if known) */
  totalSentences?: number;
  /** Whether the stream is still producing tokens */
  isStreamingDone: boolean;
  /** Current emotional state from behavior analysis */
  emotionalState?: {
    tension: number;
    trust: number;
    energy: number;
    mode: string;
  };
}

// ─── Semantic Pattern Detectors ─────────────────────────────────────

/**
 * Detects genuine questions that invite user response.
 * NOT rhetorical questions — those are EMPHASIS or CONTINUE.
 */
const GENUINE_QUESTION_PATTERNS = [
  /\bwhat do you think\b/i,
  /\bdoes that make sense\b/i,
  /\bhave you (ever )?(noticed|tried|seen|thought|experienced|considered)\b/i,
  /\bwhat about you\b/i,
  /\bhow (do|does|did|would|could|about) you\b/i,
  /\bdo you (agree|understand|see|know|remember|want|need|feel|mean)\b/i,
  /\bwhat('s| is) your (take|opinion|thought|view|perspective|experience)\b/i,
  /\bcan you (tell|share|explain|describe)\b/i,
  /\bright\?$/i,
  /\byou know\?$/i,
  /\byeah\?$/i,
  /\bwhat would you (do|say|suggest)\b/i,
  /\bever (thought|wondered|felt|noticed)\b/i,
  /\bisn't (it|that)\?$/i,
  /\bdon't you think\b/i,
];

/** Detects rhetorical questions (should NOT create INTERJECTION_WINDOW) */
const RHETORICAL_PATTERNS = [
  /\bwho (would|could|can) (even|really|actually)\b/i,
  /\bwhy would (anyone|you|I|they|we)\b/i,
  /\bhow (could|would|can) (anyone|that|this) (possibly|even)\b/i,
  /\bisn't that (just|so|exactly|basically)\b/i,
  /\bcan you (even )?imagine\b/i,
  /\bwouldn't that be\b/i,
  /\bwho (even|really) (cares|knows|wants)\b/i,
];

/** Detects statements that carry strong emotional weight */
const EMPHASIS_PATTERNS = [
  /\bthat('s| is) (actually|really|truly|so|incredibly|extremely) (important|significant|powerful|meaningful|profound|beautiful|amazing)\b/i,
  /\bthat changes everything\b/i,
  /\band (that|this) is (the|a) (key|real|biggest|most important|crucial)\b/i,
  /\bhere's (the|what's) (thing|interesting|crazy|beautiful)\b/i,
  /\bthink about (that|this|it) for a (moment|second)\b/i,
  /\bthis (matters|is important|is crucial|is everything|is the point)\b/i,
  /\blet that sink in\b/i,
  /\bthat's the whole point\b/i,
  /\bI (really |truly |genuinely )?(mean|believe|feel) (that|this|it)\b/i,
  /\band (that's|this is) what (makes|gives|creates|defines)\b/i,
];

/** Detects thinking / reflection markers */
const THINKING_PATTERNS = [
  /^(hmm|hm+|umm?|well)\b/i,
  /\blet me think\b/i,
  /\bthat's a (good|great|interesting|tough|hard|difficult) (question|point)\b/i,
  /\bI('m| am) (not sure|thinking|wondering|trying to)\b/i,
  /\bgive me a (second|moment|sec)\b/i,
  /\bactually[,.]?\s*wait\b/i,
  /\bhold on\b/i,
];

/** Detects continuation signals — same thought, more coming */
const CONTINUATION_SIGNALS = [
  /\band (so|then|also|plus|besides|furthermore|moreover)\b/i,
  /\bbut (the thing is|here's|what I|also)\b/i,
  /\b(so|because|since|therefore|however|although|while|whereas)\b/i,
  /\bfor (example|instance)\b/i,
  /\blike (when|how|the)\b/i,
  /\bin (fact|other words|addition)\b/i,
  /\bnot only\b/i,
  /\bthe (first|second|third|next|other|main)\b/i,
  /\bon (one|the other) hand\b/i,
];

/** Detects topic transitions */
const TOPIC_TRANSITION_PATTERNS = [
  /\banyway(s)?\b/i,
  /\bmoving on\b/i,
  /\bspeaking of\b/i,
  /\bon a (different|related|separate) (note|topic)\b/i,
  /\bthat (said|aside|being said)\b/i,
  /\bbut (back to|let's talk about|anyway)\b/i,
  /\bso about\b/i,
  /\bchanging (gears|subjects|topics)\b/i,
];

/** Patterns that suggest "maybe the user should respond" */
const SOFT_INVITATION_PATTERNS = [
  /\bmaybe (that's|you|we|it's|it is|this is)\b/i,
  /\bjust (something|a thought|saying|wondering|curious)\b/i,
  /\bI (don't|do not) know\b/i,
  /\bit('s| is) (up to|your call|for you to)\b/i,
  /\bwhat do you make of\b/i,
  /\bcurious (what|how|if|whether)\b/i,
  /\bI('d| would) (love|like) to (hear|know)\b/i,
];

// ─── Punctuation Analysis ───────────────────────────────────────────

interface PunctuationSignal {
  trailingPunctuation: "period" | "question" | "exclamation" | "ellipsis" | "comma" | "none";
  /** Whether the sentence ends with strong finality */
  hasStrongEnding: boolean;
}

function analyzePunctuation(text: string): PunctuationSignal {
  const trimmed = text.trim();
  const lastChar = trimmed.slice(-1);
  const lastThree = trimmed.slice(-3);

  let trailingPunctuation: PunctuationSignal["trailingPunctuation"] = "none";
  if (lastThree === "...") trailingPunctuation = "ellipsis";
  else if (lastChar === "?") trailingPunctuation = "question";
  else if (lastChar === "!") trailingPunctuation = "exclamation";
  else if (lastChar === ".") trailingPunctuation = "period";
  else if (lastChar === ",") trailingPunctuation = "comma";

  const hasStrongEnding = [".", "!", "?"].includes(lastChar) && lastThree !== "...";

  return { trailingPunctuation, hasStrongEnding };
}

// ─── Pattern Matching Utility ───────────────────────────────────────

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

// ─── Duration Randomizer ────────────────────────────────────────────

/**
 * Returns a duration within the specified range with natural jitter.
 * Uses a slight bias toward the lower end to keep flow fast by default.
 */
function durationInRange(min: number, max: number): number {
  // Bias toward lower 60% of the range for conversational flow
  const t = Math.random() * Math.random(); // Squared distribution → lower bias
  return Math.round(min + t * (max - min));
}

// ─── Core Classification Engine ─────────────────────────────────────

/**
 * Classify the pause that should follow a sentence/clause in AURA's speech.
 *
 * Evaluation order (first match wins):
 *   1. THINKING signals
 *   2. Genuine questions → INTERJECTION_WINDOW
 *   3. Soft invitations → INTERJECTION_WINDOW (shorter)
 *   4. Last sentence of response → INTERJECTION_WINDOW
 *   5. Emphasis signals
 *   6. Topic transitions → EMPHASIS (slightly longer CONTINUE)
 *   7. Ellipsis → THINKING or EMPHASIS depending on context
 *   8. Exclamation → EMPHASIS
 *   9. Continuation signals → CONTINUE (shorter)
 *   10. Default: CONTINUE
 */
export function classifySentencePause(ctx: ConversationalContext): PauseClassification {
  const { currentSentence, nextSentence, sentenceIndex, totalSentences, isStreamingDone, emotionalState } = ctx;
  const text = currentSentence.trim();
  const punct = analyzePunctuation(text);

  // ── 1. THINKING markers ─────────────────────────────────────────
  if (matchesAny(text, THINKING_PATTERNS)) {
    return {
      category: "THINKING",
      durationMs: durationInRange(1000, 2000),
      listenForInterruption: false,
      reason: "Thinking/reflection marker detected",
    };
  }

  // ── 2. Genuine questions that invite response ───────────────────
  if (punct.trailingPunctuation === "question" && !matchesAny(text, RHETORICAL_PATTERNS)) {
    if (matchesAny(text, GENUINE_QUESTION_PATTERNS)) {
      return {
        category: "INTERJECTION_WINDOW",
        durationMs: durationInRange(1200, 1800),
        listenForInterruption: true,
        reason: "Genuine question inviting user response",
      };
    }
  }

  // ── 3. Soft invitations ─────────────────────────────────────────
  if (matchesAny(text, SOFT_INVITATION_PATTERNS)) {
    return {
      category: "INTERJECTION_WINDOW",
      durationMs: durationInRange(1200, 1500),
      listenForInterruption: true,
      reason: "Soft invitation for user input",
    };
  }

  // ── 4. Last sentence of a completed response → natural turn end ─
  if (isStreamingDone && !nextSentence) {
    const isLastSentence = totalSentences !== undefined && sentenceIndex >= totalSentences - 1;
    if (isLastSentence || totalSentences === undefined) {
      return {
        category: "INTERJECTION_WINDOW",
        durationMs: durationInRange(1200, 1800),
        listenForInterruption: true,
        reason: "Final sentence of response — natural turn ending",
      };
    }
  }

  // ── 5. Emphasis patterns ────────────────────────────────────────
  if (matchesAny(text, EMPHASIS_PATTERNS)) {
    // If high tension/emotion, stretch it
    const emotionBoost = emotionalState && emotionalState.tension > 0.5 ? 200 : 0;
    return {
      category: "EMPHASIS",
      durationMs: durationInRange(700, 1000) + emotionBoost,
      listenForInterruption: false,
      reason: "Emphasis-worthy statement",
    };
  }

  // ── 6. Topic transitions → slightly longer pause ────────────────
  if (matchesAny(text, TOPIC_TRANSITION_PATTERNS)) {
    return {
      category: "EMPHASIS",
      durationMs: durationInRange(700, 1000),
      listenForInterruption: false,
      reason: "Topic transition",
    };
  }

  // ── 7. Ellipsis → THINKING or EMPHASIS ──────────────────────────
  if (punct.trailingPunctuation === "ellipsis") {
    // If short (under 6 words), more likely thinking
    const wordCount = text.split(/\s+/).length;
    if (wordCount <= 6) {
      return {
        category: "THINKING",
        durationMs: durationInRange(1000, 1800),
        listenForInterruption: false,
        reason: "Short ellipsis → thinking trail-off",
      };
    }
    return {
      category: "EMPHASIS",
      durationMs: durationInRange(700, 1000),
      listenForInterruption: false,
      reason: "Ellipsis → trailing emphasis",
    };
  }

  // ── 8. Exclamation → EMPHASIS (short) ───────────────────────────
  if (punct.trailingPunctuation === "exclamation") {
    return {
      category: "EMPHASIS",
      durationMs: durationInRange(500, 800),
      listenForInterruption: false,
      reason: "Exclamation — emotional punctuation",
    };
  }

  // ── 9. Rhetorical question → short CONTINUE ────────────────────
  if (punct.trailingPunctuation === "question" && matchesAny(text, RHETORICAL_PATTERNS)) {
    return {
      category: "CONTINUE",
      durationMs: durationInRange(400, 600),
      listenForInterruption: false,
      reason: "Rhetorical question — no response expected",
    };
  }

  // ── 10. Continuation signals ────────────────────────────────────
  if (nextSentence && matchesAny(nextSentence, CONTINUATION_SIGNALS)) {
    return {
      category: "CONTINUE",
      durationMs: durationInRange(200, 400),
      listenForInterruption: false,
      reason: "Next sentence continues same thought",
    };
  }

  // ── 11. Default: CONTINUE ───────────────────────────────────────
  // Comma → very short, Period → standard continue
  if (punct.trailingPunctuation === "comma") {
    return {
      category: "CONTINUE",
      durationMs: durationInRange(100, 300),
      listenForInterruption: false,
      reason: "Comma — minimal pause",
    };
  }

  // Standard sentence boundary
  return {
    category: "CONTINUE",
    durationMs: durationInRange(300, 600),
    listenForInterruption: false,
    reason: "Default sentence boundary",
  };
}

// ─── Hook: Tracks conversation flow for adaptive pause tuning ───────

export function useConversationalPauses() {
  /** Count of consecutive INTERJECTION_WINDOW pauses that got no user response */
  const unansweredWindowsRef = useRef(0);
  /** Timestamp of the last pause start (for measuring user reaction time) */
  const lastPauseStartRef = useRef(0);
  /** Whether we're currently in an interjection window */
  const inInterjectionWindowRef = useRef(false);

  /**
   * Classify and get the pause for a sentence transition.
   * This is the main API — call this between each sentence in the TTS drain queue.
   */
  const getPause = useCallback(
    (ctx: ConversationalContext): PauseClassification => {
      const classification = classifySentencePause(ctx);

      // Adaptive: If we've had 3+ unanswered interjection windows in a row,
      // downgrade future windows to shorter EMPHASIS to avoid awkward silence
      if (
        classification.category === "INTERJECTION_WINDOW" &&
        unansweredWindowsRef.current >= 3
      ) {
        classification.category = "EMPHASIS";
        classification.durationMs = Math.min(classification.durationMs, 800);
        classification.listenForInterruption = false;
        classification.reason += " (downgraded: 3+ unanswered windows)";
      }

      // Track for adaptive behavior
      if (classification.category === "INTERJECTION_WINDOW") {
        unansweredWindowsRef.current += 1;
        inInterjectionWindowRef.current = true;
        lastPauseStartRef.current = performance.now();
      } else {
        inInterjectionWindowRef.current = false;
      }

      return classification;
    },
    [],
  );

  /**
   * Signal that the user spoke during an interjection window.
   * Resets the unanswered counter.
   */
  const userRespondedDuringWindow = useCallback(() => {
    unansweredWindowsRef.current = 0;
    inInterjectionWindowRef.current = false;
  }, []);

  /**
   * Reset state for a new response/turn.
   */
  const resetForNewTurn = useCallback(() => {
    unansweredWindowsRef.current = 0;
    inInterjectionWindowRef.current = false;
    lastPauseStartRef.current = 0;
  }, []);

  /**
   * Whether we're currently in an interjection window
   * (for the barge-in monitor to use heightened sensitivity).
   */
  const isInInterjectionWindow = useCallback(
    () => inInterjectionWindowRef.current,
    [],
  );

  return {
    getPause,
    userRespondedDuringWindow,
    resetForNewTurn,
    isInInterjectionWindow,
  };
}
