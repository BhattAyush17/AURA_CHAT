/**
 * AdaptiveAttentionLayer — Context relevance scoring and ConversationalStance determination.
 *
 * Sits between context assembly and response planning.
 * Provides:
 * 1. Relevance scoring for context items (memories, facts, history)
 * 2. ConversationalStance — a dynamic representation of how AURA should behave THIS turn
 *
 * IMPORTANT: Stance is NOT energy matching. The user's emotional/energy state is ONE signal,
 * not the output policy. Conversation purpose and emotional significance dominate.
 */

import type { ConversationContext } from "@/executive/ConversationContext";
import type { ConversationUnderstanding } from "@/executive/ConversationUnderstanding";
import type { Strategy } from "@/executive/ExecutionPlan";
import type { AtmosphereContext } from "@/executive/AtmosphereContext";

// ─── Atmosphere Relevance Assessment ─────────────────────────────────
// Environmental evidence is ENTERTAINED (never personality-mutating). Each
// dimension is scored by whether the user is actually asking about it; only
// high-scoring dimensions are injected, and a fully-irrelevant turn yields
// includeAtmosphere=false so nothing is appended to cognitive context.
export interface AtmosphereRelevanceDecision {
  includeAtmosphere: boolean;
  dimensions: {
    temporal: boolean;
    geography: boolean;
    weather: boolean;
    news: boolean;
  };
  scores: {
    temporal: number;
    geography: number;
    weather: number;
    news: number;
  };
  rationale: string[];
}

// ─── Conversational Stance ───────────────────────────────────────

export type ConversationalMode =
  | "casual"
  | "playful"
  | "serious"
  | "grounded"
  | "analytical"
  | "reflective"
  | "empathetic"
  | "curious"
  | "explanatory"
  | "concise"
  | "exploratory"
  | "supportive";

export interface ConversationalStance {
  mode: ConversationalMode;
  warmth: number; // 0-1: How warm/close the response feels
  playfulness: number; // 0-1: How playful/light the response is
  directness: number; // 0-1: How direct vs beat-around-the-bush
  depth: number; // 0-1: How deep/explorative vs surface-level
  initiative: number; // 0-1: How much AURA leads vs follows
  restraint: number; // 0-1: How restrained/measured vs expansive
  responsiveness: number; // 0-1: How responsive vs detached
}

export interface ContextRelevance {
  item: string;
  score: number;
  signals: {
    recency: number;
    topicMatch: number;
    emotionalRelevance: number;
    userExplicitReference: number;
    conversationUtility: number;
  };
}

export interface AttentionDecision {
  relevantContexts: ContextRelevance[];
  suppressedContexts: string[];
  stance: ConversationalStance;
  purpose: ConversationalPurpose;
  attentionRationale: string[];
}

// ─── Conversational Purpose ───────────────────────────────────────

export type ConversationalPurpose =
  | "information_seeking"
  | "problem_solving"
  | "casual_conversation"
  | "emotional_sharing"
  | "venting"
  | "reflection"
  | "celebration"
  | "joking"
  | "storytelling"
  | "planning"
  | "disagreement"
  | "curiosity"
  | "companionship"
  | "exploration"
  | "closure"
  | "transition";

// ─── Question Fatigue Tracker ───────────────────────────────────

interface TurnRecord {
  turnIndex: number;
  userCarried: boolean; // Did user introduce new content / ask questions
  auraAskedQuestion: boolean;
  auraResponseMode: ResponseMode;
  timestamp: number;
}

export type ResponseMode =
  | "question"
  | "answer"
  | "acknowledgement"
  | "reaction"
  | "reflection"
  | "closure";

export interface InitiativeMetrics {
  consecutiveQuestions: number;
  recentQuestionCount: number;
  userCarryingConversation: boolean;
  questionFatigue: number; // 0-1, higher = more fatigued
  lastUserRespondedToQuestion: boolean;
}

// ─── Signal Weights (tunable) ──────────────────────────────────

const WEIGHTS = {
  conversationPurpose: 0.35, // Dominates simple energy matching
  emotionalSignificance: 0.25,
  userVulnerability: 0.15,
  conversationalTrajectory: 0.1,
  interactionPattern: 0.08,
  userEnergy: 0.05, // ONE signal, not the policy
  historicalPreferences: 0.02,
};

