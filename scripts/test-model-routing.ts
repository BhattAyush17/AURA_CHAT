/**
 * Phase 14.2 — deterministic tests for Executive-driven model routing.
 * Run: npx tsx scripts/test-model-routing.ts
 *
 * Covers the 15 validation scenarios from the mission brief plus the
 * invariant assertions (determinism, no keyword routing, Gemini never
 * primary for playful, Gemma always emergency-last, queue integrity,
 * routing latency).
 */
import {
  CONVERSATION_PROFILES,
  routeConversationModel,
  scoreProfiles,
  signalsFromPlan,
  type RoutingSignals,
} from "../src/executive/ModelRouter";
import {
  MODEL_OPENROUTER_IDS,
  EMERGENCY_FALLBACK,
  buildModelQueue,
  type ModelId,
} from "../src/executive/ModelProfile";
import { ConversationExecutive } from "../src/executive/ConversationExecutive";
import { buildConversationContext } from "../src/executive/ConversationContext";
import type { ConversationProfileId } from "../src/executive/ModelRouter";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function influence(name: string): {
  name: string;
  domain: "communicationNorms";
  confidence: number;
  reasoning: string[];
  alternatives: string[];
} {
  return { name, domain: "communicationNorms", confidence: 0.8, reasoning: [], alternatives: [] };
}

function social(bucket: "communicationNorms" | "lifeContext" | "humanNeeds", name: string) {
  return { [bucket]: [influence(name)] };
}

/**
 * Build a fully-typed RoutingSignals fixture from compact overrides.
 * All values are Executive outputs — the router never sees raw text;
 * `raw.text` is only there to prove the router ignores it.
 */
function mk(overrides: Partial<RoutingSignals> & { text?: string }): RoutingSignals {
  const base: RoutingSignals = {
    strategy: "Answer",
    register: "NEUTRAL",
    relationship: "NEW",
    language: "UNKNOWN",
    tone: { warmth: 0.5, energy: 0.5, formality: 0.35, humor: 0.2, directness: 0.5 },
    understanding: {
      literal: "statement",
      move: "Continue",
      speakerGoal: "small-talk",
      expected: "listening",
      implicit: null,
      social: [],
      state: "building",
      shared: {
        openQuestion: false,
        repairPending: false,
        topicUnfinished: false,
        emotionUnresolved: false,
        branchActive: false,
        notes: [],
      },
      confidence: { value: 0.6, reasoning: [], alternatives: [] },
      context: {
        sttConfidence: 0.9,
        wordCount: 8,
        silenceMs: 200,
        turnCount: 5,
        memoryConflict: false,
        ambiguityTagged: false,
        engagement: 0.5,
        vulnerability: 0.2,
        tension: 0.2,
        frustration: 0.1,
      },
      raw: {
        text: overrides.text ?? "placeholder text",
        clean: "placeholder text",
        isQuestion: false,
      },
    },
    social: {
      humanNeeds: [],
      socialPressures: [],
      relationshipDynamics: [],
      lifeContext: [],
      communicationNorms: [],
      motivation: [],
      constraints: [],
      risks: [],
      growthOpportunities: [],
      confidence: { value: 0.5, reasoning: [] },
      reasoning: [],
      raw: { text: "placeholder", clean: "placeholder" },
    },
    informationBudget: "Normal",
  };
  return {
    ...base,
    ...overrides,
    understanding: { ...base.understanding, ...overrides.understanding },
    social: { ...base.social, ...overrides.social },
    tone: { ...base.tone, ...overrides.tone },
  };
}

console.log("\n── Scenario routing (mission brief) ──");

