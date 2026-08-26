/**
 * Phase 11 — Conversation Understanding Engine (CUE): deterministic verification.
 *
 * The claim this harness tests: conversation meaning is inferred in EXACTLY
 * one place (understand()), every policy consumes the same immutable object,
 * and the LLM prompt never receives raw understanding — only the strategy
 * the Executive chose from it.
 *
 * Ladder under test per scenario:
 *   perception (raw text + emotion + behavior + timing)
 *     → understand(ctx)                    [canonical interpretation]
 *       → StrategyPlanner.plan(ctx, u)     [strategy from understanding only]
 *         → Executive.plan(ctx)            [executive consumes lastUnderstanding]
 *           → translatePlanToPrompt(plan)  [prompt emission]
 *
 * Run: npx tsx scripts/test-understanding.ts
 */
import { ConversationExecutive } from "../src/executive/ConversationExecutive";
import { buildConversationContext } from "../src/executive/ConversationContext";
import { StrategyPlanner } from "../src/executive/StrategyPlanner";
import { understand } from "../src/executive/ConversationUnderstanding";
import type { ConversationUnderstanding } from "../src/executive/ConversationUnderstanding";
import type { ConversationContext } from "../src/executive/ConversationContext";
import type { ExecutionPlan } from "../src/executive/ExecutionPlan";

let failures = 0;
let asserts = 0;
const assert = (cond: boolean, label: string) => {
  asserts++;
  if (!cond) {
    failures++;
    console.log(`  ❌ ${label}`);
  }
};

/** The Executive builds its own frozen object per turn; two calls are
 *  deep-equal, never reference-equal. Compare the interpreted surface. */
function deepSame(
  a: ConversationUnderstanding | null,
  b: ConversationUnderstanding | null,
): boolean {
  if (!a || !b) return false;
  return (
    a.literal === b.literal &&
    a.move === b.move &&
    a.speakerGoal === b.speakerGoal &&
    a.expected === b.expected &&
    a.state === b.state &&
    a.confidence.value === b.confidence.value &&
    (a.implicit?.label ?? null) === (b.implicit?.label ?? null) &&
    a.social.map((s) => s.name).join(",") === b.social.map((s) => s.name).join(",") &&
    a.shared.openQuestion === b.shared.openQuestion &&
    a.shared.repairPending === b.shared.repairPending &&
    a.context.sttConfidence === b.context.sttConfidence
  );
}

const exec = new ConversationExecutive();
const planner = new StrategyPlanner();

interface Scenario {
  category: string;
  name: string;
  text: string;
  ctx?: Partial<ConversationContext>;
  checks: (u: ConversationUnderstanding, plan: ExecutionPlan, prompt: string) => void;
}

function build(sc: Scenario) {
  const ctx = buildConversationContext({
    input: {
      text: sc.text,
      sttConfidence: 0.9,
      wasInterruption: false,
      audioRms: 0.02,
      languageMode: "detected",
      ...sc.ctx?.input,
    },
    language: exec.getLanguageState(),
    register: exec.getRegisterState(),
    emotion: {
      dominant: "neutral",
      tension: 0.1,
      trust: 0.5,
      energy: 0.5,
      warmth: 0.5,
      engagement: 0.5,
      frustration: 0,
      vulnerability: 0.3,
      arc: "building",
      ...sc.ctx?.emotion,
    },
    memory: { ...sc.ctx?.memory },
    identity: { ...sc.ctx?.identity },
    timing: {
      silenceDurationMs: 0,
      turnCount: 5,
      lastResponseLatencyMs: 0,
      averageResponseLengthWords: 30,
      ...sc.ctx?.timing,
    },
    recentHistory: sc.ctx?.recentHistory,
    behaviorAnalysis: sc.ctx?.behaviorAnalysis ?? null,
  });
  return ctx;
}