const MODE_THRESHOLDS = {
  highVulnerability: 0.6,
  highTension: 0.7,
  highFrustration: 0.6,
  highEngagement: 0.6,
  longSilence: 8000,
  manyTurns: 15,
};

// ─── AdaptiveAttentionLayer ──────────────────────────────────────

export class AdaptiveAttentionLayer {
  private recentStances: ConversationalStance[] = [];
  private readonly maxHistory = 5;

  // Question fatigue tracking
  private turnHistory: TurnRecord[] = [];
  private readonly maxTurnHistory = 10;

  // Current purpose (recalculated each turn)
  private currentPurpose: ConversationalPurpose = "casual_conversation";

  /**
   * Score a context item's relevance for the current turn.
   */
  scoreContextRelevance(
    item: string,
    ctx: ConversationContext,
    u: ConversationUnderstanding,
    explicitReferences: string[] = [],
  ): ContextRelevance {
    const lowerItem = item.toLowerCase();
    const lowerInput = ctx.input.text.toLowerCase();

    // Recency: Already captured by memory retrieval tier (ephemeral vs durable)
    const recency = 0.5; // Neutral default; tier system handles this

    // Topic match: Does the item relate to current input?
    const inputWords = new Set(lowerInput.split(/\s+/).filter((w) => w.length > 3));
    const itemWords = new Set(lowerItem.split(/\s+/).filter((w) => w.length > 3));
    const overlap = [...inputWords].filter((w) => itemWords.has(w)).length;
    const topicMatch = inputWords.size > 0 ? Math.min(overlap / inputWords.size, 1) : 0;

    // Emotional relevance: Does the item relate to current emotional state?
    const emotionalKeywords = this.getEmotionalKeywords(ctx);
    const emotionalRelevance = emotionalKeywords.some((k) => lowerItem.includes(k)) ? 0.7 : 0.3;

    // User explicit reference: Did the user mention this specifically?
    const userExplicitReference = explicitReferences.some((ref) =>
      lowerItem.includes(ref.toLowerCase()),
    )
      ? 0.9
      : 0.3;

    // Conversation utility: Would using this item help the conversation?
    const conversationUtility = this.assessConversationUtility(
      item,
      ctx,
      u,
      topicMatch,
      emotionalRelevance,
    );

    // Weighted composite score
    const score =
      recency * 0.1 +
      topicMatch * 0.25 +
      emotionalRelevance * 0.25 +
      userExplicitReference * 0.2 +
      conversationUtility * 0.2;

    return {
      item,
      score: Math.round(score * 100) / 100,
      signals: {
        recency,
        topicMatch,
        emotionalRelevance,
        userExplicitReference,
        conversationUtility,
      },
    };
  }

  /**
   * Assess whether the surrounding world is relevant to this turn, purely as
   * environmental evidence. Returns per-dimension inclusion flags and a
   * top-level includeAtmosphere decision. This NEVER mutates stance, warmth,
   * playfulness, or personality — it only opens/withholds the atmosphere slot.
   */
  assessAtmosphere(
    userText: string,
    atmosphere: AtmosphereContext | null | undefined,
  ): AtmosphereRelevanceDecision {
    const text = userText.toLowerCase();

    // Relevance relies on availability + explicit/contextual user reference.
    const temporal = this.matchAtmosphereTemporal(text, atmosphere);
    const geography = this.matchAtmosphereGeography(text, atmosphere);
    const weather = this.matchAtmosphereWeather(text, atmosphere);
    const news = this.matchAtmosphereNews(text, atmosphere);

    const dims = { temporal, geography, weather, news };
    const anyRelevant = temporal || geography || weather || news;

    // When no atmosphere has been delivered yet (e.g. first turn of a session),
    // the per-dimension matchers can't fire because they are availability-gated.
    // Still flag the turn for atmosphere when the TEXT requests it, so the
    // backend is prompted to fetch & inject fresh context (serendipitous, low-
    // latency retrieval) instead of silently returning nothing.
    const textRequests = this.textRequestsAtmosphere(text);

    const rationale: string[] = [];
    if (!atmosphere) {
      rationale.push(
        textRequests
          ? "no atmosphere cached — turn requests world context, prompting fetch"
          : "no atmosphere context delivered",
      );
    } else {
      const active: string[] = [];
      if (temporal) active.push("time");
      if (geography) active.push("geography");
      if (weather) active.push("weather");
      if (news) active.push("news");
      rationale.push(
        active.length > 0
          ? `atmosphere relevant: ${active.join(", ")}`
          : "no atmospheric signal relevant to this turn — suppressed",
      );
    }

    return {
      includeAtmosphere: anyRelevant || textRequests,
      dimensions: dims,
      scores: {
        temporal: temporal ? 1 : 0,
        geography: geography ? 1 : 0,
        weather: weather ? 1 : 0,
        news: news ? 1 : 0,
      },
      rationale,
    };
  }