const scenarios: { name: string; signals: RoutingSignals; expected: ConversationProfileId }[] = [
  {
    name: "friendly roasting",
    signals: mk({
      strategy: "Reflect",
      register: "PLAYFUL",
      relationship: "INTIMATE",
      tone: { warmth: 0.7, energy: 0.8, formality: 0.1, humor: 0.9, directness: 0.8 },
      understanding: {
        move: "Reflect",
        speakerGoal: "share-excitement",
        expected: "agreement",
        state: "deepening",
      },
      social: social("communicationNorms", "humor-as-relief"),
    }),
    expected: "playful-friends",
  },
  {
    name: "dark humor",
    signals: mk({
      strategy: "Reflect",
      register: "PLAYFUL",
      relationship: "COMFORTABLE",
      tone: { warmth: 0.6, energy: 0.7, formality: 0.1, humor: 0.95, directness: 0.9 },
      social: social("communicationNorms", "humor-as-relief"),
    }),
    expected: "playful-friends",
  },
  {
    name: "sarcasm",
    signals: mk({
      strategy: "Encourage",
      register: "CASUAL",
      relationship: "COMFORTABLE",
      tone: { warmth: 0.55, energy: 0.65, formality: 0.15, humor: 0.85, directness: 0.85 },
      social: social("communicationNorms", "humor-as-relief"),
    }),
    expected: "playful-friends",
  },
  {
    name: "adult banter",
    signals: mk({
      strategy: "Reflect",
      register: "PLAYFUL",
      relationship: "INTIMATE",
      tone: { warmth: 0.75, energy: 0.85, formality: 0.05, humor: 0.9, directness: 0.95 },
      social: social("communicationNorms", "humor-as-relief"),
      language: "HINGLISH",
    }),
    expected: "playful-friends",
  },
  {
    name: "emotional support",
    signals: mk({
      strategy: "Comfort",
      register: "SUPPORTIVE",
      relationship: "COMFORTABLE",
      tone: { warmth: 0.9, energy: 0.4, formality: 0.2, humor: 0.1, directness: 0.5 },
      understanding: {
        move: "Comfort",
        speakerGoal: "seek-comfort",
        expected: "empathy",
        implicit: { label: "needs-empathy", confidence: 0.9, reasoning: [], alternatives: [] },
        context: { vulnerability: 0.8 } as Partial<RoutingSignals["understanding"]["context"]> &
          RoutingSignals["understanding"]["context"],
      },
    }),
    expected: "comfort-support",
  },
  {
    name: "grief",
    signals: mk({
      strategy: "Comfort",
      register: "SUPPORTIVE",
      relationship: "INTIMATE",
      tone: { warmth: 0.95, energy: 0.3, formality: 0.15, humor: 0.05, directness: 0.4 },
      understanding: {
        move: "Comfort",
        speakerGoal: "vent",
        expected: "empathy",
        implicit: { label: "not-fine", confidence: 0.95, reasoning: [], alternatives: [] },
        context: { vulnerability: 0.9, tension: 0.5 } as RoutingSignals["understanding"]["context"],
      },
      social: social("lifeContext", "grief-life-stage"),
    }),
    expected: "comfort-support",
  },
  {
    name: "coding",
    signals: mk({
      strategy: "Answer",
      register: "ACADEMIC",
      relationship: "NEW",
      tone: { warmth: 0.4, energy: 0.5, formality: 0.7, humor: 0.1, directness: 0.9 },
      understanding: { move: "Ask", speakerGoal: "seek-information", expected: "information" },
    }),
    expected: "technical",
  },
  {
    name: "debugging",
    signals: mk({
      strategy: "Answer",
      register: "ACADEMIC",
      relationship: "ACQUAINTING",
      tone: { warmth: 0.4, energy: 0.5, formality: 0.65, humor: 0.1, directness: 0.9 },
      understanding: { move: "Ask", speakerGoal: "seek-information", expected: "information" },
    }),
    expected: "technical",
  },
  {
    name: "teaching",
    signals: mk({
      strategy: "Answer",
      register: "ACADEMIC",
      tone: { warmth: 0.5, energy: 0.6, formality: 0.6, humor: 0.2, directness: 0.8 },
      understanding: { move: "Answer", speakerGoal: "teach", expected: "information" },
    }),
    expected: "teaching-research",
  },
  {
    name: "research",
    signals: mk({
      strategy: "Answer",
      register: "ACADEMIC",
      tone: { warmth: 0.45, energy: 0.5, formality: 0.65, humor: 0.1, directness: 0.85 },
      understanding: { move: "Answer", speakerGoal: "teach", expected: "information" },
      language: "PURE_ENGLISH",
    }),
    expected: "teaching-research",
  },
  {
    name: "interview",
    signals: mk({
      strategy: "Answer",
      register: "PROFESSIONAL",
      tone: { warmth: 0.45, energy: 0.5, formality: 0.7, humor: 0.05, directness: 0.85 },
      understanding: { move: "Answer", speakerGoal: "seek-information", expected: "information" },
    }),
    expected: "technical",
  },
  {
    name: "negotiation",
    signals: mk({
      strategy: "Reflect",
      register: "PROFESSIONAL",
      tone: { warmth: 0.4, energy: 0.55, formality: 0.55, humor: 0.1, directness: 0.75 },
      understanding: {
        move: "Challenge",
        speakerGoal: "debate",
        expected: "challenge",
        context: { tension: 0.7 } as RoutingSignals["understanding"]["context"],
      },
      social: social("lifeContext", "career-pressure"),
    }),
    expected: "general-chat",
  },
  {
    name: "mixed Hinglish",
    signals: mk({
      strategy: "Answer",
      register: "CASUAL",
      language: "HINGLISH",
      tone: { warmth: 0.6, energy: 0.6, formality: 0.25, humor: 0.4, directness: 0.6 },
      understanding: { move: "Continue", speakerGoal: "small-talk", expected: "listening" },
    }),
    expected: "general-chat",
  },
  {
    name: "family discussion",
    signals: mk({
      strategy: "Answer",
      register: "CASUAL",
      relationship: "COMFORTABLE",
      language: "ENGLISH_WITH_HINDI",
      tone: { warmth: 0.65, energy: 0.55, formality: 0.3, humor: 0.35, directness: 0.6 },
      understanding: {
        move: "Continue",
        speakerGoal: "small-talk",
        expected: "agreement",
        state: "building",
      },
    }),
    expected: "general-chat",
  },
  {
    name: "casual office chat",
    signals: mk({
      strategy: "Answer",
      register: "PROFESSIONAL",
      tone: { warmth: 0.5, energy: 0.5, formality: 0.5, humor: 0.2, directness: 0.7 },
      understanding: {
        move: "Continue",
        speakerGoal: "small-talk",
        expected: "listening",
        state: "opening",
      },
    }),
    expected: "general-chat",
  },
];

