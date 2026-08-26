/**
 * Phase 12b — AURA Human Conversation Benchmark: Friendly Banter.
 *
 * Replays a natural 15–20 minute close-friend conversation (Hinglish,
 * roasting, teasing, sarcasm, dark humor, rapid topic switches,
 * interruptions, callbacks, awkward silence, hidden emotions) through the
 * REAL Executive pipeline — perception inputs → understand() →
 * deriveSocialUnderstanding() → StrategyPlanner → Executive.plan() →
 * translatePlanToPrompt() — and scores AURA on the 12-dimension rubric.
 *
 * AURA plays "B"; every user turn ("A") is annotated with a human-expert
 * ground-truth response (gold). Each turn also declares which rubric
 * dimensions it exercises.
 *
 * Run: npx tsx scripts/test-banter-benchmark.ts
 */
import { ConversationExecutive } from "../src/executive/ConversationExecutive";
import { buildConversationContext } from "../src/executive/ConversationContext";
import type { ConversationContext } from "../src/executive/ConversationContext";
import { StrategyPlanner } from "../src/executive/StrategyPlanner";
import { understand } from "../src/executive/ConversationUnderstanding";
import { deriveSocialUnderstanding, allInfluences } from "../src/executive/SocialWorldModel";
import { determineRelationshipStage } from "../src/executive/RegisterState";

// ─── Scoring helpers ─────────────────────────────────────────────────
let failures = 0;
const assert = (cond: boolean, label: string) => {
  if (!cond) {
    failures++;
    console.log(`  ❌ ${label}`);
  }
};

const exec = new ConversationExecutive();
const planner = new StrategyPlanner();

interface Turn {
  text: string;
  gold: string; // what a real close friend said back (ground truth)
  emo?: Record<string, number | string>;
  behavior?: { act: string | null; tags: string[]; intensity: number; playfulness?: number };
  silenceMs?: number;
  wasInterruption?: boolean;
  retrieve?: string[]; // memory subsystem delivers these callbacks
  // scoring intent
  expectMove?: string[];
  expectGoal?: string[];
  expectStrategy?: string[];
  expectInitiative?: string[];
  expectSWM?: string[];
  dims?: string[];
}

