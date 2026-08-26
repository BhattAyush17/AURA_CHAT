/**
 * StrategyPlanner — answers one question:
 * "What kind of interaction should happen next?"
 *
 * Phase 11: the planner consumes the canonical ConversationUnderstanding.
 * It performs NO interpretation of its own — no detectors, no pattern
 * matching. Every signal arrives pre-interpreted from understand().
 *
 * Deterministic scoring over the 11 available strategies.
 * Exactly one primary strategy is selected; a secondary may be added
 * when a follow-on move is natural.
 *
 * The LLM no longer decides this implicitly.
 */

import type { ConversationContext } from "./ConversationContext";
import type { ConversationUnderstanding } from "./ConversationUnderstanding";
import { allInfluences, type SocialUnderstanding, type SocialInfluence } from "./SocialWorldModel";
import type { Strategy } from "./ExecutionPlan";

export const STRATEGIES: readonly Strategy[] = [
  "Answer",
  "Ask",
  "Clarify",
  "Comfort",
  "Encourage",
  "Challenge",
  "Observe",
  "Reflect",
  "Redirect",
  "Summarize",
  "Listen",
];

export interface StrategySelection {
  primary: Strategy;
  secondary: Strategy | null;
  scores: Record<Strategy, number>;
  reasons: string[];
}

const MIN_SCORE = 0.15; // Below this, a strategy is not a candidate
const SECONDARY_GAP = 1.2; // Secondary must not rival the primary