const scenarios: Scenario[] = [
  // ── 1. Greeting ──────────────────────────────────────────────────
  {
    category: "greeting",
    name: "Hello",
    text: "Hello!",
    checks: (u, plan) => {
      assert(u.literal === "greeting", `literal=${u.literal} expected greeting`);
      assert(u.move === "Continue", `move=${u.move} expected Continue`);
      assert(u.speakerGoal === "small-talk", `goal=${u.speakerGoal} expected small-talk`);
      assert(u.state === "opening", `state=${u.state} expected opening`);
      assert(plan.initiative === "Continue", `initiative=${plan.initiative} expected Continue`);
    },
  },
  // ── 2. Goodbye ───────────────────────────────────────────────────
  {
    category: "goodbye",
    name: "Farewell",
    text: "Bye, talk to you later",
    checks: (u, plan) => {
      assert(u.literal === "goodbye", `literal=${u.literal} expected goodbye`);
      assert(u.move === "Close", `move=${u.move} expected Close`);
      assert(u.speakerGoal === "close", `goal=${u.speakerGoal} expected close`);
      assert(u.state === "ending", `state=${u.state} expected ending`);
      assert(plan.initiative === "End", `initiative=${plan.initiative} expected End`);
    },
  },
  // ── 3. Backchannel ───────────────────────────────────────────────
  {
    category: "backchannel",
    name: "Yeah yeah",
    text: "Yeah yeah",
    checks: (u) => {
      assert(u.literal === "backchannel", `literal=${u.literal} expected backchannel`);
      assert(u.move === "Continue", `move=${u.move} expected Continue`);
      assert(u.speakerGoal === "small-talk", `goal=${u.speakerGoal} expected small-talk`);
      assert(u.raw.isQuestion === false, "backchannel must not be a question");
    },
  },
  // ── 4. Backchannel after long silence → re-engagement ─────────────
  {
    category: "backchannel-long-silence",
    name: "Hmm after 12s silence",
    text: "Hmm",
    ctx: { timing: { silenceDurationMs: 12000, turnCount: 10 } },
    checks: (u, plan) => {
      assert(u.literal === "backchannel", `literal=${u.literal} expected backchannel`);
      assert(u.move === "Explore", `move=${u.move} expected Explore`);
      assert(plan.initiative === "Ask", `initiative=${plan.initiative} expected Ask`);
    },
  },
  // ── 5. Direct question ───────────────────────────────────────────
  {
    category: "question",
    name: "Direct question",
    text: "What's the weather like today?",
    checks: (u, plan) => {
      assert(u.literal === "question", `literal=${u.literal} expected question`);
      assert(u.move === "Ask", `move=${u.move} expected Ask`);
      assert(u.speakerGoal === "seek-information", `goal=${u.speakerGoal}`);
      assert(u.expected === "information", `expected=${u.expected} expected information`);
      assert(u.raw.isQuestion === true, "raw.isQuestion must be true");
      assert(plan.strategy.primary === "Answer", `strategy=${plan.strategy.primary}`);
    },
  },
  // ── 6. Indirect question (pattern set) ───────────────────────────
  {
    category: "indirect-question",
    name: "I was wondering…",
    text: "I was wondering if you could help me with this",
    checks: (u) => {
      assert(u.literal === "question", `literal=${u.literal} expected question (indirect)`);
      assert(u.move === "Ask", `move=${u.move} expected Ask`);
    },
  },
  // ── 7. Request (pattern set) ─────────────────────────────────────
  {
    category: "request",
    name: "Could you please…",
    text: "Could you please turn off the lights?",
    checks: (u, plan) => {
      assert(u.literal === "request", `literal=${u.literal} expected request`);
      assert(u.move === "Ask", `move=${u.move} expected Ask`);
      assert(u.expected === "advice", `expected=${u.expected} expected advice`);
      assert(plan.strategy.primary === "Answer", `strategy=${plan.strategy.primary}`);
    },
  },
  // ── 8. Repair (rejection of previous reading) ─────────────────────
  {
    category: "repair",
    name: "Rejection",
    text: "No, that's not what I meant.",
    ctx: { emotion: { vulnerability: 0.45, frustration: 0.4, tension: 0.3 } },
    checks: (u, plan) => {
      assert(u.literal === "repair", `literal=${u.literal} expected repair`);
      assert(u.move === "Repair", `move=${u.move} expected Repair`);
      assert(u.speakerGoal === "repair", `goal=${u.speakerGoal} expected repair`);
      assert(u.expected === "clarification", `expected=${u.expected}`);
      assert(u.state === "repair", `state=${u.state} expected repair`);
      assert(plan.clarification.required === true, "repair must force clarification");
    },
  },
  // ── 9. Contradiction (pattern set) ───────────────────────────────
  {
    category: "contradiction",
    name: "But you said the opposite",
    text: "But you said the opposite earlier!",
    checks: (u) => {
      assert(u.literal === "repair", `literal=${u.literal} expected repair (contradiction)`);
      assert(u.move === "Repair", `move=${u.move} expected Repair`);
    },
  },
  // ── 10. Retraction ───────────────────────────────────────────────
  {
    category: "retraction",
    name: "Never mind",
    text: "Never mind, forget it",
    checks: (u) => {
      assert(u.literal === "retraction", `literal=${u.literal} expected retraction`);
      assert(u.move === "Observe", `move=${u.move} expected Observe`);
    },
  },
  // ── 11. Correction (self re-anchor) ──────────────────────────────
  {
    category: "correction",
    name: "Actually I meant the other one",
    text: "Well, actually I meant the other one",
    checks: (u) => {
      assert(u.literal === "correction", `literal=${u.literal} expected correction`);
      assert(u.move === "Clarify", `move=${u.move} expected Clarify`);
      assert(u.speakerGoal === "repair", `goal=${u.speakerGoal} expected repair`);
      assert(u.expected === "clarification", `expected=${u.expected}`);
    },
  },
  // ── 12. Thinking / hold ──────────────────────────────────────────
  {
    category: "thinking",
    name: "Wait, let me think",
    text: "hmm, wait, let me think...",
    checks: (u, plan) => {
      assert(u.literal === "thinking", `literal=${u.literal} expected thinking`);
      assert(u.move === "Wait", `move=${u.move} expected Wait`);
      assert(u.speakerGoal === "think-aloud", `goal=${u.speakerGoal}`);
      assert(u.expected === "silence", `expected=${u.expected} expected silence`);
      assert(plan.initiative === "Wait", `initiative=${plan.initiative} expected Wait`);
    },
  },
  // ── 13. Trailing off ─────────────────────────────────────────────
  {
    category: "trailing",
    name: "And then I thought…",
    text: "And then I thought... you know...",
    checks: (u) => {
      assert(u.literal === "trailing", `literal=${u.literal} expected trailing`);
      assert(u.move === "Wait", `move=${u.move} expected Wait`);
      assert(u.expected === "silence", `expected=${u.expected}`);
    },
  },
  // ── 14. Silence ──────────────────────────────────────────────────
  {
    category: "silence",
    name: "No input",
    text: "",
    checks: (u) => {
      assert(u.literal === "silence", `literal=${u.literal} expected silence`);
      assert(u.speakerGoal === "think-aloud", `goal=${u.speakerGoal}`);
      assert(u.expected === "silence", `expected=${u.expected}`);
    },
  },
  // ── 15. Story / sharing ──────────────────────────────────────────
  {
    category: "story",
    name: "Confession",
    text: "I broke up with my girlfriend yesterday",
    ctx: {
      emotion: { vulnerability: 0.5, tension: 0.4 },
      behaviorAnalysis: { act: "share", tags: ["sharing", "story"], intensity: 0.6 },
    },
    checks: (u, plan) => {
      assert(u.literal === "story", `literal=${u.literal} expected story`);
      assert(u.move === "Reflect", `move=${u.move} expected Reflect`);
      assert(u.speakerGoal === "tell-story", `goal=${u.speakerGoal}`);
      assert(u.expected === "listening", `expected=${u.expected} expected listening`);
      assert(plan.strategy.primary === "Reflect", `strategy=${plan.strategy.primary}`);
    },
  },
  // ── 16. Opinion ──────────────────────────────────────────────────
  {
    category: "opinion",
    name: "Opinion tag",
    text: "I think that movie is overrated",
    ctx: { behaviorAnalysis: { act: "state", tags: ["opinion"], intensity: 0.5 } },
    checks: (u) => {
      assert(u.literal === "opinion", `literal=${u.literal} expected opinion`);
    },
  },
  // ── 17. Hedged → uncertainty ─────────────────────────────────────
  {
    category: "hedged",
    name: "Maybe we should…",
    text: "I think maybe we should change the plan",
    checks: (u, plan) => {
      assert(u.speakerGoal === "express-uncertainty", `goal=${u.speakerGoal}`);
      assert(u.expected === "clarification", `expected=${u.expected}`);
      assert(
        u.social.some((s) => s.name === "hesitation"),
        `social must include hesitation (${u.social.map((s) => s.name).join(",")})`,
      );
      assert(plan.clarification.required === true, "hedged input must clarify");
    },
  },
  // ── 18. Sarcasm / irony ──────────────────────────────────────────
  {
    category: "sarcasm",
    name: "Oh great, another crash",
    text: "Oh great, another crash. Just what I needed.",
    checks: (u) => {
      assert(
        u.social.some((s) => s.name === "sarcasm"),
        `social must include sarcasm (${u.social.map((s) => s.name).join(",")})`,
      );
      assert(u.implicit?.label === "dissatisfied", `implicit=${u.implicit?.label}`);
    },
  },
  // ── 19. Disagreement ─────────────────────────────────────────────
  {
    category: "disagreement",
    name: "I disagree",
    text: "I disagree with that take.",
    checks: (u, plan) => {
      assert(u.speakerGoal === "debate", `goal=${u.speakerGoal}`);
      assert(u.state === "conflict", `state=${u.state} expected conflict`);
      assert(u.expected === "challenge", `expected=${u.expected}`);
      assert(
        plan.strategy.primary === "Challenge" || plan.strategy.primary === "Reflect",
        `strategy=${plan.strategy.primary}`,
      );
    },
  },
  // ── 20. Vulnerability → comfort ──────────────────────────────────
  {
    category: "comfort",
    name: "I'm so scared about this",
    text: "I'm so scared about this surgery",
    ctx: { emotion: { vulnerability: 0.8, tension: 0.7 } },
    checks: (u, plan) => {
      assert(u.move === "Comfort", `move=${u.move} expected Comfort`);
      assert(u.expected === "empathy", `expected=${u.expected} expected empathy`);
      assert(plan.strategy.primary === "Comfort", `strategy=${plan.strategy.primary}`);
    },
  },
  // ── 21. Frustration ──────────────────────────────────────────────
  {
    category: "frustration",
    name: "This is not working",
    text: "This is not working, fix it now",
    ctx: {
      emotion: { frustration: 0.75 },
      behaviorAnalysis: { act: "command", tags: ["command"], intensity: 0.8 },
    },
    checks: (u, plan) => {
      // A frustrated command is still a command: request semantics with
      // frustration visible in social signals.
      assert(u.literal === "request", `literal=${u.literal} expected request`);
      assert(u.speakerGoal === "seek-information", `goal=${u.speakerGoal} (request semantics)`);
      assert(u.expected === "advice", `expected=${u.expected} expected advice`);
      assert(
        u.social.some((s) => s.name === "frustration"),
        "social must include frustration",
      );
      assert(plan.strategy.primary === "Answer", `strategy=${plan.strategy.primary}`);
    },
  },
  // ── 22. Excitement ───────────────────────────────────────────────
  {
    category: "excitement",
    name: "I got the job!",
    text: "I got the job! I actually got it!",
    ctx: { emotion: { arc: "peak", energy: 0.8, engagement: 0.9 } },
    checks: (u) => {
      assert(u.speakerGoal === "share-excitement", `goal=${u.speakerGoal}`);
      assert(u.expected === "agreement", `expected=${u.expected}`);
      assert(
        u.social.some((s) => s.name === "excitement"),
        "social must include excitement",
      );
    },
  },
  // ── 23. Seeking validation ───────────────────────────────────────
  {
    category: "validation",
    name: "Was I right?",
    text: "I did the right thing, right?",
    ctx: { emotion: { vulnerability: 0.6, energy: 0.4 } },
    checks: (u) => {
      assert(u.expected === "agreement", `expected=${u.expected} expected agreement`);
    },
  },
  // ── 24. Hidden request (implicit) ────────────────────────────────
  {
    category: "hidden-request",
    name: "It's really hot",
    text: "It's really hot in here.",
    checks: (u, plan) => {
      assert(u.implicit?.label === "hidden-request", `implicit=${u.implicit?.label}`);
      assert(u.expected === "advice", `expected=${u.expected} expected advice (implicit)`);
      assert(u.implicit.confidence >= 0.5, "implicit must carry confidence");
      assert(u.implicit.reasoning.length > 0, "implicit must carry reasoning");
      assert(u.implicit.alternatives.length > 0, "implicit must carry alternatives");
      assert(
        plan.strategy.primary === "Answer" || plan.strategy.primary === "Observe",
        `strategy=${plan.strategy.primary} (statement reading)`,
      );
    },
  },
  // ── 25. Not-fine (surface vs. signal contradiction) ──────────────
  {
    category: "not-fine",
    name: "I'm fine (vulnerability high)",
    text: "I'm fine.",
    ctx: { emotion: { vulnerability: 0.6, energy: 0.3 } },
    checks: (u) => {
      assert(u.implicit?.label === "not-fine", `implicit=${u.implicit?.label}`);
      assert(
        u.implicit.reasoning.some((r) => r.includes("contradict")),
        `reasoning must note the contradiction (${u.implicit.reasoning.join("; ")})`,
      );
    },
  },
  // ── 26. Topic shift ──────────────────────────────────────────────
  {
    category: "topic-shift",
    name: "So anyway, back to…",
    text: "So anyway, back to what we were discussing",
    checks: (u) => {
      assert(u.state === "topic-shift", `state=${u.state} expected topic-shift`);
      assert(u.shared.branchActive === true, "branchActive must be true");
      assert(u.shared.notes.length > 0, "shared notes must be non-empty");
    },
  },
  // ── 27. Memory conflict ──────────────────────────────────────────
  {
    category: "memory-conflict",
    name: "Two competing memories",
    text: "Remember when I moved to Delhi?",
    ctx: { memory: { relevanceScores: [0.72, 0.61, 0.2] } },
    checks: (u) => {
      assert(u.context.memoryConflict === true, "memoryConflict must be true");
    },
  },
  // ── 28. Degraded STT → confidence floor & fold-in skip ───────────
  {
    category: "stt-degraded",
    name: "stt 0.4 garbage",
    text: "grbllx zzt",
    ctx: { input: { sttConfidence: 0.4 } },
    checks: (u, plan) => {
      assert(u.context.sttConfidence === 0.4, "stt must be surfaced in context");
      assert(plan.confidence.label === "Low", `confidence=${plan.confidence.label}`);
      assert(plan.confidence.value < 0.6, "degraded stt must suppress confidence");
      assert(plan.clarification.required === true, "degraded stt must clarify");
    },
  },
  // ── 29. Confidence alternatives on competing moves ───────────────
  {
    category: "alternatives",
    name: "Hedged question has alternatives",
    text: "I think maybe the plan is wrong, what do you think?",
    ctx: { emotion: { vulnerability: 0.4 } },
    checks: (u) => {
      assert(u.confidence.alternatives.length > 0, "alternatives must exist");
      assert(
        u.confidence.alternatives.every((a) => a.p >= 0 && a.p <= 1),
        "alternative probabilities must be normalized",
      );
      assert(u.confidence.reasoning.length > 0, "confidence must carry reasoning");
      assert(Object.isFrozen(u.confidence.alternatives), "alternatives must be frozen");
    },
  },
  // ── 30. Shared context: open question on the table ───────────────
  {
    category: "open-question",
    name: "AURA asked, user replied",
    text: "Yeah, it was nice",
    ctx: {
      recentHistory: [
        {
          isUser: false,
          text: "How was your trip to Goa?",
          timestamp: Date.now() - 30000,
        },
        { isUser: true, text: "Yeah, it was nice", timestamp: Date.now() - 10000 },
      ],
    },
    checks: (u) => {
      assert(u.shared.openQuestion === false, "answered question must clear the flag");
      assert(u.shared.notes.length === 0, "no pending shared state expected");
    },
  },
  // ── 31. Repair pending from history ──────────────────────────────
  {
    category: "repair-pending",
    name: "User rejected before this turn",
    text: "Hmm okay",
    ctx: {
      recentHistory: [
        {
          isUser: true,
          text: "No, that's not what I meant",
          timestamp: Date.now() - 30000,
        },
      ],
    },
    checks: (u) => {
      assert(u.shared.repairPending === true, "repairPending must be true");
    },
  },
];