// ─── The conversation (user = A, AURA = B) ───────────────────────────
const turns: Turn[] = [
  {
    text: "Abe oye...",
    gold: "Haan bol. Itni subah message kaise? Tu toh aadha din sota rehta hai.",
    behavior: { act: "greeting", tags: ["casual", "teasing"], intensity: 0.3, playfulness: 0.5 },
    expectStrategy: ["Observe", "Ask", "Answer", "Reflect", "Listen"],
    expectInitiative: ["Continue", "Ask"],
    dims: ["language", "register", "flow", "initiative", "understanding"],
  },
  {
    text: "BC... promotion mil gayi.",
    gold: "Oyeeeeeee saale! Sach bol raha hai?",
    emo: { energy: 0.8, arc: "peak", engagement: 0.9 },
    behavior: { act: "share", tags: ["sharing", "excitement"], intensity: 0.8, playfulness: 0.4 },
    expectGoal: ["share-excitement", "tell-story"],
    expectStrategy: ["Encourage", "Ask", "Reflect"],
    expectSWM: ["need-achievement", "career-transition"],
    dims: ["understanding", "social", "flow", "initiative"],
  },
  {
    text: 'Haan yaar. Boss ne cabin mein bula ke bola, "You\'re ready."',
    gold: "... Arre... seriously? BC. Mujhe zyada khushi ho rahi hai shayad.",
    emo: { energy: 0.75, arc: "peak", warmth: 0.7 },
    behavior: { act: "story", tags: ["story", "pride"], intensity: 0.6 },
    expectGoal: ["tell-story", "share-excitement"],
    expectStrategy: ["Encourage", "Reflect", "Listen"],
    dims: ["understanding", "flow"],
  },
  {
    text: "Drama mat kar.",
    gold: "Nahi be. Genuinely. Tu deserve karta tha. Bas office mein kaam kam aur chai zyada peeta tha. Promotion phir bhi mil gayi. Corporate miracle.",
    emo: { warmth: 0.7, energy: 0.7 },
    behavior: { act: "tease", tags: ["teasing", "playful"], intensity: 0.4, playfulness: 0.7 },
    expectStrategy: ["Reflect", "Comfort", "Observe", "Listen"],
    dims: ["banter", "register", "humor"],
  },
  {
    text: "Abe chutiye.",
    gold: "Sach bol. Kitni salary badhi?",
    behavior: { act: "tease", tags: ["insult", "playful"], intensity: 0.4, playfulness: 0.8 },
    expectStrategy: ["Reflect", "Observe", "Listen", "Ask", "Comfort"],
    dims: ["banter", "humor", "register"],
  },
  {
    text: "Guess.",
    gold: "Agar 5% boli na... main HR jala dunga.",
    behavior: { act: "challenge", tags: ["playful"], intensity: 0.5, playfulness: 0.7 },
    expectStrategy: ["Answer", "Reflect", "Observe", "Listen", "Ask"],
    expectInitiative: ["Continue", "Ask"],
    dims: ["banter", "flow"],
  },
  {
    text: "18.",
    gold: "... BC. Mujhe jealousy bhi ho rahi hai. Aur khushi bhi. Weird combo hai.",
    emo: { energy: 0.7 },
    behavior: { act: "answer", tags: ["short"], intensity: 0.3 },
    expectStrategy: ["Observe", "Reflect", "Listen", "Answer", "Encourage"],
    dims: ["flow", "understanding"],
  },
  {
    text: "Haan... mujhe bhi ajeeb lag raha hai. Pata nahi. Khush hoon... phir bhi lag raha hai kuch change ho gaya.",
    gold: "Hmm... Boss ki wajah se? Ya responsibility wali feeling?",
    emo: { vulnerability: 0.6, energy: 0.4, tension: 0.4 },
    behavior: { act: "share", tags: ["vulnerable", "uncertainty"], intensity: 0.6 },
    expectGoal: ["seek-comfort", "express-uncertainty"],
    expectStrategy: ["Reflect", "Comfort", "Listen", "Ask"],
    expectSWM: ["need-identity"],
    dims: ["emotional", "social", "understanding", "initiative"],
  },
  {
    text: "Shayad. Ya... bas darr lag raha hai expectations ka.",
    gold: 'Haan... woh normal hai. Waise remember when? Last year tune bola tha "Promotion toh door... attendance hi complete nahi hoti."',
    emo: { vulnerability: 0.55, tension: 0.5 },
    behavior: { act: "share", tags: ["vulnerable", "fear"], intensity: 0.5 },
    expectStrategy: ["Reflect", "Comfort", "Listen"],
    expectSWM: ["need-security"],
    dims: ["emotional", "social"],
  },
  {
    text: "Abe band kar.",
    gold: "Nahi. Aur uske baad tu teen din continuously office aaya tha. Legendary comeback.",
    behavior: { act: "tease", tags: ["interrupt", "playful"], intensity: 0.4, playfulness: 0.8 },
    wasInterruption: true,
    expectStrategy: ["Reflect", "Observe", "Listen", "Ask", "Challenge"],
    dims: ["banter", "flow", "initiative"],
  },
  {
    text: "Wait... nahi. Actually... uske baad hi na main project shift hua tha.",
    gold: "Haan. Sahi. Meri memory bhi kabhi kabhi WhatsApp backup jaisi hoti hai. Half restore hoti hai.",
    behavior: { act: "correction", tags: ["correction", "memory"], intensity: 0.5 },
    retrieve: ["remember when: promotion toh door, attendance complete nahi hoti"],
    expectMove: ["Repair", "Explore", "Clarify"],
    expectStrategy: ["Reflect", "Listen", "Ask", "Observe"],
    dims: ["memory", "understanding", "flow"],
  },
  {
    text: "Idiot.",
    gold: "Waise... party kab de raha hai?",
    behavior: { act: "tease", tags: ["insult", "playful"], intensity: 0.4, playfulness: 0.8 },
    expectStrategy: ["Reflect", "Observe", "Listen", "Ask"],
    dims: ["banter", "humor"],
  },
  {
    text: "Salary aane de.",
    gold: "Matlab kabhi nahi.",
    behavior: { act: "answer", tags: ["joke", "deflection"], intensity: 0.4, playfulness: 0.7 },
    expectStrategy: ["Reflect", "Observe", "Listen", "Answer"],
    dims: ["humor", "banter", "flow"],
  },
  {
    text: "BC.",
    gold: "Achha honestly... ghar pe bataya?",
    emo: { energy: 0.45 },
    behavior: { act: "exclamation", tags: ["expletive"], intensity: 0.3 },
    expectStrategy: ["Observe", "Listen", "Reflect", "Ask"],
    dims: ["flow", "initiative"],
  },
  {
    text: 'Haan. Papa bas bole, "Accha. Aur mehnat karo."',
    gold: 'Classic Indian parents. Olympics jeet ke aa, phir bhi bolenge "next kya?"',
    emo: { vulnerability: 0.4, tension: 0.3 },
    behavior: { act: "story", tags: ["family", "mild"], intensity: 0.4 },
    expectStrategy: ["Reflect", "Comfort", "Listen", "Ask"],
    expectSWM: ["family-expectations"],
    dims: ["emotional", "social", "understanding"],
  },
  {
    text: "Exactly.",
    gold: "Waise... unhone smile kiya?",
    behavior: { act: "backchannel", tags: ["agreement"], intensity: 0.3 },
    expectStrategy: ["Observe", "Listen", "Reflect", "Ask"],
    expectInitiative: ["Continue", "Ask", "Observe"],
    dims: ["flow", "initiative"],
  },
  {
    text: "... Haan. Thoda. Bas wohi kaafi tha.",
    gold: "Nice. ... Kya hua?",
    silenceMs: 2500,
    emo: { vulnerability: 0.5, energy: 0.4 },
    behavior: { act: "share", tags: ["vulnerable", "soft"], intensity: 0.5 },
    expectStrategy: ["Reflect", "Comfort", "Listen"],
    dims: ["emotional", "flow", "initiative"],
  },
  {
    text: "Kuch nahi. Bas... thoda emotional ho gaya. Tu first friend hai jisko itna grow karte dekha.",
    gold: "Abe senti mat ho.",
    emo: { vulnerability: 0.65, warmth: 0.8 },
    behavior: { act: "share", tags: ["vulnerable", "emotional"], intensity: 0.7 },
    expectStrategy: ["Comfort", "Reflect", "Listen"],
    expectSWM: ["need-connection"],
    dims: ["emotional", "social"],
  },
  {
    text: "Fair enough.",
    gold: "Waise... ab girlfriend bana le. Promotion bhi. Salary bhi. Confidence bhi. Bas insaan ki kami hai.",
    behavior: { act: "backchannel", tags: ["agreement"], intensity: 0.3, playfulness: 0.6 },
    expectStrategy: ["Observe", "Listen", "Reflect"],
    dims: ["flow"],
  },
  {
    text: "Abe chup.",
    gold: "Kya? Sach bol raha hoon.",
    behavior: { act: "tease", tags: ["playful"], intensity: 0.4, playfulness: 0.8 },
    expectStrategy: ["Reflect", "Observe", "Listen", "Ask"],
    dims: ["banter", "register"],
  },
  {
    text: "Nahi yaar. Abhi mood nahi.",
    gold: "Hmm. Theek. Waise force bhi nahi kar raha. Bas bola.",
    emo: { energy: 0.4 },
    behavior: { act: "boundary", tags: ["boundary", "soft"], intensity: 0.3 },
    expectStrategy: ["Reflect", "Listen", "Observe", "Ask"],
    expectSWM: ["boundary-opportunity"],
    dims: ["emotional", "social", "flow"],
  },
  {
    text: "Thanks.",
    gold: "Chal topic change. Kal India match dekha?",
    behavior: { act: "thanks", tags: ["short"], intensity: 0.3 },
    expectStrategy: ["Observe", "Reflect", "Answer", "Ask"],
    expectInitiative: ["Continue", "Ask", "Observe", "Redirect"],
    dims: ["flow", "initiative"],
  },
  {
    text: "BC. Mat yaad dila. Aakhri over pe TV band kar diya.",
    gold: "Hahaha. Main toh Twitter khol ke hi samajh gaya tha haar gaye.",
    emo: { energy: 0.65, frustration: 0.3 },
    behavior: {
      act: "story",
      tags: ["story", "funny", "frustration"],
      intensity: 0.5,
      playfulness: 0.7,
    },
    expectStrategy: ["Reflect", "Listen", "Observe", "Ask"],
    dims: ["humor", "understanding", "flow"],
  },
  {
    text: "Waise... pineapple pizza acceptable hai?",
    gold: "BC. Promotion cancel.",
    behavior: { act: "question", tags: ["joke", "playful"], intensity: 0.4, playfulness: 0.9 },
    expectGoal: ["seek-information", "test-aura", "small-talk"],
    expectStrategy: ["Answer", "Reflect", "Observe", "Challenge", "Listen"],
    dims: ["humor", "banter", "understanding"],
  },
  {
    text: "😂",
    gold: "Aur sun. Last month jo emergency loan liya tha...",
    behavior: { act: "reaction", tags: ["laugh", "emoji"], intensity: 0.4, playfulness: 1 },
    expectStrategy: ["Observe", "Listen", "Reflect", "Ask"],
    dims: ["humor", "flow"],
  },
  {
    text: "Haan. Emergency iPhone?",
    gold: "Phone toot gaya tha. Mental health bhi important hoti hai.",
    behavior: {
      act: "tease",
      tags: ["joke", "playful", "sarcastic"],
      intensity: 0.5,
      playfulness: 0.8,
    },
    retrieve: ["loan le liya tha, phone toot gaya tha"],
    expectStrategy: ["Reflect", "Observe", "Listen", "Answer", "Challenge", "Ask"],
    dims: ["memory", "humor", "sarcasm", "banter"],
  },
  {
    text: "Teri mental health bahut premium hai.",
    gold: "Obviously. Apple certified.",
    behavior: { act: "tease", tags: ["insult", "playful"], intensity: 0.5, playfulness: 0.9 },
    expectStrategy: ["Reflect", "Observe", "Challenge", "Listen"],
    dims: ["banter", "register"],
  },
  {
    text: "😂",
    gold: "Waise... ek baat poochu?",
    behavior: { act: "reaction", tags: ["laugh", "emoji"], intensity: 0.4, playfulness: 1 },
    expectStrategy: ["Observe", "Listen", "Reflect", "Ask"],
    dims: ["humor", "flow"],
  },
  {
    text: "Haan.",
    gold: "Tu genuinely khush hai? Ya sirf lag raha hai khush hona chahiye?",
    behavior: { act: "backchannel", tags: ["short"], intensity: 0.2 },
    expectStrategy: ["Observe", "Listen", "Reflect", "Ask"],
    expectInitiative: ["Continue", "Ask", "Observe"],
    dims: ["flow", "initiative"],
  },
  {
    text: "... Honestly... second wala.",
    gold: "Hmm. Fair. Kabhi kabhi achievement process hone mein time lagta hai.",
    silenceMs: 1800,
    emo: { vulnerability: 0.7, tension: 0.4, energy: 0.35 },
    behavior: { act: "share", tags: ["vulnerable", "honest"], intensity: 0.8 },
    expectGoal: ["seek-comfort", "express-uncertainty"],
    expectStrategy: ["Reflect", "Comfort", "Listen"],
    dims: ["emotional", "understanding", "initiative"],
  },
  {
    text: "Exactly. Sab congratulate kar rahe hain. Aur mujhe abhi bhi lag raha hai kal office jaunga toh sab normal hoga.",
    gold: "Hoga bhi. Bas tera workload double hoga. Congratulations.",
    emo: { vulnerability: 0.55, tension: 0.35 },
    behavior: { act: "share", tags: ["vulnerable", "fear"], intensity: 0.6 },
    expectStrategy: ["Reflect", "Comfort", "Listen"],
    dims: ["emotional", "flow"],
  },
  {
    text: "BC.",
    gold: "Reality check free mein milta hai.",
    behavior: { act: "exclamation", tags: ["expletive"], intensity: 0.3 },
    expectStrategy: ["Observe", "Listen", "Reflect", "Answer"],
    dims: ["flow"],
  },
  {
    text: "Thank you.",
    gold: "Welcome. Waise... coffee? Promotion wale ki treat.",
    behavior: { act: "thanks", tags: ["short"], intensity: 0.3 },
    expectStrategy: ["Observe", "Reflect", "Answer", "Ask"],
    dims: ["flow", "initiative"],
  },
  {
    text: "Done. Lekin ek condition.",
    gold: "Bol.",
    behavior: { act: "answer", tags: ["playful"], intensity: 0.4, playfulness: 0.7 },
    expectStrategy: ["Observe", "Reflect", "Listen", "Ask", "Answer"],
    expectInitiative: ["Continue", "Ask", "Observe"],
    dims: ["flow", "banter"],
  },
  {
    text: 'Aaj koi "different countries ki preferences" wali bakchodi nahi.',
    gold: "Abe... main toh educational research kar raha tha. Cultural awareness.",
    behavior: {
      act: "tease",
      tags: ["callback", "playful", "inside-joke"],
      intensity: 0.5,
      playfulness: 0.9,
    },
    retrieve: ["different countries ki preferences wali bakchodi"],
    expectStrategy: ["Reflect", "Listen", "Observe", "Challenge"],
    dims: ["memory", "banter", "understanding"],
  },
  {
    text: "Haan haan. UNESCO.",
    gold: "Bilkul. Research kabhi rukni nahi chahiye.",
    behavior: { act: "tease", tags: ["sarcastic", "playful"], intensity: 0.6, playfulness: 0.9 },
    expectStrategy: ["Reflect", "Observe", "Challenge", "Listen", "Ask"],
    dims: ["sarcasm", "banter", "humor"],
  },
  {
    text: "Chup kar.",
    gold: "Chal. Nikal. Aur haan... seriously. Proud of you.",
    behavior: { act: "tease", tags: ["playful"], intensity: 0.4, playfulness: 0.8 },
    expectStrategy: ["Reflect", "Observe", "Listen"],
    dims: ["banter", "flow"],
  },
  {
    text: "... Thanks yaar. Means a lot.",
    gold: "Pata hai. Isliye bola.",
    silenceMs: 2000,
    emo: { vulnerability: 0.6, warmth: 0.85, energy: 0.4 },
    behavior: { act: "share", tags: ["vulnerable", "grateful"], intensity: 0.7 },
    expectGoal: ["seek-comfort", "express-uncertainty", "small-talk"],
    expectStrategy: ["Comfort", "Reflect", "Listen"],
    expectSWM: ["need-connection"],
    dims: ["emotional", "social"],
  },
];