export class StrategyPlanner {
  plan(
    ctx: ConversationContext,
    u: ConversationUnderstanding,
    social?: SocialUnderstanding,
  ): StrategySelection {
    const scores: Record<Strategy, number> = {
      Answer: 0,
      Ask: 0,
      Clarify: 0,
      Comfort: 0,
      Encourage: 0,
      Challenge: 0,
      Observe: 0,
      Reflect: 0,
      Redirect: 0,
      Summarize: 0,
      Listen: 0,
    };
    const reasons: string[] = [];

    const stt = u.context.sttConfidence;
    const emo = ctx.emotion;
    const behavior = ctx.behaviorAnalysis;
    const text = ctx.input.text.trim();
    const wordCount = u.context.wordCount;

    // ── Gate 0: social microunits — greetings & farewells ──────────
    if (u.literal === "goodbye") {
      scores.Redirect += 6;
      scores.Comfort += 2;
      reasons.push("explicit farewell signal");
      return this.finish(scores, reasons);
    }
    if (u.literal === "greeting") {
      scores.Answer += 6;
      scores.Observe += 2;
      reasons.push("explicit greeting");
      return this.finish(scores, reasons);
    }

    // ── Gate 1: STT degraded → never guess, always clarify ──────────
    if (stt < 0.45) {
      scores.Clarify += 10;
      reasons.push(`STT confidence ${stt.toFixed(2)} < 0.45`);
      return this.finish(scores, reasons);
    }

    // ── Gate 1.2: rejection / repair — the user corrects AURA's read ─
    // Runs BEFORE the vulnerability gate: a rejection is not fragility.
    if (u.move === "Repair") {
      scores.Clarify += 5;
      scores.Reflect += 3;
      scores.Ask += 1;
      reasons.push("rejection/repair signal — re-orient before continuing");
      return this.finish(scores, reasons);
    }

    // ── Gate 1.3: thinking pause — the user holds the floor ──────────
    if (u.literal === "thinking") {
      scores.Listen += 5;
      scores.Observe += 2;
      reasons.push("thinking pause — yield the floor, no push");
      return this.finish(scores, reasons);
    }

    // ── Gate 1.4: retraction — let it go gently ──────────────────────
    if (u.literal === "retraction") {
      scores.Listen += 3;
      scores.Observe += 2;
      reasons.push("retraction — drop the thread softly");
      return this.finish(scores, reasons);
    }

    // ── Gate 1.4b: self-correction — re-anchor, don't challenge ─────
    if (u.literal === "correction") {
      scores.Reflect += 3;
      scores.Listen += 2;
      reasons.push("self-correction — re-anchor with the new meaning");
      return this.finish(scores, reasons);
    }

    // ── Gate 1.4c: trailing off — presence, not Comfort, not answers ─
    if (u.literal === "trailing") {
      scores.Listen += 3;
      scores.Observe += 2;
      scores.Comfort -= 2;
      reasons.push("trailing off — a half-thought is not a distress signal");
      return this.finish(scores, reasons);
    }

    // ── Gate 1.5: backchannels are continuations, not ambiguities ───
    if (u.literal === "backchannel") {
      if (u.context.silenceMs > 8000) {
        scores.Ask += 4;
        scores.Observe += 2;
        reasons.push("backchannel after long silence → re-engage");
      } else if (u.raw.isQuestion) {
        // Minimal prompt ("Hmm?") — invite them to continue, don't answer.
        scores.Ask += 3;
        scores.Listen += 1;
        reasons.push("minimal prompt — invite them to continue");
      } else {
        scores.Observe += 3;
        scores.Listen += 2;
        reasons.push("backchannel — continuation, no clarification needed");
      }
      return this.finish(scores, reasons);
    }

    // ── Gate 1.6: irony — probe, never take it at face value ────────
    const ironic = u.social.some((s) => s.name === "irony" || s.name === "sarcasm");
    if (ironic) {
      scores.Ask += 4;
      scores.Reflect += 2;
      scores.Answer -= 2;
      scores.Comfort -= 2;
      reasons.push("irony detected — probe, do not agree or comfort");
    }

    // ── Gate 2: user is speaking from a heavy emotional place ────────
    if (emo.vulnerability > 0.6 || emo.tension > 0.7) {
      scores.Comfort += 5;
      reasons.push(
        `vulnerability=${emo.vulnerability.toFixed(2)} tension=${emo.tension.toFixed(2)}`,
      );
    } else if (emo.vulnerability > 0.35) {
      scores.Comfort += 2;
      reasons.push("moderate vulnerability");
    }

    if (emo.frustration > 0.6) {
      if (stt < 0.6 || wordCount < 3) {
        scores.Clarify += 4;
        reasons.push("high frustration + weak input → clarify before acting");
      } else {
        scores.Answer += 3;
        reasons.push("high frustration → resolve the problem fast");
      }
    }

    // ── Gate 3: ambiguous or under-specified input ──────────────────
    // Banter is never ambiguity: playful/sarcastic/excited/polite turns
    // and short answers to an open question must not demand clarification.
    if (stt < 0.6 && stt >= 0.45) {
      scores.Clarify += 3;
      reasons.push(`STT confidence ${stt.toFixed(2)} in gray zone`);
    }
    const banterish = u.social.some((s) =>
      ["playfulness", "sarcasm", "excitement", "politeness"].includes(s.name),
    );
    const socialAct = behavior?.act;
    if (
      wordCount <= 2 &&
      !u.raw.isQuestion &&
      !banterish &&
      !["tease", "insult", "thanks", "reaction", "exclamation", "backchannel"].includes(
        socialAct ?? "",
      ) &&
      !u.shared.openQuestion
    ) {
      scores.Clarify += 2;
      reasons.push("very short input");
    }

    // ── Gate 4: does the user need an answer? ───────────────────────
    if (u.literal === "question" || u.literal === "request") {
      scores.Answer += 4;
      reasons.push(`user ${u.literal === "question" ? "asked a question" : "made a request"}`);
    }
    if (behavior?.act === "request" || behavior?.act === "command") {
      scores.Answer += 3;
      reasons.push(`behavior act=${behavior.act}`);
    }

    // ── Gate 5: shared experiences need presence, not solutions ─────
    if (behavior?.tags?.some((t) => ["sharing", "confession", "story", "feeling"].includes(t))) {
      scores.Reflect += 3;
      scores.Listen += 2;
      reasons.push("user is sharing, not asking");
    }
    if (emo.arc === "peak" && emo.energy > 0.6) {
      scores.Encourage += 2;
      scores.Reflect += 1;
      reasons.push("emotional peak with high energy");
    }

    // ── Gate 6: challenge is earned, never default ──────────────────
    // Phase 11: disagreement is conversation meaning — it comes from the
    // canonical understanding, never re-derived from raw behavior here.
    if (u.speakerGoal === "debate" || u.state === "conflict") {
      scores.Challenge += 3;
      reasons.push("disagreement/conflict detected by understanding layer");
    }

    // ── Gate 7: conversational drift → re-engage ────────────────────
    const longSilence = u.context.silenceMs > 8000;
    if (longSilence && u.context.turnCount > 2) {
      scores.Ask += 3;
      reasons.push("long silence after established conversation");
    }
    if (behavior?.tags?.includes("farewell")) {
      scores.Redirect += 2;
      reasons.push("farewell signal → gentle close/redirect");
    }

    // ── Gate 8: long threads deserve consolidation — but only when the
    // user EXPLICITLY re-anchors ("So anyway, back to what we were
    // discussing"). Continuous casual conversation must never be
    // summarized mid-banter; turn count alone is not a topic signal.
    if (u.state === "topic-shift" && u.context.turnCount > 10) {
      scores.Summarize += 3;
      reasons.push("explicit topic-shift after a long thread");
    }

    // ── Gate 9: identity mode steers expression, not strategy ───────
    if (ctx.identity.mode === "philosophical" && scores.Answer > 0) {
      scores.Reflect += 1.5;
      reasons.push("philosophical mode favors reflection");
    }

    // ── Gate 10: social evidence — what human forces are probably live? ──
    // Phase 12: the Social World Model never decides. It hands the
    // Executive probable influences; this gate turns the TOP influences
    // into score evidence. Additive only — conversation gates above
    // always win, and a repair is never re-read as fragility.
    if (social) {
      const top = allInfluences(social).slice(0, 3);
      for (const inf of top) applySocialEvidence(inf, scores, reasons);
    }

    // ── Final selection ─────────────────────────────────────────────
    const ranked = (Object.entries(scores) as [Strategy, number][]).sort((a, b) => b[1] - a[1]);
    let primary = ranked[0][0];

    let secondary: Strategy | null = null;
    if (ranked[0][1] >= MIN_SCORE && ranked.length > 1 && ranked[1][1] >= MIN_SCORE) {
      const [alt, altScore] = ranked[1];
      if (primary !== alt && altScore >= ranked[0][1] - SECONDARY_GAP) {
        secondary = alt;
      }
    }

    // Hard floor: never answer with zero evidence — observe instead.
    if (ranked[0][1] < MIN_SCORE && text.length > 0) {
      primary = "Observe";
      secondary = null;
      reasons.push("no strong signal → observe");
    }

    return this.finish(scores, reasons, primary, secondary);
  }

