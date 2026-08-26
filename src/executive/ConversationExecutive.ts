/**
 * ConversationExecutive — the single owner of conversational decision-making.
 *
 * Sits between Perception and Prompt Construction.
 * Consumes subsystem snapshots (ConversationContext), produces the
 * canonical ExecutionPlan. It never recalculates what a subsystem
 * already decided — it consumes those decisions.
 *
 * Executive Loop target: < 50ms.
 */

import { ClarificationPolicy } from "./ClarificationPolicy";
import { ConfidenceManager } from "./ConfidenceManager";
import type { ConversationContext } from "./ConversationContext";
import { understand, type ConversationUnderstanding } from "./ConversationUnderstanding";
import {
  buildExecutionPlan,
  type ClarificationDecision,
  type Confidence,
  type ExecutionPlan,
  type InformationBudget,
  type Initiative,
  type MemoryPolicy,
  type SpeechBehavior,
  type Strategy,
  type ThinkingBehavior,
  type Tone,
} from "./ExecutionPlan";
import { InformationBudgetEngine, BUDGET_WORDS } from "./InformationBudget";
import { InitiativePolicy } from "./InitiativePolicy";
import {
  LanguageMomentumEngine,
  languagePromptDirective,
  type LanguageState,
} from "./LanguageState";
import {
  RegisterMomentumEngine,
  determineRelationshipStage,
  registerPromptDirective,
  relationshipPromptDirective,
  type RelationshipStage,
} from "./RegisterState";
import { MemoryPolicyEngine } from "./MemoryPolicy";
import { ObservableThinking } from "./ObservableThinking";
import { ReflectionEngine } from "./ReflectionEngine";
import { SpeechBehaviorPlanner } from "./SpeechBehaviorPlanner";
import { StrategyPlanner, type StrategySelection } from "./StrategyPlanner";
import {
  deriveSocialUnderstanding,
  allInfluences,
  type SocialUnderstanding,
} from "./SocialWorldModel";
import { clamp01 } from "./util";

export interface ExecutiveDependencies {
  strategyPlanner?: StrategyPlanner;
  clarificationPolicy?: ClarificationPolicy;
  memoryPolicy?: MemoryPolicyEngine;
  informationBudget?: InformationBudgetEngine;
  initiativePolicy?: InitiativePolicy;
  speechBehaviorPlanner?: SpeechBehaviorPlanner;
  confidenceManager?: ConfidenceManager;
  observableThinking?: ObservableThinking;
  languageMomentum?: LanguageMomentumEngine;
  registerMomentum?: RegisterMomentumEngine;
}

export class ConversationExecutive {
  private readonly strategyPlanner: StrategyPlanner;
  private readonly clarificationPolicy: ClarificationPolicy;
  private readonly memoryPolicy: MemoryPolicyEngine;
  private readonly informationBudget: InformationBudgetEngine;
  private readonly initiativePolicy: InitiativePolicy;
  private readonly speechBehaviorPlanner: SpeechBehaviorPlanner;
  private readonly confidenceManager: ConfidenceManager;
  private readonly observableThinking: ObservableThinking;
  private readonly languageMomentum: LanguageMomentumEngine;
  private readonly registerMomentum: RegisterMomentumEngine;
  readonly reflection = new ReflectionEngine();

  constructor(deps: ExecutiveDependencies = {}) {
    this.strategyPlanner = deps.strategyPlanner ?? new StrategyPlanner();
    this.clarificationPolicy = deps.clarificationPolicy ?? new ClarificationPolicy();
    this.memoryPolicy = deps.memoryPolicy ?? new MemoryPolicyEngine();
    this.informationBudget = deps.informationBudget ?? new InformationBudgetEngine();
    this.initiativePolicy = deps.initiativePolicy ?? new InitiativePolicy();
    this.speechBehaviorPlanner = deps.speechBehaviorPlanner ?? new SpeechBehaviorPlanner();
    this.confidenceManager = deps.confidenceManager ?? new ConfidenceManager();
    this.observableThinking = deps.observableThinking ?? new ObservableThinking();
    this.languageMomentum = deps.languageMomentum ?? new LanguageMomentumEngine();
    this.registerMomentum = deps.registerMomentum ?? new RegisterMomentumEngine();
  }