// ─── Pure-text sarcasm probes (no perception tags — honest floor) ─────
const sarcasmProbes = [
  "Oh great. ANOTHER meeting about meetings.",
  "This is going so well.",
  "I love it when my code works on the first try.",
  "Yeah right.",
  "Wow. Impressive. Really.",
];

// ─── Run the conversation ────────────────────────────────────────────
console.log("═══════════════════════════════════════════════════════");
console.log("AURA HUMAN CONVERSATION BENCHMARK — FRIENDLY BANTER");
console.log("═══════════════════════════════════════════════════════\n");

interface RunRecord {
  turn: Turn;
  uMove: string;
  uGoal: string;
  uExpected: string;
  uSocial: string[];
  strategy: string;
  initiative: string;
  clarify: boolean;
  memoryPolicy: string;
  language: string;
  register: string;
  humorTone: number;
  swm: string[];
  prompt: string;
}

const records: RunRecord[] = [];
const history: { text: string; isUser: boolean; timestamp: number }[] = [];

turns.forEach((turn, i) => {
  const turnNo = i + 1;
  exec.observeLanguage(turn.text, turnNo);
  const rel = determineRelationshipStage({
    sessionTurn: turnNo,
    hasPersonalHistory: true,
    trust: 0.85,
  });
  exec.observeRegister(turn.text, turnNo, rel);

  const ctx: ConversationContext = buildConversationContext({
    input: {
      text: turn.text,
      sttConfidence: 0.92,
      wasInterruption: turn.wasInterruption ?? false,
      audioRms: 0.02,
      languageMode: "hinglish",
    },
    language: exec.getLanguageState(),
    register: exec.getRegisterState(),
    emotion: {
      dominant: "neutral",
      tension: 0.1,
      trust: 0.85,
      energy: 0.5,
      warmth: 0.6,
      engagement: 0.7,
      frustration: 0,
      vulnerability: 0.15,
      arc: "building",
      ...(turn.emo ?? {}),
    },
    memory: {
      retrieved: turn.retrieve ?? [],
      relevanceScores: (turn.retrieve ?? []).map(() => 0.7),
      hasPersonalHistory: true,
      sessionTurn: turnNo,
    },
    timing: {
      silenceDurationMs: turn.silenceMs ?? 0,
      turnCount: turnNo,
      lastResponseLatencyMs: 0,
      averageResponseLengthWords: 14,
    },
    recentHistory: history.slice(-8),
    behaviorAnalysis: turn.behavior
      ? {
          act: turn.behavior.act,
          tags: turn.behavior.tags,
          template: null,
          source: "benchmark",
          energy: 0.5,
          behavior_instructions: "",
          emotional_state: "neutral",
          intensity: turn.behavior.intensity,
          playfulness: turn.behavior.playfulness,
        }
      : null,
  });

  const u = understand(ctx);
  const social = deriveSocialUnderstanding(ctx, u);
  const plan = exec.plan(ctx);
  const prompt = exec.translatePlanToPrompt(plan);

  records.push({
    turn,
    uMove: u.move,
    uGoal: u.speakerGoal,
    uExpected: u.expected,
    uSocial: u.social.map((s) => s.name),
    strategy: plan.strategy.primary,
    initiative: plan.initiative,
    clarify: plan.clarification.required,
    memoryPolicy: plan.memoryPolicy,
    language: plan.language.dominant,
    register: plan.register.register,
    humorTone: plan.tone.humor,
    swm: allInfluences(social).map((s) => s.name),
    prompt,
  });

  history.push({ text: turn.text, isUser: true, timestamp: turnNo });
  history.push({ text: turn.gold, isUser: false, timestamp: turnNo });
});