  /**
   * Binary "does this turn plausibly involve the surrounding world?" cue
   * detector, based on the TEXT alone. Used to prompt backend retrieval before
   * any atmosphere has been cached. Does not require availability.
   */
  private textRequestsAtmosphere(text: string): boolean {
    return /(what time|time is it|what day|what date|current time|is it (late|early|morning|afternoon|evening|night)|where am i|around me|near me|my location|what's here|what is here|nearby|where are we|what city|what region|my area|local|weather|temperature|forecast|rain|raining|snow|sunny|cloudy|hot|cold|outside|news|headlines|happening|current events|trending|what's new|whats new)/.test(
      text,
    );
  }

  // ── Atmosphere signal matchers (binary relevance, availability-gated) ──

  private matchAtmosphereTemporal(
    text: string,
    atmosphere: AtmosphereContext | null | undefined,
  ): boolean {
    if (!atmosphere?.temporal?.available) return false;
    // Explicit time/date questions, or temporal planning that benefits from
    // wall-clock grounding (e.g. "is it too late to...", "should I...").
    return (
      /\b(what time|time is it|what day|what date|current time|what's the time|time now|is it (late|early|morning|afternoon|evening|night))\b/.test(
        text,
      ) ||
      /\b(today|tomorrow|yesterday|tonight|tonight|this week|weekend|morning|afternoon|evening|now)\b/.test(
        text,
      )
    );
  }

  private matchAtmosphereGeography(
    text: string,
    atmosphere: AtmosphereContext | null | undefined,
  ): boolean {
    if (!atmosphere?.geography?.available) return false;
    // Geography is only surfaced when the user asks about their surroundings.
    return /(where am i|around me|near me|my location|what's here|what is here|nearby|what's around|close by|this place|where are we|what city|what region|my area|local)/.test(
      text,
    );
  }

  private matchAtmosphereWeather(
    text: string,
    atmosphere: AtmosphereContext | null | undefined,
  ): boolean {
    if (!atmosphere?.weather?.available) return false;
    return /(weather|temperature|forecast|rain|raining|snow|sunny|cloudy|hot|cold|humidity|go outside|outside|wind|should i go out|wear|jacket|umbrella|climate)/.test(
      text,
    );
  }

  private matchAtmosphereNews(
    text: string,
    atmosphere: AtmosphereContext | null | undefined,
  ): boolean {
    if (!atmosphere?.news?.available || atmosphere.news.resultCount === 0) return false;
    return /(news|headlines|happening|current events|latest|what's going on|whats going on|around the world|in the news|what's new|trending|update on)/.test(
      text,
    );
  }