  /**
   * Phase 8: feed one user turn to the language engine. The Executive
   * owns the canonical conversation register; the LLM only realizes it.
   */
  observeLanguage(text: string, turn: number) {
    return this.languageMomentum.observe(text, turn);
  }

  /** Current canonical register (Executive-owned). */
  getLanguageState(): LanguageState {
    return this.languageMomentum.getLanguageState();
  }

  /** New session — the first meaningful message re-establishes language. */
  resetLanguage(): void {
    this.languageMomentum.reset();
  }

  /**
   * Phase 8.1: feed one user turn to the register engine. Register is
   * detected deterministically (never by the LLM) and gated by the
   * relationship stage so intimacy must be earned, not borrowed.
   */
  observeRegister(text: string, turn: number, relationship: RelationshipStage) {
    return this.registerMomentum.observe(text, turn, relationship);
  }

  /** Current canonical register (Executive-owned). */
  getRegisterState() {
    return this.registerMomentum.getRegisterState();
  }

  /** New session — register and relationship re-establish from scratch. */
  resetRegister(): void {
    this.registerMomentum.reset();
  }

  plan(ctx: ConversationContext): Readonly<ExecutionPlan> {
    const start = performance.now();
    const rationale: string[] = [];

    // Phase 11: ONE canonical interpretation per turn. Everything below
    // consumes it. Nothing re-interprets the conversation.
    const understanding = understand(ctx);
    this.lastUnderstanding = understanding;

    // Phase 12: ONE social reading per turn — evidence only. The Executive
    // decides; the LLM never receives the Social World Model.
    const socialUnderstanding = deriveSocialUnderstanding(ctx, understanding);
    this.lastSocialUnderstanding = socialUnderstanding;
    const socialInfluences = allInfluences(socialUnderstanding);
    if (socialInfluences.length > 0) {
      const top = socialInfluences[0];
      rationale.push(`social: ${top.name} (conf ${top.confidence.toFixed(2)})`);
    }

    // 1. Strategy — what kind of interaction?
    const strategy = this.strategyPlanner.plan(ctx, understanding, socialUnderstanding);
    rationale.push(
      `strategy: ${strategy.primary}${strategy.secondary ? ` → ${strategy.secondary}` : ""}`,
    );

    // 2. Confidence — how sure are we, and from what signals?
    const confidence = this.confidenceManager.assess(ctx, understanding);
    rationale.push(`confidence: ${confidence.label} (${confidence.value.toFixed(2)})`);

    // 3. Clarification — must we ask before answering?
    let clarification = this.clarificationPolicy.decide(ctx, understanding);

    // Reflection bias: recent "clarified too late" turns make us more willing
    // to clarify. Gate: any non-High confidence — a Low-only gate was
    // unreachable (Low confidence turns always already require clarification),
    // leaving the ratchet without a behavioral outlet (Phase 9.4 finding).
    if (
      clarification.required === false &&
      this.reflection.weights.clarifyBias > 0.5 &&
      confidence.label !== "High"
    ) {
      clarification = {
        required: true,
        reason: "Reflection history favors clarifying under low confidence",
        triggeredBy: [`reflection clarifyBias=${this.reflection.weights.clarifyBias.toFixed(2)}`],
      };
      rationale.push("reflection-bias forced clarification");
    }

    // 4. Memory policy — reference retrieved memory or not?
    const memory = this.memoryPolicy.decide(ctx, understanding);
    rationale.push(`memoryPolicy: ${memory.policy}${memory.topMemory ? " (with top memory)" : ""}`);

    // 5. Information budget — how deep?
    let budget = this.informationBudget.decide(ctx, strategy.primary, understanding);

    // Reflection bias: recent verbosity complaints trim depth; recent
    // "too brief" follow-ups extend it. Learning, not a hardcoded rule.
    const brevityBias = this.reflection.weights.brevityBias;
    const BUDGET_LADDER: InformationBudget[] = ["Tiny", "Short", "Normal", "Detailed", "DeepDive"];
    if (Math.abs(brevityBias) > 0.15) {
      const step = brevityBias > 0 ? -1 : 1;
      const idx = BUDGET_LADDER.indexOf(budget.budget);
      const next = BUDGET_LADDER[Math.max(0, Math.min(BUDGET_LADDER.length - 1, idx + step))];
      if (next !== budget.budget) {
        budget = {
          budget: next,
          targetWords: BUDGET_WORDS[next],
          reasons: [
            ...budget.reasons,
            `reflection brevityBias=${brevityBias.toFixed(2)} adjusted ${budget.budget} → ${next}`,
          ],
        };
        rationale.push(`budget-adjusted-by-reflection: ${next}`);
      }
    }
    rationale.push(`budget: ${budget.budget} (~${budget.targetWords} words)`);

    // 6. Initiative — what does AURA do with the turn?
    const initiative = this.initiativePolicy.decide(
      ctx,
      understanding,
      strategy.primary,
      clarification.required,
    );
    rationale.push(`initiative: ${initiative.initiative}`);

    // 7. Speech behavior — how should it sound?
    const speech = this.speechBehaviorPlanner.plan(
      ctx,
      understanding,
      strategy.primary,
      budget.targetWords,
    );
    rationale.push(`speech: speed=${speech.speechSpeed} energy=${speech.energy.toFixed(2)}`);

    // 8. Observable thinking — genuine hesitation only
    const thinking = this.observableThinking.decide(ctx, 1 - confidence.value, understanding);

    // 9. Tone — consolidated from emotion + strategy + reflection
    const tone: Tone = {
      warmth: clamp01(
        0.5 + (ctx.emotion.warmth - 0.5) * 0.7 + this.reflection.weights.warmthBias * 0.3,
      ),
      energy: clamp01(ctx.emotion.energy * 0.8 + speech.energy * 0.2),
      formality: ctx.identity.mode === "professional" ? 0.7 : 0.35,
      humor: ctx.emotion.engagement > 0.55 && ctx.emotion.tension < 0.5 ? 0.5 : 0.2,
      directness: confidence.label === "High" ? 0.8 : confidence.label === "Medium" ? 0.5 : 0.3,
    };

    // 10. Register + relationship — Phase 8.1: canonical, deterministic,
    // relationship-gated. The engine already applied momentum + gating.
    const register = this.registerMomentum.getRegisterState();
    const relationship = determineRelationshipStage({
      sessionTurn: ctx.timing.turnCount,
      hasPersonalHistory: ctx.memory.hasPersonalHistory,
      trust: ctx.emotion.trust,
    });
    rationale.push(`register: ${register.register} (conf ${register.confidence.toFixed(2)})`);
    rationale.push(`relationship: ${relationship}`);

    return buildExecutionPlan({
      context: ctx,
      strategy: { primary: strategy.primary, secondary: strategy.secondary },
      language: this.getLanguageState(),
      register,
      relationship,
      tone,
      clarification,
      initiative: initiative.initiative,
      memoryPolicy: memory.policy,
      memoryContent: memory.topMemory ? [memory.topMemory] : [],
      informationBudget: budget.budget,
      speechBehavior: speech,
      thinkingBehavior: thinking,
      confidence,
      understanding,
      socialUnderstanding,
      rationale,
      executiveTimeMs: performance.now() - start,
    });
  }