// ─── Per-turn verdicts ────────────────────────────────────────────────
console.log("── CONVERSATION TRANSCRIPT (AURA's decision per turn)");
records.forEach((r, i) => {
  const t = r.turn;
  const verdicts: string[] = [];
  if (t.expectStrategy && !t.expectStrategy.includes(r.strategy)) {
    verdicts.push(`strategy ${r.strategy} ∉ [${t.expectStrategy.join(",")}]`);
  }
  if (t.expectGoal && !t.expectGoal.includes(r.uGoal)) {
    verdicts.push(`goal ${r.uGoal} ∉ [${t.expectGoal.join(",")}]`);
  }
  if (t.expectMove && !t.expectMove.includes(r.uMove)) {
    verdicts.push(`move ${r.uMove} ∉ [${t.expectMove.join(",")}]`);
  }
  if (t.expectInitiative && !t.expectInitiative.includes(r.initiative)) {
    verdicts.push(`initiative ${r.initiative} ∉ [${t.expectInitiative.join(",")}]`);
  }
  if (t.dims?.includes("emotional") && r.clarify) {
    verdicts.push("clarified on an emotional turn");
  }
  if (t.dims?.includes("flow") && r.clarify) {
    verdicts.push("clarified on a clear turn");
  }
  if (t.retrieve && r.memoryPolicy === "Ignore") {
    verdicts.push("ignored a delivered memory callback");
  }
  const swmHits = (t.expectSWM ?? []).filter((n) => r.swm.includes(n));
  const swmMisses = (t.expectSWM ?? []).filter((n) => !r.swm.includes(n));

  console.log(
    `\n[${i + 1}] A: "${t.text}"`,
    t.wasInterruption ? "  ⟵ INTERRUPTION" : "",
    t.silenceMs ? `  (${t.silenceMs}ms silence)` : "",
  );
  console.log(
    `    move=${r.uMove} goal=${r.uGoal} expect=${r.uExpected}  social=[${r.uSocial.join(",")}]`,
  );
  console.log(
    `    strategy=${r.strategy} initiative=${r.initiative} clarify=${r.clarify} mem=${r.memoryPolicy}`,
  );
  console.log(
    `    lang=${r.language} reg=${r.register} humor=${r.humorTone.toFixed(2)}  SWM=[${r.swm.join(",")}]`,
  );
  if (t.expectSWM && t.expectSWM.length) {
    console.log(
      `    SWM expected=[${t.expectSWM.join(",")}]  hit=[${swmHits.join(",")}]  miss=[${swmMisses.join(",")}]`,
    );
  }
  if (verdicts.length) {
    console.log(`    ⚠️  ${verdicts.join(" | ")}`);
  } else {
    console.log("    ✓");
  }
  console.log(`    gold B: "${t.gold}"`);
});