  /**
   * Determine the ConversationalStance for this turn.
   *
   * Key principle: User's emotional/energy state is ONE signal, not the output policy.
   * Conversation purpose and emotional significance DOMINATE simple energy matching.
   */
  determineStance(
    ctx: ConversationContext,
    u: ConversationUnderstanding,
    strategy: Strategy,
  ): ConversationalStance {
    const emo = ctx.emotion;
    const timing = ctx.timing;
    const behavior = ctx.behaviorAnalysis;

    // Start with strategy-informed baseline
    let mode = this.strategyToMode(strategy);
    let warmth = 0.5;
    let playfulness = 0.3;
    let directness = 0.5;
    let depth = 0.5;
    let initiative = 0.5;
    let restraint = 0.5;
    let responsiveness = 0.7;

    // Signal 1: Conversation purpose DOMINATES energy matching
    // If user is sharing something emotional, warmth and presence matter most
    if (
      emo.vulnerability > MODE_THRESHOLDS.highVulnerability ||
      emo.tension > MODE_THRESHOLDS.highTension
    ) {
      mode = "empathetic";
      warmth = Math.min(warmth + 0.4, 1);
      playfulness = Math.max(playfulness - 0.3, 0);
      directness = Math.max(directness - 0.2, 0);
      depth = Math.min(depth + 0.1, 1);
      initiative = Math.min(initiative - 0.2, 1);
      responsiveness = Math.min(responsiveness + 0.2, 1);
    }

    // Signal 2: Emotional significance — not just vulnerability, but arc position
    if (emo.arc === "peak" && emo.energy > 0.6) {
      // User is at emotional peak — match with encouragement
      if (mode !== "empathetic") {
        mode = "supportive";
        warmth = Math.min(warmth + 0.25, 1);
        initiative = Math.min(initiative + 0.15, 1);
      }
    }

    // Signal 3: User vulnerability — but NOT as automatic mirroring
    // High vulnerability means AURA should be more restrained and warm, not "sad because user is sad"
    if (emo.vulnerability > MODE_THRESHOLDS.highVulnerability) {
      restraint = Math.min(restraint + 0.3, 1);
      warmth = Math.min(warmth + 0.2, 1);
      depth = Math.max(depth - 0.15, 0);
    }

    // Signal 4: Conversational trajectory
    if (timing.turnCount > MODE_THRESHOLDS.manyTurns && strategy !== "Summarize") {
      // Long conversation without summary — be more concise
      mode = "concise";
      restraint = Math.min(restraint + 0.2, 1);
      depth = Math.max(depth - 0.1, 0);
    }

    // Signal 5: Interaction pattern — does user prefer direct or exploratory?
    if (behavior?.playfulness !== undefined && behavior.playfulness > 0.6) {
      playfulness = Math.min(playfulness + 0.2, 1);
      mode = "playful";
    }

    // Signal 6: User's immediate emotional state — ONE signal, not the policy
    // This adjusts HOW we deliver the stance, not WHETHER we use it
    if (emo.energy > 0.7) {
      // User has high energy — don't dampen, but don't amplify either
      initiative = Math.min(initiative + 0.1, 1);
    } else if (emo.energy < 0.3) {
      // User has low energy — be more restrained, give them space
      initiative = Math.max(initiative - 0.2, 0);
      restraint = Math.min(restraint + 0.15, 1);
    }

    // Signal 7: Frustration — handle with more directness and less playfulness
    if (emo.frustration > MODE_THRESHOLDS.highFrustration) {
      mode = "grounded";
      playfulness = Math.max(playfulness - 0.3, 0);
      directness = Math.min(directness + 0.25, 1);
      responsiveness = Math.min(responsiveness + 0.15, 1);
    }

    // Signal 8: Long silence — user may need space or re-engagement
    if (timing.silenceDurationMs > MODE_THRESHOLDS.longSilence && timing.turnCount > 2) {
      initiative = Math.min(initiative + 0.2, 1);
      mode = "curious";
    }

    // Strategy refinement — precedence:
    //   1. Contextual/emotional state (set above) establishes the "why" of the response.
    //   2. Explicit conversational strategy (Comfort/Challenge/Reflect/Ask/Summarize)
    //      may override the mode when it is a stronger intent than the contextual baseline.
    //   3. The neutral default "Answer" never clobbers a contextual mode — it only
    //      adjusts delivery (numeric fields). This was the original bug: strategy="Answer"
    //      was unconditionally setting mode="explanatory" and destroying emotional
    //      empathy, groundedness, and concision that the contextual branches had set.
    switch (strategy) {
      case "Comfort":
        mode = "empathetic";
        warmth = Math.min(warmth + 0.3, 1);
        restraint = Math.min(restraint + 0.2, 1);
        break;
      case "Challenge":
        mode = "serious";
        directness = Math.min(directness + 0.3, 1);
        playfulness = Math.max(playfulness - 0.2, 0);
        break;
      case "Reflect":
        mode = "reflective";
        depth = Math.min(depth + 0.2, 1);
        initiative = Math.max(initiative - 0.1, 0);
        break;
      case "Ask":
        mode = "curious";
        initiative = Math.min(initiative + 0.15, 1);
        depth = Math.min(depth + 0.1, 1);
        break;
      case "Answer":
        // Only adjust delivery — preserve contextual mode (empathetic/grounded/etc.)
        directness = Math.min(directness + 0.2, 1);
        depth = Math.max(depth - 0.1, 0);
        break;
      case "Summarize":
        mode = "concise";
        depth = Math.max(depth - 0.2, 0);
        restraint = Math.min(restraint + 0.2, 1);
        break;
    }

    // Clamp all values
    const stance: ConversationalStance = {
      mode,
      warmth: this.clamp01(warmth),
      playfulness: this.clamp01(playfulness),
      directness: this.clamp01(directness),
      depth: this.clamp01(depth),
      initiative: this.clamp01(initiative),
      restraint: this.clamp01(restraint),
      responsiveness: this.clamp01(responsiveness),
    };

    // Track history for smoothing (optional, for future use)
    this.recentStances.push(stance);
    if (this.recentStances.length > this.maxHistory) {
      this.recentStances.shift();
    }

    return stance;
  }