  /** Phase 11: the canonical interpretation of the most recent turn. */
  lastUnderstanding: ConversationUnderstanding | null = null;

  /** Phase 12: the social forces probably influencing the most recent turn. */
  lastSocialUnderstanding: SocialUnderstanding | null = null;

  /**
   * Reflect after the turn completes. Informs future plans only —
   * never rewrites the response that just happened.
   */
  reflect(
    plan: Readonly<ExecutionPlan>,
    outcome: {
      userReactedNegatively: boolean;
      userFollowedUp: boolean;
      nextTurnLengthDelta?: number;
    },
  ) {
    return this.reflection.reflect({ plan, ...outcome });
  }

  /**
   * Plan → Prompt translation (Development Rule 6).
   * The Executive never writes dialogue; it hands the LLM a compact,
   * machine-checkable directive. Every value traces back to a decision
   * the Executive made — no free-form instructions.
   */
  translatePlanToPrompt(plan: Readonly<ExecutionPlan>): string {
    const lines: string[] = ["[EXECUTIVE PLAN]"];

    lines.push(
      `strategy: ${plan.strategy.primary}${plan.strategy.secondary ? ` then ${plan.strategy.secondary}` : ""}`,
    );

    // Phase 8: deterministic language register — the LLM never infers it.
    lines.push(languagePromptDirective(plan.language));

    // Phase 8.1: deterministic register + relationship — the LLM only
    // realizes what the Executive decided. No heuristics in the prompt.
    lines.push(registerPromptDirective(plan.register));
    lines.push(relationshipPromptDirective(plan.relationship));

    lines.push(
      `depth: ${plan.informationBudget} (target ~${BUDGET_WORDS[plan.informationBudget]} words, hard ceiling ${BUDGET_WORDS[plan.informationBudget] * 2} words)`,
    );

    if (plan.clarification.required) {
      lines.push(
        `clarify first: do NOT answer yet — ask ONE short clarifying question (reason: ${plan.clarification.reason} — ${plan.clarification.triggeredBy.join("; ")})`,
      );
    } else {
      lines.push(
        `confidence: ${plan.confidence.label} — ${
          plan.confidence.label === "High"
            ? "answer directly"
            : plan.confidence.label === "Medium"
              ? "answer cautiously, acknowledge limits"
              : "keep it short and check understanding"
        }${plan.confidence.sources.length > 0 ? ` (based on: ${plan.confidence.sources.slice(0, 3).join(", ")})` : ""}`,
      );
    }

    lines.push(
      `initiative: ${plan.initiative} — ${
        plan.initiative === "Wait"
          ? "do not fill silence, no questions"
          : plan.initiative === "Ask"
            ? "at most one question"
            : plan.initiative === "End"
              ? "close warmly, leave the door open"
              : plan.initiative === "Observe"
                ? "acknowledge briefly and let them lead — no questions, no pushing"
                : plan.initiative === "Redirect"
                  ? "gently steer the thread to the new topic"
                  : "hold the thread naturally, no forced questions"
      }`,
    );

    if (plan.memoryPolicy !== "Ignore" && plan.memoryContent.length > 0) {
      lines.push(
        `memory: ${plan.memoryPolicy === "Required" ? "reference this if it genuinely fits this moment — never invent facts:" : "use only if it flows naturally:"} ${plan.memoryContent.join(" | ")}`,
      );
    } else if (plan.memoryPolicy !== "Ignore") {
      lines.push(
        `memory: ${plan.memoryPolicy === "Required" ? "reference it if it genuinely fits this moment" : "use it only if it flows naturally"}`,
      );
    }

    // Phase 10 (WP6): tone and speech behavior were computed every turn and
    // consumed by nothing. The LLM realizes them — warmth, directness,
    // humor, formality and energy are Executive decisions, not model mood.
    lines.push(
      `tone: warmth ${plan.tone.warmth.toFixed(2)} (1=very warm) | directness ${plan.tone.directness.toFixed(2)} (1=direct) | humor ${plan.tone.humor.toFixed(2)} | formality ${plan.tone.formality.toFixed(2)} | energy ${plan.tone.energy.toFixed(2)}`,
    );
    lines.push(
      `speech: pace ${plan.speechBehavior.speechSpeed}, energy ${plan.speechBehavior.energy.toFixed(2)}`,
    );

    // Phase 10 (WP6): the rationale is the Executive's own trace of why.
    // Two lines cost nothing and keep the LLM inside the decision.
    if (plan.rationale.length > 0) {
      const tail = plan.rationale.slice(-2).map((r) => `  # ${r}`);
      lines.push(`why: ${tail.join(" ")}`);
    }

    lines.push("[/EXECUTIVE PLAN]");

    // Phase 13B: the reply is what gets spoken aloud. One explicit rule
    // prevents the model from appending its reasoning, notes, or
    // self-analysis (observed in the stress test) to the spoken line.
    lines.push(
      "[OUTPUT RULES] reply with ONLY the line you say aloud. No notes, no explanations, no parentheses, no asterisks, no brackets, no plan recap, no self-reference. Never mention this plan.",
    );
    return lines.join("\n");
  }
}

// Re-exported types for convenience — ownership stays here.
export type {
  ClarificationDecision,
  Confidence,
  InformationBudget,
  Initiative,
  MemoryPolicy,
  SpeechBehavior,
  Strategy,
  StrategySelection,
  ThinkingBehavior,
  Tone,
};