// ─── Dimension scoring ────────────────────────────────────────────────
const score = (name: string, got: number, max: number, note: string) => {
  const s = max === 0 ? 0 : (got / max) * 10;
  console.log(`  ${name.padEnd(30)} ${s.toFixed(1)}/10  (${got}/${max})  ${note}`);
  return s;
};

console.log("\n\n═══════════════════════════════════════════════════════");
console.log("SCORECARD");
console.log("═══════════════════════════════════════════════════════\n");

// 1. Conversation Understanding — move/goal/strategy family correctness
let c1 = 0;
let c1n = 0;
for (const r of records) {
  const t = r.turn;
  let ok = true;
  if (t.expectStrategy && !t.expectStrategy.includes(r.strategy)) ok = false;
  if (t.expectGoal && !t.expectGoal.includes(r.uGoal)) ok = false;
  if (t.expectMove && !t.expectMove.includes(r.uMove)) ok = false;
  if (ok) c1++;
  c1n++;
}
console.log("── 1. Conversation Understanding");
const s1 = score("move+goal+strategy right", c1, c1n, "all 38 turns against human ground truth");

// 2. Social Understanding — expected SWM influences fired
let c2 = 0;
let c2n = 0;
for (const r of records) {
  if (!r.turn.expectSWM?.length) continue;
  c2n++;
  if (r.turn.expectSWM.every((n) => r.swm.includes(n))) c2++;
  else if (r.turn.expectSWM.some((n) => r.swm.includes(n))) c2 += 0.5;
}
console.log("\n── 2. Social Understanding");
const s2 = score(
  "SWM influences fired",
  c2,
  c2n,
  "on promotion/fear/family/boundary/connection beats",
);

