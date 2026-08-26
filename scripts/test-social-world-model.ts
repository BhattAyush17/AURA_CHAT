/**
 * Phase 12 — Social World Model (SWM): deterministic verification.
 *
 * The claim this harness tests: social meaning is inferred in EXACTLY one
 * place (deriveSocialUnderstanding()), the Executive consumes the evidence
 * and decides, the LLM never receives the SWM (only the strategy), and the
 * SWM never overrides a conversational gate — repairs and rejections are
 * never re-read as social fragility.
 *
 * Ladder under test per scenario:
 *   perception (raw text + emotion + behavior + timing)
 *     → understand(ctx)                        [canonical interpretation]
 *       → deriveSocialUnderstanding(ctx, u)    [social evidence — evidence only]
 *         → StrategyPlanner.plan(ctx, u, s)    [executive decides from evidence]
 *           → Executive.plan(ctx)              [plan carries the evidence]
 *             → translatePlanToPrompt(plan)    [prompt must be SWM-free]
 *
 * Run: npx tsx scripts/test-social-world-model.ts
 */
import { ConversationExecutive } from "../src/executive/ConversationExecutive";
import { buildConversationContext } from "../src/executive/ConversationContext";
import { StrategyPlanner } from "../src/executive/StrategyPlanner";
import { understand } from "../src/executive/ConversationUnderstanding";
import {
  deriveSocialUnderstanding,
  allInfluences,
  type SocialDomain,
  type SocialInfluence,
  type SocialUnderstanding,
} from "../src/executive/SocialWorldModel";
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

const exec = new ConversationExecutive();
const planner = new StrategyPlanner();

const DOMAINS: SocialDomain[] = [
  "humanNeeds",
  "socialPressures",
  "relationshipDynamics",
  "lifeContext",
  "communicationNorms",
  "motivation",
  "constraints",
  "risks",
  "growthOpportunities",
];