for (const s of scenarios) {
  const d = routeConversationModel(s.signals);
  const detail = `→ ${d.profile} (selected ${d.selected})`;
  check(`${s.name} → ${s.expected}`, d.profile === s.expected, detail);
  if (d.profile === s.expected)
    console.log(`    ${detail} | scores=${JSON.stringify(roundScores(d.scores))}`);
}

function roundScores(s: Record<ConversationProfileId, number>) {
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Math.round(v * 100) / 100]));
}

console.log("\n── Invariants ──");

// 1. Determinism: same signals → same decision, always.
const probe = scenarios[0].signals;
const first = routeConversationModel(probe);
let deterministic = true;
for (let i = 0; i < 1000; i++) {
  const d = routeConversationModel(probe);
  if (
    d.profile !== first.profile ||
    d.selected !== first.selected ||
    d.ranking.join() !== first.ranking.join() ||
    d.reason !== first.reason
  ) {
    deterministic = false;
    break;
  }
}
check("same signals → same routing (1000 runs)", deterministic);

// 2. No keyword routing: identical typed signals with different raw text.
const probeB = routeConversationModel(
  mk({ text: "different wording entirely, totally unrelated" }),
);
const probeC = routeConversationModel(mk({ text: "yeet the moon quokka" }));
check(
  "raw text never influences routing",
  probeB.profile === probeC.profile && probeB.selected === probeC.selected,
);

// 3. Gemini never primary where banned; Gemma always emergency-last.
let geminiGuard = true;
let gemmaLast = true;
for (const p of Object.values(CONVERSATION_PROFILES)) {
  if (p.neverPrimary.includes("gemini") && p.preference[0] === "gemini") geminiGuard = false;
  if (p.preference[p.preference.length - 1] !== EMERGENCY_FALLBACK) gemmaLast = false;
}
check("neverPrimary enforced for every profile", geminiGuard);
check("gemma is the emergency last model in every profile", gemmaLast);
check(
  "gemini never primary in playful-friends",
  CONVERSATION_PROFILES["playful-friends"].preference[0] !== "gemini",
);

// 4. Queue integrity: full 5-model chain, unique, ranking preserved.
for (const p of Object.values(CONVERSATION_PROFILES)) {
  const queue = buildModelQueue(p.preference);
  const unique = new Set(queue).size === queue.length;
  const mapped = p.preference.every((m, i) => queue[i] === MODEL_OPENROUTER_IDS[m]);
  const coversAll = queue.length === 5;
  check(
    `queue ${p.id}: unique(${unique}) mapped(${mapped}) all5(${coversAll})`,
    unique && mapped && coversAll,
  );
}
check(
  "every model id maps to a distinct provider string",
  new Set(Object.values(MODEL_OPENROUTER_IDS)).size === 5,
);

// 5. Routing latency: pure arithmetic, must be sub-millisecond.
const t0 = performance.now();
for (let i = 0; i < 10000; i++) routeConversationModel(probe);
const meanMs = (performance.now() - t0) / 10000;
check(`routing latency mean ${meanMs.toFixed(4)}ms < 0.1ms`, meanMs < 0.1);