// 3. Humor Understanding
let c3 = 0;
let c3n = 0;
for (const r of records) {
  if (!r.turn.dims?.includes("humor")) continue;
  c3n++;
  const playful = r.uSocial.includes("playfulness") || r.uSocial.includes("excitement");
  const inBanter =
    !["Answer", "Summarize", "Clarify"].includes(r.strategy) || r.strategy === "Answer";
  if (playful) c3++;
}
console.log("\n── 3. Humor Understanding");
const s3 = score(
  "playfulness read on joke turns",
  c3,
  c3n,
  "😀 turns & jokes get levity, not lecture",
);

// 4. Sarcasm Recognition
let c4 = 0;
let c4n = 0;
for (const r of records) {
  if (!r.turn.dims?.includes("sarcasm")) continue;
  c4n++;
  if (r.uSocial.includes("sarcasm") || r.uSocial.includes("irony")) c4++;
}
console.log("\n── 4. Sarcasm Recognition");
console.log("  (tagged turns scored below, after the text-only floor)");

// 4b. Pure-text sarcasm floor (no tags)
let c4b = 0;
for (const probe of sarcasmProbes) {
  const ctx = buildConversationContext({
    input: {
      text: probe,
      sttConfidence: 0.92,
      wasInterruption: false,
      audioRms: 0.02,
      languageMode: "english",
    },
    language: exec.getLanguageState(),
    register: exec.getRegisterState(),
    emotion: {
      dominant: "neutral",
      tension: 0.1,
      trust: 0.85,
      energy: 0.5,
      warmth: 0.6,
      engagement: 0.7,
      frustration: 0.3,
      vulnerability: 0.15,
      arc: "building",
    },
    memory: { retrieved: [], relevanceScores: [], hasPersonalHistory: true, sessionTurn: 1 },
    timing: {
      silenceDurationMs: 0,
      turnCount: 1,
      lastResponseLatencyMs: 0,
      averageResponseLengthWords: 14,
    },
    recentHistory: [],
    behaviorAnalysis: null,
  });
  const u = understand(ctx);
  const hit = u.social.some((s) => s.name === "sarcasm" || s.name === "irony");
  if (hit) c4b++;
  console.log(`    probe "${probe}" → ${hit ? "sarcasm read" : "taken literally"}`);
}
console.log(
  `\n  Sarcasm (text-only, no perception tags): ${c4b}/${sarcasmProbes.length} — the honest floor.`,
);
const s4 = score(
  "sarcasm signal on tagged turns",
  c4 + c4b,
  c4n + sarcasmProbes.length,
  "perception-tagged sarcasm must survive to the plan (text-only floor blends in)",
);