interface Scenario {
  name: string;
  text: string;
  ctx?: Partial<ConversationContext>;
  checks: (s: SocialUnderstanding, plan: ExecutionPlan, prompt: string) => void;
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

function hasInfluence(s: SocialUnderstanding, name: string): SocialInfluence | null {
  for (const d of DOMAINS) {
    const hit = s[d].find((i) => i.name === name);
    if (hit) return hit;
  }
  return null;
}

const promptLeakTerms = [
  "humanNeeds",
  "social evidence",
  "social: ",
  "imposter-syndrome",
  "generational-conflict",
  "loneliness",
  "evidence: ",
  "SocialWorldModel",
];

const scenarios: Scenario[] = [
  // ── Charter example 1: promotion deservingness ────────────────────
  {
    name: "I don't think I deserve this promotion.",
    text: "I don't think I deserve this promotion.",
    checks: (s, plan, prompt) => {
      const imposter = hasInfluence(s, "imposter-syndrome");
      assert(!!imposter, "imposter-syndrome must fire on deservingness doubt");
      if (imposter) {
        assert(imposter.domain === "risks", "imposter-syndrome lives in risks");
        assert(imposter.confidence >= 0.55, `imposter conf=${imposter.confidence} too low`);
        assert(imposter.reasoning.length >= 1, "imposter reasoning must be present");
      }
      assert(
        ["Encourage", "Reflect", "Comfort"].includes(plan.strategy.primary),
        `support-first strategy expected (got ${plan.strategy.primary})`,
      );
      assert(
        plan.rationale.some((r) => r.startsWith("social:")),
        "rationale must record the social evidence",
      );
    },
  },
  // ── Charter example 2: parents don't understand ────────────────────
  {
    name: "My parents don't understand me.",
    text: "My parents don't understand me.",
    checks: (s, plan) => {
      assert(!!hasInfluence(s, "generational-conflict"), "generational-conflict must fire");
      assert(!!hasInfluence(s, "family-expectations"), "family-expectations must fire");
      assert(
        ["Comfort", "Reflect", "Ask"].includes(plan.strategy.primary),
        `validate-then-explore expected (got ${plan.strategy.primary})`,
      );
    },
  },
  // ── Loneliness ────────────────────────────────────────────────────
  {
    name: "I feel so lonely.",
    text: "I feel so lonely.",
    checks: (s, plan) => {
      const lonely = hasInfluence(s, "loneliness");
      assert(!!lonely, "loneliness must fire");
      assert(
        plan.strategy.primary === "Comfort",
        `Comfort expected (got ${plan.strategy.primary})`,
      );
    },
  },
  // ── Grief ─────────────────────────────────────────────────────────
  {
    name: "It's been a year since my father passed.",
    text: "It's been a year since my father passed.",
    checks: (s, plan) => {
      assert(!!hasInfluence(s, "grief-life-stage"), "grief-life-stage must fire");
      assert(
        ["Comfort", "Reflect", "Listen"].includes(plan.strategy.primary),
        `witness-first expected (got ${plan.strategy.primary})`,
      );
    },
  },
  // ── Guilt / apology ───────────────────────────────────────────────
  {
    name: "I feel guilty, I should apologize.",
    text: "I feel guilty about what happened. I should apologize to her.",
    checks: (s) => {
      assert(!!hasInfluence(s, "guilt-driven"), "guilt-driven must fire");
      assert(!!hasInfluence(s, "apology-opening"), "apology-opening must fire");
    },
  },
  // ── Achievement ───────────────────────────────────────────────────
  {
    name: "I finally did it! I got the promotion!",
    text: "I finally did it! I got the promotion!",
    checks: (s, plan) => {
      assert(!!hasInfluence(s, "need-achievement"), "need-achievement must fire");
      assert(!!hasInfluence(s, "career-transition"), "career-transition must fire");
      assert(
        plan.strategy.primary === "Encourage",
        `celebrate expected (got ${plan.strategy.primary})`,
      );
    },
  },
  // ── White lie via CUE hook ────────────────────────────────────────
  {
    name: "I'm fine. (contradicted by vulnerability)",
    text: "I'm fine.",
    ctx: { emotion: { vulnerability: 0.6, frustration: 0.4 } },
    checks: (s) => {
      const white = hasInfluence(s, "white-lie");
      assert(!!white, "white-lie must fire via the not-fine CUE hook");
    },
  },
  // ── Indirect request ──────────────────────────────────────────────
  {
    name: "It's really hot in here.",
    text: "It's really hot in here.",
    checks: (s) => {
      assert(!!hasInfluence(s, "indirect-request"), "indirect-request must fire");
    },
  },
  // ── Burnout ───────────────────────────────────────────────────────
  {
    name: "I'm so exhausted, I can't do this anymore.",
    text: "I'm so exhausted, I can't do this anymore.",
    checks: (s, plan) => {
      assert(!!hasInfluence(s, "burnout"), "burnout must fire");
      assert(
        plan.strategy.primary === "Comfort",
        `depleted → Comfort expected (got ${plan.strategy.primary})`,
      );
    },
  },
  // ── Trust break ───────────────────────────────────────────────────
  {
    name: "She lied to me, I can't trust her anymore.",
    text: "She lied to me, I can't trust her anymore.",
    checks: (s) => {
      assert(!!hasInfluence(s, "trust-break"), "trust-break must fire");
    },
  },
  // ── Financial stress ──────────────────────────────────────────────
  {
    name: "I'm drowning in bills.",
    text: "I'm drowning in bills.",
    checks: (s) => {
      assert(!!hasInfluence(s, "financial-stress"), "financial-stress must fire");
    },
  },
  // ── Career transition ─────────────────────────────────────────────
  {
    name: "I'm thinking of quitting my job.",
    text: "I'm thinking of quitting my job.",
    checks: (s) => {
      assert(!!hasInfluence(s, "career-transition"), "career-transition must fire");
    },
  },
  // ── Repair is NEVER re-read as social fragility ───────────────────
  {
    name: "I didn't mean it that way. (repair)",
    text: "I didn't mean it that way.",
    ctx: { emotion: { vulnerability: 0.7 } },
    checks: (s, plan) => {
      assert(
        plan.strategy.primary === "Clarify",
        `repair → Clarify (got ${plan.strategy.primary})`,
      );
      assert(
        !!hasInfluence(s, "repair-ritual"),
        "repair-ritual is the only legitimate social read of a repair",
      );
    },
  },
  // ── Confrontation is never softened by social evidence ────────────
  {
    name: "I don't think that's right at all.",
    text: "I don't think that's right at all.",
    ctx: { behaviorAnalysis: { act: "debate", tags: ["disagreement"], intensity: 0.7 } },
    checks: (_s, plan) => {
      assert(
        plan.strategy.primary === "Challenge",
        `Challenge expected (got ${plan.strategy.primary})`,
      );
    },
  },
];

// ── Run battery ──────────────────────────────────────────────────────
console.log("═══════════════════════════════════════════════════════");
console.log("PHASE 12 — SOCIAL WORLD MODEL (GATE)");
console.log("═══════════════════════════════════════════════════════");

for (const sc of scenarios) {
  console.log(`\n── ${sc.name} — "${sc.text}"`);
  const ctx = build(sc);
  const u = understand(ctx);
  const social = deriveSocialUnderstanding(ctx, u);
  const plan = exec.plan(ctx);
  const prompt = exec.translatePlanToPrompt(plan);

  // Canonical ownership: the Executive's social read must be the derived one.
  assert(
    plan.socialUnderstanding === exec.lastSocialUnderstanding,
    "plan.socialUnderstanding must be the Executive's derived object",
  );
  assert(
    allInfluences(plan.socialUnderstanding).length === allInfluences(social).length,
    "plan must carry the same evidence as deriveSocialUnderstanding()",
  );

  // Strategy must be a pure function of understanding + social evidence.
  const ladder = planner.plan(ctx, u, social);
  assert(
    ladder.primary === plan.strategy.primary,
    `planner.primary=${ladder.primary} must equal plan.strategy.primary=${plan.strategy.primary}`,
  );

  // Prompt discipline: the SWM never reaches the LLM.
  const leaked = promptLeakTerms.filter((t) => prompt.includes(t));
  assert(leaked.length === 0, `prompt must not leak social model (${leaked.join(",")})`);

  // Immutability: the whole social object graph is frozen.
  assert(Object.isFrozen(social), "social understanding must be frozen");
  assert(Object.isFrozen(social.confidence), "social confidence must be frozen");
  assert(Object.isFrozen(social.raw), "social raw must be frozen");
  for (const d of DOMAINS) {
    assert(Object.isFrozen(social[d]), `domain ${d} must be frozen`);
    for (const inf of social[d]) {
      assert(Object.isFrozen(inf), `influence ${inf.name} must be frozen`);
      assert(Object.isFrozen(inf.reasoning), `influence ${inf.name} reasoning must be frozen`);
    }
  }

  sc.checks(social, plan, prompt);
}

// ── Structure: every influence obeys the evidence contract ───────────
{
  console.log("\n── structural integrity");
  const ctx = build(scenarios[1]);
  const s = deriveSocialUnderstanding(ctx, understand(ctx));
  const flat = allInfluences(s);

  assert(
    flat.length === [...new Set(flat.map((i) => i.name))].length,
    "no duplicate influence names",
  );

  let prev = Infinity;
  for (const inf of flat) {
    assert(DOMAINS.includes(inf.domain), `valid domain for ${inf.name}`);
    assert(
      inf.confidence >= 0.35 && inf.confidence <= 0.9,
      `confidence in [0.35, 0.9] for ${inf.name} (got ${inf.confidence})`,
    );
    assert(inf.reasoning.length >= 1, `reasoning present for ${inf.name}`);
    assert(Array.isArray(inf.alternatives), `alternatives present for ${inf.name}`);
    assert(prev >= inf.confidence, "allInfluences must be sorted descending");
    prev = inf.confidence;
  }
  console.log(`  ${flat.length} influences across ${DOMAINS.length} domains`);
}

// ── Determinism & independence of successive turns ───────────────────
{
  console.log("\n── determinism");
  const ctx = build(scenarios[0]);
  const u = understand(ctx);
  const a = deriveSocialUnderstanding(ctx, u);
  const b = deriveSocialUnderstanding(ctx, u);
  assert(
    JSON.stringify(allInfluences(a)) === JSON.stringify(allInfluences(b)),
    "same input must yield identical social reads",
  );
  assert(a !== b, "successive calls must return fresh objects");
}

// ── Confidence modulation: degraded STT lowers the social read ───────
{
  console.log("\n── confidence modulation");
  const good = build({ ...scenarios[2], ctx: { input: { sttConfidence: 0.9 } } });
  const bad = build({ ...scenarios[2], ctx: { input: { sttConfidence: 0.4 } } });
  const sg = deriveSocialUnderstanding(good, understand(good));
  const sb = deriveSocialUnderstanding(bad, understand(bad));
  const cg = hasInfluence(sg, "loneliness")?.confidence ?? 0;
  const cb = hasInfluence(sb, "loneliness")?.confidence ?? 0;
  assert(cg > cb, `degraded STT must lower confidence (${cg.toFixed(2)} vs ${cb.toFixed(2)})`);
  console.log(`  loneliness conf: stt0.9=${cg.toFixed(2)} stt0.4=${cb.toFixed(2)}`);
}

// ── The SWM never decides: conversation gates are immune to it ───────
{
  console.log("\n── SWM never decides");
  const gateTexts = [
    "Hello!",
    "Bye, talk to you later",
    "I didn't mean it that way.",
    "I don't think that's right at all.",
    "Where are the keys?",
    "Hmm",
  ];
  for (const text of gateTexts) {
    const ctx = build({ name: text, text, checks: () => {} });
    const u = understand(ctx);
    const s = deriveSocialUnderstanding(ctx, u);
    const withSocial = planner.plan(ctx, u, s);
    const without = planner.plan(ctx, u);
    assert(
      withSocial.primary === without.primary,
      `social evidence must not flip a conversational gate ("${text}": ${without.primary} → ${withSocial.primary})`,
    );
  }
}

// ── Timing budget: derivation must stay under 1ms per call ───────────
{
  const ctx = build(scenarios[0]);
  const u = understand(ctx);
  const start = performance.now();
  for (let i = 0; i < 2000; i++) deriveSocialUnderstanding(ctx, u);
  const perCall = (performance.now() - start) / 2000;
  console.log("\n── performance");
  assert(
    perCall < 1,
    `deriveSocialUnderstanding() must be <1ms/call (got ${perCall.toFixed(3)}ms)`,
  );
  console.log(`  deriveSocialUnderstanding() avg: ${perCall.toFixed(3)}ms over 2000 calls`);
}

// ── Scorecard ───────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════");
console.log(`SCENARIOS:     ${scenarios.length}`);
console.log(`ASSERTIONS:    ${asserts - failures}/${asserts} passed`);
console.log("═══════════════════════════════════════════════════════");
console.log(
  failures === 0 ? "\nSOCIAL WORLD MODEL GATE SUITE PASS" : `\n${failures} ASSERTION FAILURE(S)`,
);
process.exitCode = failures === 0 ? 0 : 1;