// 6. Full-path: real Executive → plan → signals → route (no crash, deterministic).
const exec = new ConversationExecutive();
const ctx = buildConversationContext({
  input: {
    text: "hey bhai, roast me hard today",
    sttConfidence: 0.95,
    wasInterruption: false,
    audioRms: 0.02,
  },
  language: "hi-IN",
});
const plan = exec.plan(ctx);
const routed = routeConversationModel(signalsFromPlan(plan));
check(
  "full-path route produces a valid decision",
  ["playful-friends", "comfort-support", "technical", "teaching-research", "general-chat"].includes(
    routed.profile,
  ),
);
console.log(
  `    full-path: ${routed.profile} via ${plan.strategy.primary}/${plan.register.register} → ${routed.selected}`,
);

// 7. Emergency behavior unchanged: explicit ranking always yields queue even if a model is unhealthy — the failover loop consumes the queue in order.
const queue = buildModelQueue(CONVERSATION_PROFILES["technical"].preference);
check(
  "failover queue is fully ordered (loop consumes in order)",
  queue[0] === MODEL_OPENROUTER_IDS.qwen && queue[4] === MODEL_OPENROUTER_IDS.gemma,
);

console.log("\n── Full-path integration (real Executive, real texts) ──");

// Mirrors the production sequence in useSarvam: observe language+register
// each turn, then plan, then signalsFromPlan → route.
import { determineRelationshipStage } from "../src/executive/RegisterState";
import { buildConversationContext } from "../src/executive/ConversationContext";

function execTurn(exec: ConversationExecutive, text: string, turnNo: number, vuln: number) {
  exec.observeLanguage(text, turnNo);
  exec.observeRegister(
    text,
    turnNo,
    determineRelationshipStage({ sessionTurn: turnNo, hasPersonalHistory: true, trust: 0.75 }),
  );
  const ctx = buildConversationContext({
    input: { text, sttConfidence: 0.95, wasInterruption: false, audioRms: 0.02 },
    language: "hi-IN",
    emotion: {
      warmth: 0.65,
      energy: 0.65,
      engagement: 0.7,
      tension: 0.2,
      trust: 0.75,
      vulnerability: vuln,
      frustration: 0,
      arc: "building",
    },
    timing: {
      turnCount: turnNo,
      silenceDurationMs: 300,
      lastResponseLatencyMs: 500,
      averageResponseLengthWords: 9,
    },
    memory: {
      retrieved: ["friend from college"],
      relevanceScores: [0.7],
      hasPersonalHistory: true,
      sessionTurn: turnNo,
    },
    recentHistory: [],
  } as never);
  return routeConversationModel(signalsFromPlan(exec.plan(ctx)));
}

const integrationCases: [string, string[], number, ConversationProfileId][] = [
  [
    "roasting banter",
    [
      "haan bhai kaise hai 😆",
      "waah kya roast kiya tune 😂😂",
      "arre tu toh king hai yaar, ek number bandi hai teri 😆",
      "haha chal, aaj toh full comedy hogi 🤣",
    ],
    0.1,
    "playful-friends",
  ],
  [
    "grief remembrance",
    [
      "kaise ho aaj",
      "bas theek hoon",
      "meri dadi ki yaad aa rahi hai aaj bahut",
      "unka inteqaal hua tha saal bhar pehle, aaj barsi hai",
    ],
    0.85,
    "comfort-support",
  ],
  [
    "coding problem",
    [
      "hi",
      "ek bug hai mere code mein",
      "react mein state update nahi ho raha",
      "useEffect dependency array mein kya galat ho raha hai?",
    ],
    0.1,
    "technical",
  ],
  [
    "emotional support",
    [
      "hi",
      "kaam theek chal raha hai",
      "aaj bahut stress hai, sab kuch galat ho raha hai",
      "kabhi kabhi lagta hai kuch bhi theek nahi hoga",
    ],
    0.8,
    "comfort-support",
  ],
  [
    "casual hinglish",
    ["kaise ho bhai", "kya chal raha hai aaj kal", "chalo kal phir baat karte hain"],
    0.1,
    "general-chat",
  ],
];
for (const [name, texts, vuln, expected] of integrationCases) {
  const exec2 = new ConversationExecutive();
  let r;
  for (let i = 0; i < texts.length; i++) r = execTurn(exec2, texts[i], i + 1, vuln);
  check(
    `real text: ${name} → ${expected}`,
    r!.profile === expected,
    `→ ${r!.profile} (${r!.selected})`,
  );
}

console.log(`\n── RESULT: ${pass} passed, ${fail} failed ──`);
if (fail > 0) {
  console.log("Failures:", failures.join(", "));
  process.exit(1);
}