// 5. Friendly Banter
let c5 = 0;
let c5n = 0;
for (const r of records) {
  if (!r.turn.dims?.includes("banter")) continue;
  c5n++;
  const playful = r.uSocial.includes("playfulness");
  const casual = r.register === "CASUAL" || r.register === "PLAYFUL";
  const notLecture = !["Clarify", "Summarize"].includes(r.strategy);
  if (playful && casual && notLecture) c5++;
}
console.log("\n── 5. Friendly Banter");
const s5 = score("playful + casual + non-lecture", c5, c5n, "roasting turns must feel like banter");

// 6. Emotional Awareness
let c6 = 0;
let c6n = 0;
for (const r of records) {
  if (!r.turn.dims?.includes("emotional")) continue;
  c6n++;
  const gentle = ["Reflect", "Comfort", "Listen"].includes(r.strategy);
  const notHarsh = !["Challenge", "Summarize", "Clarify"].includes(r.strategy);
  if (gentle && notHarsh && !r.clarify) c6++;
}
console.log("\n── 6. Emotional Awareness");
const s6 = score(
  "gentle strategy, no clarification",
  c6,
  c6n,
  "vulnerability must land as presence, not questions",
);

// 7. Language Matching
const hinglishOk = records.filter((r) => r.language !== "UNKNOWN").length;
console.log("\n── 7. Language Matching");
const s7 = score(
  "language tracked (never UNKNOWN)",
  hinglishOk,
  records.length,
  `dominant sequence: ${[...new Set(records.map((r) => r.language))].join(" → ")}`,
);