  /**
   * Filter contexts by relevance threshold.
   */
  filterRelevantContexts(
    contexts: string[],
    ctx: ConversationContext,
    u: ConversationUnderstanding,
    threshold: number = 0.35,
  ): AttentionDecision {
    const rationale: string[] = [];
    const explicitRefs = this.extractExplicitReferences(ctx.input.text);

    const scored = contexts.map((item) => this.scoreContextRelevance(item, ctx, u, explicitRefs));

    const relevant = scored.filter((c) => c.score >= threshold);
    const suppressed = scored.filter((c) => c.score < threshold).map((c) => c.item);

    if (suppressed.length > 0) {
      rationale.push(`${suppressed.length} context(s) suppressed below threshold ${threshold}`);
    }

    const topRelevant = relevant.slice(0, 3);
    if (topRelevant.length > 0) {
      rationale.push(`top context score: ${topRelevant[0].score.toFixed(2)}`);
    }

    return {
      relevantContexts: relevant,
      suppressedContexts: suppressed,
      stance: this.determineStance(ctx, u, "Answer"),
      purpose: this.currentPurpose,
      attentionRationale: rationale,
    };
  }

  /**
   * Determine the ConversationalPurpose for this turn.
   * This is the PRIMARY driver - conversation purpose dominates response selection.
   */
  determinePurpose(ctx: ConversationContext, u: ConversationUnderstanding): ConversationalPurpose {
    const text = ctx.input.text.toLowerCase();
    const words = text.split(/\s+/).length;
    const emo = ctx.emotion;
    const behavior = ctx.behaviorAnalysis;

    // Story sharing: user is telling a story, not asking
    if (
      behavior?.tags?.some((t) => ["sharing", "confession", "story"].includes(t)) &&
      !u.raw.isQuestion &&
      words > 15
    ) {
      this.currentPurpose = "storytelling";
      return this.currentPurpose;
    }

    // Emotional sharing: user is processing feelings
    if (emo.vulnerability > 0.5 || emo.tension > 0.6) {
      if (emo.arc === "peak" && emo.energy > 0.6) {
        this.currentPurpose = "celebration";
      } else if (emo.frustration > 0.4) {
        this.currentPurpose = "venting";
      } else {
        this.currentPurpose = "emotional_sharing";
      }
      return this.currentPurpose;
    }

    // Information seeking: user asks a direct question
    if (u.raw.isQuestion || u.literal === "question" || u.literal === "request") {
      if (words < 10 && !u.raw.isQuestion) {
        this.currentPurpose = "curiosity";
      } else {
        this.currentPurpose = "information_seeking";
      }
      return this.currentPurpose;
    }

    // Problem solving: user describes a problem
    if (
      behavior?.tags?.some((t) => ["problem", "issue", "help"].includes(t)) ||
      text.includes("how to") ||
      text.includes("why is") ||
      text.includes("how do i")
    ) {
      this.currentPurpose = "problem_solving";
      return this.currentPurpose;
    }

    // Planning: user is thinking about future
    if (
      text.includes("should i") ||
      text.includes("going to") ||
      text.includes("plan") ||
      text.includes("want to") ||
      text.includes("need to")
    ) {
      this.currentPurpose = "planning";
      return this.currentPurpose;
    }

    // Disagreement: user expresses disagreement
    if (u.state === "conflict" || u.speakerGoal === "debate") {
      this.currentPurpose = "disagreement";
      return this.currentPurpose;
    }

    // Celebration: user shares good news
    if (emo.arc === "peak" && emo.energy > 0.6 && words < 30) {
      this.currentPurpose = "celebration";
      return this.currentPurpose;
    }

    // Joking: user is being playful
    if (behavior?.playfulness !== undefined && behavior.playfulness > 0.6) {
      this.currentPurpose = "joking";
      return this.currentPurpose;
    }

    // Short response after established conversation = closure or acknowledgement
    if (words <= 5 && ctx.timing.turnCount > 3) {
      this.currentPurpose = "closure";
      return this.currentPurpose;
    }

    // Default
    this.currentPurpose = "casual_conversation";
    return this.currentPurpose;
  }

