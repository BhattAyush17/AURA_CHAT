/**
 * useConversationalPauses — Semantic pause classification & Conversational Rhythm for AURA TTS pipeline.
 *
 * Core Principle: AURA should never feel like it is "waiting for permission to continue speaking."
 * Humans create the illusion of thoughtfulness through subtle timing variation, not multi-second silence.
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
  listenForInterruption: boolean;
  reason: string;
  isBreath?: boolean;
}

export interface ConversationalContext {
  currentSentence: string;
  nextSentence?: string;
  sentenceIndex: number;
  totalSentences?: number;
  isStreamingDone: boolean;
  queueSize?: number;
  emotionalState?: {
    tension: number;
    trust: number;
    energy: number;
    mode: string;
  };
}

// ─── Hard Limits ────────────────────────────────────────────────────

const LIMITS = {
  CONTINUATION_MAX: 600,
  REFLECTION_MAX: 800,
  YIELD_MAX: 1200,
  FAILSAFE_MAX: 1500,
};

// ─── Semantic Pattern Detectors ─────────────────────────────────────

const GENUINE_QUESTION_PATTERNS = [
  /\bwhat do you think\b/i, /\bdoes that make sense\b/i, /\bhave you (ever )?(noticed|tried|seen|thought|experienced|considered)\b/i,
  /\bwhat about you\b/i, /\bhow (do|does|did|would|could|about) you\b/i, /\bdo you (agree|understand|see|know|remember|want|need|feel|mean)\b/i,
  /\bwhat('s| is) your (take|opinion|thought|view|perspective|experience)\b/i, /\bcan you (tell|share|explain|describe)\b/i,
  /\bright\?$/i, /\byou know\?$/i, /\byeah\?$/i, /\bwhat would you (do|say|suggest)\b/i, /\bever (thought|wondered|felt|noticed)\b/i,
  /\bisn't (it|that)\?$/i, /\bdon't you think\b/i,
];

const RHETORICAL_PATTERNS = [
  /\bwho (would|could|can) (even|really|actually)\b/i, /\bwhy would (anyone|you|I|they|we)\b/i,
  /\bhow (could|would|can) (anyone|that|this) (possibly|even)\b/i, /\bisn't that (just|so|exactly|basically)\b/i,
  /\bcan you (even )?imagine\b/i, /\bwouldn't that be\b/i, /\bwho (even|really) (cares|knows|wants)\b/i,
];

const EMPHASIS_PATTERNS = [
  /\bthat('s| is) (actually|really|truly|so|incredibly|extremely) (important|significant|powerful|meaningful|profound|beautiful|amazing)\b/i,
  /\bthat changes everything\b/i, /\band (that|this) is (the|a) (key|real|biggest|most important|crucial)\b/i,
  /\bhere's (the|what's) (thing|interesting|crazy|beautiful)\b/i, /\bthink about (that|this|it) for a (moment|second)\b/i,
  /\bthis (matters|is important|is crucial|is everything|is the point)\b/i, /\blet that sink in\b/i, /\bthat's the whole point\b/i,
  /\bI (really |truly |genuinely )?(mean|believe|feel) (that|this|it)\b/i, /\band (that's|this is) what (makes|gives|creates|defines)\b/i,
];

const THINKING_PATTERNS = [
  /^(hmm|hm+|umm?|well)\b/i, /\blet me think\b/i, /\bthat's a (good|great|interesting|tough|hard|difficult) (question|point)\b/i,
  /\bI('m| am) (not sure|thinking|wondering|trying to)\b/i, /\bgive me a (second|moment|sec)\b/i, /\bactually[,.]?\s*wait\b/i, /\bhold on\b/i,
];

const CONTINUATION_SIGNALS = [
  /\band (so|then|also|plus|besides|furthermore|moreover)\b/i, /\bbut (the thing is|here's|what I|also)\b/i,
  /\b(so|because|since|therefore|however|although|while|whereas)\b/i, /\bfor (example|instance)\b/i, /\blike (when|how|the)\b/i,
  /\bin (fact|other words|addition)\b/i, /\bnot only\b/i, /\bthe (first|second|third|next|other|main)\b/i, /\bon (one|the other) hand\b/i,
];

const TOPIC_TRANSITION_PATTERNS = [
  /\banyway(s)?\b/i, /\bmoving on\b/i, /\bspeaking of\b/i, /\bon a (different|related|separate) (note|topic)\b/i,
  /\bthat (said|aside|being said)\b/i, /\bbut (back to|let's talk about|anyway)\b/i, /\bso about\b/i, /\bchanging (gears|subjects|topics)\b/i,
];

const SOFT_INVITATION_PATTERNS = [
  /\bmaybe (that's|you|we|it's|it is|this is)\b/i, /\bjust (something|a thought|saying|wondering|curious)\b/i,
  /\bI (don't|do not) know\b/i, /\bit('s| is) (up to|your call|for you to)\b/i, /\bwhat do you make of\b/i,
  /\bcurious (what|how|if|whether)\b/i, /\bI('d| would) (love|like) to (hear|know)\b/i,
];

// ─── Punctuation Analysis ───────────────────────────────────────────

interface PunctuationSignal {
  trailingPunctuation: "period" | "question" | "exclamation" | "ellipsis" | "comma" | "none";
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

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

// ─── Hook: Tracks conversation flow & computes dynamic pauses ───────

export function useConversationalPauses() {
  // Momentum System: 0.5 (slow/reflective) to 1.5 (fast/exciting)
  const momentumRef = useRef(1.0);
  
  // User Rhythm Profile
  const rhythmProfileRef = useRef({
    avgResponseLatency: 1000,
    interruptCount: 0,
    turnCount: 0,
    factor: 1.0, // 0.7 (fast) to 1.3 (patient)
  });

  const lastPauseStartRef = useRef(0);
  const inInterjectionWindowRef = useRef(false);

  // Measure User Rhythm on their responses
  const userRespondedDuringWindow = useCallback((latencyMs?: number) => {
    inInterjectionWindowRef.current = false;
    
    // Update rhythm profile
    const profile = rhythmProfileRef.current;
    profile.interruptCount++;
    profile.turnCount++;
    
    if (latencyMs) {
      // Exponential moving average for response latency
      profile.avgResponseLatency = (profile.avgResponseLatency * 0.7) + (latencyMs * 0.3);
    }
    
    // Adjust rhythm factor: frequent interrupters get a lower factor (faster pacing)
    const interruptRate = profile.interruptCount / Math.max(1, profile.turnCount);
    if (interruptRate > 0.3) {
      profile.factor = Math.max(0.7, profile.factor - 0.05);
    }
    
    // Increase momentum on fast replies/interrupts
    momentumRef.current = Math.min(1.5, momentumRef.current + 0.1);
  }, []);

  const resetForNewTurn = useCallback(() => {
    inInterjectionWindowRef.current = false;
    lastPauseStartRef.current = 0;
    rhythmProfileRef.current.turnCount++;
    
    // Decay momentum back toward 1.0 slowly
    if (momentumRef.current > 1.0) momentumRef.current -= 0.05;
    if (momentumRef.current < 1.0) momentumRef.current += 0.05;
  }, []);

  const getPause = useCallback((ctx: ConversationalContext): PauseClassification => {
    const { currentSentence, nextSentence, isStreamingDone, queueSize = 1, emotionalState } = ctx;
    const text = currentSentence.trim();
    const punct = analyzePunctuation(text);

    // 1. Queue Protection (Highest Priority)
    // If the queue is empty and we are not done streaming, we must NOT pause, to avoid stalling.
    const isStarving = queueSize === 0 && !isStreamingDone;

    // 2. Base Classification & Interruption Probability
    let category: PauseCategory = "CONTINUE";
    let basePause = 50;
    let interruptionProbability = 0.1;

    // Semantic matching
    if (matchesAny(text, THINKING_PATTERNS)) {
      category = "THINKING";
      basePause = 300;
      interruptionProbability = 0.2;
    } else if (punct.trailingPunctuation === "question" && !matchesAny(text, RHETORICAL_PATTERNS)) {
      category = "INTERJECTION_WINDOW";
      basePause = 400;
      interruptionProbability = matchesAny(text, GENUINE_QUESTION_PATTERNS) ? 0.9 : 0.7;
    } else if (matchesAny(text, SOFT_INVITATION_PATTERNS)) {
      category = "INTERJECTION_WINDOW";
      basePause = 350;
      interruptionProbability = 0.8;
    } else if (isStreamingDone && !nextSentence) {
      category = "INTERJECTION_WINDOW";
      basePause = 400;
      interruptionProbability = 0.85; // End of turn
    } else if (matchesAny(text, EMPHASIS_PATTERNS)) {
      category = "EMPHASIS";
      basePause = 250;
      interruptionProbability = 0.3;
    } else if (matchesAny(text, TOPIC_TRANSITION_PATTERNS)) {
      category = "EMPHASIS";
      basePause = 200;
      interruptionProbability = 0.4;
    } else if (punct.trailingPunctuation === "ellipsis") {
      const isShort = text.split(/\s+/).length <= 6;
      category = isShort ? "THINKING" : "EMPHASIS";
      basePause = isShort ? 250 : 150;
    } else if (punct.trailingPunctuation === "exclamation") {
      category = "EMPHASIS";
      basePause = 100;
    } else if (punct.trailingPunctuation === "question" && matchesAny(text, RHETORICAL_PATTERNS)) {
      category = "CONTINUE";
      basePause = 100;
      interruptionProbability = 0.1;
    } else if (nextSentence && matchesAny(nextSentence, CONTINUATION_SIGNALS)) {
      category = "CONTINUE";
      basePause = 40;
    } else if (punct.trailingPunctuation === "comma") {
      category = "CONTINUE";
      basePause = 20;
    } else {
      category = "CONTINUE";
      basePause = 50;
    }

    // 3. Dynamic Calculation
    // finalPause = basePause * momentumFactor * emotionFactor * userRhythmFactor * interruptionFactor + microVariation
    
    const momentumFactor = 1.0 / Math.max(0.5, momentumRef.current); // high momentum -> shorter pause
    
    let emotionFactor = 1.0;
    if (emotionalState) {
      if (emotionalState.energy > 0.7) emotionFactor *= 0.8; // High energy -> faster
      if (emotionalState.tension > 0.6) emotionFactor *= 1.2; // High tension -> slower/reflective
      if (emotionalState.mode === "reflective") emotionFactor *= 1.3;
    }

    const userRhythmFactor = rhythmProfileRef.current.factor;
    
    // Interruption Factor based on probability
    let interruptionFactor = 1.0;
    if (interruptionProbability > 0.7) interruptionFactor = 1.4; // leave room
    else if (interruptionProbability < 0.3) interruptionFactor = 0.8; // close gap

    const microVariation = Math.random() * 40 - 20; // +/- 20ms jitter

    let finalPause = basePause * momentumFactor * emotionFactor * userRhythmFactor * interruptionFactor + microVariation;

    // 4. Apply Hard Limits
    if (category === "CONTINUE") finalPause = Math.min(finalPause, LIMITS.CONTINUATION_MAX);
    if (category === "EMPHASIS" || category === "THINKING") finalPause = Math.min(finalPause, LIMITS.REFLECTION_MAX);
    if (category === "INTERJECTION_WINDOW") finalPause = Math.min(finalPause, LIMITS.YIELD_MAX);

    // Floor at 10ms
    finalPause = Math.max(10, finalPause);

    // 5. Breathing Model
    // Replace long silent pauses with micro-breath behavior if it's a reflection/emphasis
    let isBreath = false;
    if (finalPause > 400 && (category === "THINKING" || category === "EMPHASIS")) {
      isBreath = true;
      finalPause = Math.min(finalPause, 200); // The breath itself serves as the pause, compress the actual silence
    }

    // Apply Queue Protection at the very end
    if (isStarving) {
      finalPause = Math.min(finalPause, 30); // Prioritize continuity over perfect timing
      isBreath = false;
    }

    const listenForInterruption = interruptionProbability > 0.6;

    if (listenForInterruption) {
      inInterjectionWindowRef.current = true;
      lastPauseStartRef.current = performance.now();
    } else {
      inInterjectionWindowRef.current = false;
    }

    return {
      category,
      durationMs: Math.round(finalPause),
      listenForInterruption,
      reason: `Base: ${basePause}, Prob: ${interruptionProbability.toFixed(2)}, Mom: ${momentumFactor.toFixed(2)}, Em: ${emotionFactor.toFixed(2)}, Ry: ${userRhythmFactor.toFixed(2)}${isStarving ? " [STARVING]" : ""}${isBreath ? " [BREATH]" : ""}`,
      isBreath
    };
  }, []);

  const isInInterjectionWindow = useCallback(() => inInterjectionWindowRef.current, []);

  return {
    getPause,
    userRespondedDuringWindow,
    resetForNewTurn,
    isInInterjectionWindow,
  };
}