  private finish(
    scores: Record<Strategy, number>,
    reasons: string[],
    primary?: Strategy,
    secondary?: Strategy | null,
  ): StrategySelection {
    const ranked = (Object.entries(scores) as [Strategy, number][]).sort((a, b) => b[1] - a[1]);
    return {
      primary: primary ?? ranked[0][0],
      secondary: secondary === undefined ? null : secondary,
      scores: Object.freeze({ ...scores }),
      reasons,
    };
  }
}

// ─── Social evidence → strategy scores ────────────────────────────────
// The SWM provides influence names; the Executive maps them to strategy
// evidence. This table is the Executive's judgment, not the SWM's.

const SOCIAL_EVIDENCE: Record<string, { boost: [Strategy, number][]; line: string }> = {
  "imposter-syndrome": {
    boost: [
      ["Encourage", 4],
      ["Reflect", 2],
      ["Ask", 1],
    ],
    line: "imposter-syndrome — support before facts",
  },
  burnout: {
    boost: [
      ["Comfort", 4],
      ["Reflect", 2],
    ],
    line: "burnout — depleted, comfort before solutions",
  },
  loneliness: {
    boost: [
      ["Comfort", 4],
      ["Ask", 2],
    ],
    line: "loneliness — presence and gentle invitation",
  },
  "grief-lingering": {
    boost: [
      ["Comfort", 4],
      ["Reflect", 2],
    ],
    line: "unresolved grief — witness before advise",
  },
  "grief-life-stage": {
    boost: [
      ["Comfort", 3],
      ["Reflect", 2],
    ],
    line: "grief is part of this life stage — comfort, don't advise",
  },
  "attachment-loss": {
    boost: [
      ["Comfort", 4],
      ["Reflect", 2],
    ],
    line: "recent loss — comfort and presence",
  },
  "generational-conflict": {
    boost: [
      ["Comfort", 3],
      ["Ask", 2],
      ["Reflect", 1],
    ],
    line: "generational conflict — validate, then explore",
  },
  "family-expectations": {
    boost: [
      ["Comfort", 2],
      ["Ask", 2],
    ],
    line: "family expectations pressing — explore the cost",
  },
  "trust-break": {
    boost: [
      ["Reflect", 3],
      ["Listen", 1],
    ],
    line: "broken trust — reflect, do not rush repair",
  },
  "trust-building": {
    boost: [
      ["Reflect", 2],
      ["Listen", 2],
    ],
    line: "trust being built — match the disclosure, don't exceed it",
  },
  "financial-stress": {
    boost: [
      ["Comfort", 2],
      ["Answer", 1],
    ],
    line: "financial stress — steady, practical, not dismissive",
  },
  "career-transition": {
    boost: [
      ["Encourage", 2],
      ["Ask", 2],
    ],
    line: "career transition — encourage the step, explore the plan",
  },
  "need-achievement": { boost: [["Encourage", 3]], line: "achievement moment — celebrate it" },
  "need-purpose": {
    boost: [
      ["Reflect", 3],
      ["Ask", 2],
    ],
    line: "purpose question — sit in it, then walk it",
  },
  "need-identity": {
    boost: [
      ["Reflect", 3],
      ["Listen", 2],
    ],
    line: "identity work — listen, don't define them",
  },
  "identity-crisis": {
    boost: [
      ["Reflect", 3],
      ["Listen", 2],
    ],
    line: "identity crisis — presence, no prescriptions",
  },
  perfectionism: {
    boost: [
      ["Encourage", 2],
      ["Comfort", 1],
    ],
    line: "perfectionism — loosen the zero-defect frame",
  },
  reconciliation: {
    boost: [
      ["Reflect", 2],
      ["Listen", 2],
    ],
    line: "reconciliation in motion — keep the door open",
  },
  "apology-opening": {
    boost: [
      ["Encourage", 3],
      ["Reflect", 1],
    ],
    line: "apology being considered — support the courage",
  },
  "apology-motive": {
    boost: [
      ["Encourage", 2],
      ["Reflect", 1],
    ],
    line: "guilt driving repair — support the amends",
  },
  "courage-moment": { boost: [["Encourage", 3]], line: "fear plus action — cheer the leap" },
  "trust-rebuilding": {
    boost: [
      ["Encourage", 3],
      ["Reflect", 1],
    ],
    line: "trust being rebuilt — support the second chance",
  },
  "recovery-transition": {
    boost: [
      ["Encourage", 3],
      ["Reflect", 1],
    ],
    line: "recovery in motion — mark the progress",
  },
  procrastination: {
    boost: [["Ask", 2]],
    line: "procrastination — probe the fear under the delay",
  },
  avoidance: {
    boost: [
      ["Ask", 2],
      ["Reflect", 1],
    ],
    line: "avoidance — approach gently",
  },
  "conflict-escalation": {
    boost: [
      ["Reflect", 2],
      ["Listen", 1],
    ],
    line: "escalating conflict — de-escalate with reflection",
  },
  "relationship-breakdown": {
    boost: [
      ["Comfort", 2],
      ["Reflect", 2],
    ],
    line: "relationship breakdown — comfort, then clarify the path",
  },
  "fear-of-rejection": {
    boost: [
      ["Encourage", 3],
      ["Comfort", 1],
    ],
    line: "fear of rejection — encourage the attempt",
  },
  "need-rest": {
    boost: [
      ["Listen", 2],
      ["Observe", 1],
    ],
    line: "depleted — hold space instead of loading more",
  },
  "social-comparison": {
    boost: [
      ["Reflect", 2],
      ["Comfort", 1],
    ],
    line: "social comparison — re-anchor on their own path",
  },
  "need-recognition": {
    boost: [
      ["Reflect", 2],
      ["Comfort", 1],
    ],
    line: "unrecognized work — name the effort",
  },
  "validation-seeking": {
    boost: [
      ["Encourage", 2],
      ["Reflect", 1],
    ],
    line: "validation-seeking — affirm, then steady",
  },
  "need-competence": {
    boost: [["Encourage", 3]],
    line: "competence doubt — evidence of their capability",
  },
  "need-security": {
    boost: [
      ["Comfort", 3],
      ["Answer", 1],
    ],
    line: "security fear — steady and concrete",
  },
  "need-belonging": {
    boost: [
      ["Comfort", 3],
      ["Ask", 1],
    ],
    line: "belonging need — include, invite",
  },
  "need-connection": {
    boost: [
      ["Comfort", 2],
      ["Ask", 1],
    ],
    line: "connection need — meet the reach",
  },
  "boundary-opportunity": {
    boost: [
      ["Reflect", 2],
      ["Listen", 1],
    ],
    line: "boundary being drawn — respect it, don't push",
  },
  "boundary-setting": {
    boost: [
      ["Reflect", 2],
      ["Listen", 2],
    ],
    line: "boundary set — hold the line gently",
  },
};

function applySocialEvidence(
  inf: SocialInfluence,
  scores: Record<Strategy, number>,
  reasons: string[],
): void {
  const rule = SOCIAL_EVIDENCE[inf.name];
  if (!rule) return;
  for (const [s, w] of rule.boost) scores[s] += w;
  reasons.push(`social evidence: ${rule.line} (conf ${inf.confidence.toFixed(2)})`);
}