// ── Per-scenario execution: understanding → planner → executive → prompt ──
console.log("═══════════════════════════════════════════════════════");
console.log("PHASE 11 — CONVERSATION UNDERSTANDING ENGINE (GATE)");
console.log("═══════════════════════════════════════════════════════");

const promptLeakTerms = [
  "literal",
  "speakerGoal",
  "implicit",
  "move=",
  "CONVERSATION_UNDERSTANDING",
];

const categories = new Set<string>();
for (const sc of scenarios) {
  categories.add(sc.category);
  console.log(`\n── [${sc.category}] ${sc.name} — "${sc.text}"`);
  const ctx = build(sc);
  const u = understand(ctx);
  const plan = exec.plan(ctx);
  const prompt = exec.translatePlanToPrompt(plan);

  // Canonical ownership: the Executive's understanding must match the
  // exported understand() exactly (same interpretation, fresh object).
  assert(deepSame(u, exec.lastUnderstanding), "Executive's understanding must match understand()");

  // Strategy must be a pure function of the understanding.
  const ladder = planner.plan(ctx, u);
  assert(
    ladder.primary === plan.strategy.primary,
    `planner.primary=${ladder.primary} must equal plan.strategy.primary=${plan.strategy.primary}`,
  );

  // Prompt discipline: raw understanding never leaks into the LLM prompt.
  const leaked = promptLeakTerms.filter((t) => prompt.includes(t));
  assert(leaked.length === 0, `prompt must not leak understanding (${leaked.join(",")})`);

  // Immutability: the whole object graph is frozen.
  assert(Object.isFrozen(u), "understanding must be frozen");
  assert(Object.isFrozen(u.raw) && Object.isFrozen(u.social), "raw/social must be frozen");
  assert(Object.isFrozen(u.shared) && Object.isFrozen(u.shared.notes), "shared must be frozen");
  assert(
    Object.isFrozen(u.confidence) && Object.isFrozen(u.confidence.reasoning),
    "confidence must be frozen",
  );

  // Plumbing: the plan's embedded understanding matches the canonical one.
  assert(deepSame(plan.understanding, u), "plan.understanding must match the canonical object");

  sc.checks(u, plan, prompt);
}

// ── Timing budget: understanding must stay under 1ms per call ────────
{
  const ctx = build(scenarios[5]);
  const start = performance.now();
  for (let i = 0; i < 2000; i++) understand(ctx);
  const perCall = (performance.now() - start) / 2000;
  console.log(`\n── performance`);
  assert(perCall < 1, `understand() must be <1ms/call (got ${perCall.toFixed(3)}ms)`);
  console.log(`  understand() avg: ${perCall.toFixed(3)}ms over 2000 calls`);
}

// ── Scorecard ───────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════");
console.log(`CATEGORIES:    ${categories.size}`);
console.log(`SCENARIOS:     ${scenarios.length}`);
console.log(`ASSERTIONS:    ${asserts - failures}/${asserts} passed`);
console.log("═══════════════════════════════════════════════════════");
console.log(
  failures === 0 ? "\nUNDERSTANDING GATE SUITE PASS" : `\n${failures} ASSERTION FAILURE(S)`,
);
process.exitCode = failures === 0 ? 0 : 1;