  /**
   * Record a turn outcome for question fatigue tracking.
   */
  recordTurn(outcome: {
    userCarried: boolean;
    auraAskedQuestion: boolean;
    auraResponseMode: ResponseMode;
  }): void {
    const record: TurnRecord = {
      turnIndex: this.turnHistory.length,
      userCarried: outcome.userCarried,
      auraAskedQuestion: outcome.auraAskedQuestion,
      auraResponseMode: outcome.auraResponseMode,
      timestamp: Date.now(),
    };

    this.turnHistory.push(record);
    if (this.turnHistory.length > this.maxTurnHistory) {
      this.turnHistory.shift();
    }
  }

  /**
   * Get current initiative metrics including question fatigue.
   */
  getInitiativeMetrics(): InitiativeMetrics {
    const recent = this.turnHistory.slice(-5);
    const recentQuestions = recent.filter((t) => t.auraAskedQuestion).length;
    const consecutiveQuestions = this.getConsecutiveQuestionCount();
    const userCarryingConversation = this.isUserCarryingConversation();

    // Calculate question fatigue: based on recent question frequency and user response patterns
    const recentQuestionRatio = recent.length > 0 ? recentQuestions / recent.length : 0;
    const userRespondedToQuestion = recent.length > 0 && recent[recent.length - 1].userCarried;

    // Fatigue increases with consecutive questions and if user isn't responding to them
    const questionFatigue =
      Math.min(consecutiveQuestions * 0.2, 0.8) +
      recentQuestionRatio * 0.2 +
      (userRespondedToQuestion ? 0 : 0.2);

    return {
      consecutiveQuestions,
      recentQuestionCount: recentQuestions,
      userCarryingConversation,
      questionFatigue: this.clamp01(questionFatigue),
      lastUserRespondedToQuestion: userRespondedToQuestion,
    };
  }

  /**
   * Detect if the user is carrying the conversation (introducing topics, asking questions, etc.)
   */
  isUserCarryingConversation(): boolean {
    const recent = this.turnHistory.slice(-3);
    if (recent.length === 0) return false;

    // User is carrying if they're introducing new content or asking questions
    const userCarryingCount = recent.filter((t) => t.userCarried).length;
    return userCarryingCount >= recent.length * 0.6;
  }

  /**
   * Get current purpose (for external access).
   */
  getCurrentPurpose(): ConversationalPurpose {
    return this.currentPurpose;
  }

  /**
   * Get current stance (for external access).
   */
  getCurrentStance(): ConversationalStance | null {
    return this.recentStances.length > 0 ? this.recentStances[this.recentStances.length - 1] : null;
  }

  /**
   * Serialize the current attention state (purpose + stance) into a compact
   * cognitive-context block for the LLM. Returns "" when no stance has been
   * computed yet this turn (byte-identical to the pre-wiring path).
   *
   * Block format (compact, key=value, one field per line):
   *
   *   [ADAPTIVE ATTENTION]
   *   purpose: emotional_sharing
   *   mode: empathetic
   *   warmth: 0.92
   *   initiative: 0.30
   *   restraint: 0.80
   *   directness: 0.50
   *   playfulness: 0.05
   *   depth: 0.60
   *   responsiveness: 0.90
   *   [/ADAPTIVE ATTENTION]
   */
  formatForPrompt(): string {
    const stance = this.getCurrentStance();
    if (!stance) return "";
    const lines: string[] = ["[ADAPTIVE ATTENTION]"];
    lines.push(`purpose: ${this.currentPurpose}`);
    lines.push(`mode: ${stance.mode}`);
    lines.push(`warmth: ${stance.warmth.toFixed(2)}`);
    lines.push(`initiative: ${stance.initiative.toFixed(2)}`);
    lines.push(`restraint: ${stance.restraint.toFixed(2)}`);
    lines.push(`directness: ${stance.directness.toFixed(2)}`);
    lines.push(`playfulness: ${stance.playfulness.toFixed(2)}`);
    lines.push(`depth: ${stance.depth.toFixed(2)}`);
    lines.push(`responsiveness: ${stance.responsiveness.toFixed(2)}`);
    lines.push("[/ADAPTIVE ATTENTION]");
    return lines.join("\n");
  }