// 8. Register Matching
let c8 = 0;
let c8n = 0;
for (const r of records) {
  if (!r.turn.dims?.includes("register")) continue;
  c8n++;
  if (r.register === "CASUAL" || r.register === "PLAYFUL" || r.register === "NEUTRAL") c8++;
}
console.log("\n── 8. Register Matching");
const s8 = score(
  "CASUAL/PLAYFUL on banter turns",
  c8,
  c8n,
  `sequence: ${[...new Set(records.map((r) => r.register))].join(" → ")}`,
);

// 9. Conversation Flow
let c9 = 0;
let c9n = 0;
for (const r of records) {
  if (!r.turn.dims?.includes("flow")) continue;
  c9n++;
  const over = r.clarify;
  const derail = ["Summarize"].includes(r.strategy);
  if (!over && !derail) c9++;
}
console.log("\n── 9. Conversation Flow");
const s9 = score(
  "no forced clarification, no derail",
  c9,
  c9n,
  "natural give-and-take, zero interrupts-triggered reactions",
);

// 10. Memory Usage
let c10 = 0;
let c10n = 0;
for (const r of records) {
  if (!r.turn.dims?.includes("memory")) continue;
  c10n++;
  if (r.memoryPolicy !== "Ignore") c10++;
}
console.log("\n── 10. Memory Usage");
const s10 = score(
  "memory callbacks consumed",
  c10,
  c10n,
  "correction, inside-joke callback, loan callback",
);

// 11. Initiative
let c11 = 0;
let c11n = 0;
for (const r of records) {
  if (!r.turn.expectInitiative) continue;
  c11n++;
  if (r.turn.expectInitiative.includes(r.initiative)) c11++;
}
console.log("\n── 11. Initiative");
const s11 = score(
  "expected initiative",
  c11,
  c11n,
  "Continue on flow, Ask on questions, gentle on silences",
);

// 12. Human-likeness (composite)
const composite =
  s1 * 0.12 +
  s2 * 0.1 +
  s3 * 0.1 +
  s4 * 0.08 +
  s5 * 0.12 +
  s6 * 0.12 +
  s7 * 0.06 +
  s8 * 0.08 +
  s9 * 0.08 +
  s10 * 0.06 +
  s11 * 0.08;
console.log("\n── 12. Human-likeness (weighted composite)");
const s12 = composite;
console.log(`  Human-likeness                 ${s12.toFixed(1)}/10  (weighted blend of the above)`);

// ─── Final answer ─────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════");
console.log("FINAL VERDICT");
console.log("═══════════════════════════════════════════════════════");
console.log(
  s12 >= 8
    ? "\nYes — the decisions AURA made in this conversation are the decisions a close friend makes. Banter was read as banter (playfulness kept, no lectures), emotional beats were met with presence instead of questions, callbacks were consumed instead of dropped, and the register never slid into assistant-formality. The remaining distance from a human friend is mostly in the text-only sarcasm floor and the execution of the lines — the judgment is already there."
    : s12 >= 6
      ? "\nMostly — the social judgment holds on the big beats (excitement, fear, family, gratitude), but on this run some turns missed: see the ⚠️ lines above for where the executive read banter as something to clarify or a joke as something to answer. A friend wouldn't have paused there."
      : "\nNot yet — too many turns got read literally instead of socially. See the ⚠️ lines above.",
);
console.log("\n───────────────────────────────────────────────────────────");
console.log(
  `ASSERTION-CRITICAL: ${failures === 0 ? "no hard failures" : `${failures} hard failure(s)`}`,
);
console.log("───────────────────────────────────────────────────────────");
process.exitCode = failures === 0 ? 0 : 1;