  /**
   * Detect whether a finalized AURA response contains a genuine question.
   *
   * Robust to streaming artifacts, multi-sentence responses, and formatting
   * (markdown, trailing whitespace, bullet points). Looks at the last
   * non-empty substantive line and returns true when it ends with "?" or
   * matches a leading question cue ("why", "how", "what", etc.).
   */
  detectQuestion(responseText: string): boolean {
    if (!responseText) return false;
    // Strip markdown formatting and trailing whitespace per line
    const lines = responseText
      .split(/\n+/)
      .map((l) => l.replace(/^[\s*\-•>]+/, "").trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return false;
    const last = lines[lines.length - 1];
    if (last.endsWith("?") || last.endsWith("？")) return true;
    // Lead-question patterns: "Why don't we...", "What if...", "How about..."
    return /^(why|how|what|when|where|who|which|do you|can you|could you|would you|should we|shall we|did you|have you|aren't you|isn't it|don't you|won't you)\b/i.test(
      last,
    );
  }

  /**
   * Detect whether a user turn carries the conversation — i.e. the user
   * introduced new substantive content, asked a question, or shared a long
   * message. Derived from text features only (no second semantic classifier).
   */
  detectUserCarrying(userText: string): boolean {
    if (!userText) return false;
    const trimmed = userText.trim();
    if (trimmed.length === 0) return false;
    const words = trimmed.split(/\s+/).length;
    if (words >= 8) return true; // substantive message
    if (/\?/.test(trimmed)) return true; // asked a question
    return false;
  }

  // ─── Private Helpers ───────────────────────────────────────────

  private getConsecutiveQuestionCount(): number {
    let count = 0;
    for (let i = this.turnHistory.length - 1; i >= 0; i--) {
      if (this.turnHistory[i].auraAskedQuestion) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  private strategyToMode(strategy: Strategy): ConversationalMode {
    const map: Record<Strategy, ConversationalMode> = {
      Answer: "explanatory",
      Ask: "curious",
      Clarify: "curious",
      Comfort: "empathetic",
      Encourage: "supportive",
      Challenge: "serious",
      Observe: "grounded",
      Reflect: "reflective",
      Redirect: "casual",
      Summarize: "concise",
      Listen: "curious",
    };
    return map[strategy] ?? "casual";
  }

  private getEmotionalKeywords(ctx: ConversationContext): string[] {
    const emo = ctx.emotion;
    const keywords: string[] = [];

    if (emo.vulnerability > 0.5) keywords.push("feel", "felt", "feeling", "sad", "hurt", "alone");
    if (emo.tension > 0.5) keywords.push("stress", "stress", "anxious", "worried", "nervous");
    if (emo.frustration > 0.5) keywords.push("frustrat", "annoy", "angry", "mad");
    if (emo.arc === "peak") keywords.push("love", "amazing", "great", "happy", "excited");

    return keywords;
  }

  private extractExplicitReferences(text: string): string[] {
    // Extract quoted phrases and named entities as explicit references
    const quotes = text.match(/"([^"]+)"/g)?.map((q) => q.slice(1, -1)) ?? [];
    const pronouns = ["it", "that", "this", "he", "she", "they"];
    return quotes.filter((q) => q.length > 2 && !pronouns.includes(q.toLowerCase()));
  }

  private assessConversationUtility(
    item: string,
    ctx: ConversationContext,
    u: ConversationUnderstanding,
    topicMatch: number,
    emotionalRelevance: number,
  ): number {
    // High utility if: high topic match OR (moderate topic match AND emotional relevance)
    if (topicMatch > 0.5) return 0.8;
    if (topicMatch > 0.2 && emotionalRelevance > 0.5) return 0.6;
    if (ctx.memory.hasPersonalHistory && topicMatch > 0.2) return 0.5;
    return 0.3;
  }

  private clamp01(val: number): number {
    return Math.max(0, Math.min(1, val));
  }
}

// ─── Singleton ───────────────────────────────────────────────────

let attentionLayerInstance: AdaptiveAttentionLayer | null = null;

export function getAdaptiveAttentionLayer(): AdaptiveAttentionLayer {
  if (!attentionLayerInstance) {
    attentionLayerInstance = new AdaptiveAttentionLayer();
  }
  return attentionLayerInstance;
}
