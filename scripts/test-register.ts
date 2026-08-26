/**
 * Phase 8.1 Verification — AURA Conversational Register & Identity.
 *
 * The LLM never infers register; the Executive owns it, exactly like
 * language. For every scenario this suite verifies the deterministic
 * chain:
 *   Detected Register  → classifyRegisterObservation (heuristics, no LLM)
 *   Conversation Register → RegisterMomentumEngine (momentum + inertia)
 *   Relationship Stage → determineRelationshipStage (ladder gating)
 *   Prompt Register     → executive.translatePlanToPrompt (directive)
 *   Plan Consistency    → plan.register === executive state (single source)
 *
 * Run: npx tsx scripts/test-register.ts
 */
import { ConversationExecutive } from "../src/executive/ConversationExecutive";
import { buildConversationContext } from "../src/executive/ConversationContext";
import {
  classifyRegisterObservation,
  determineRelationshipStage,
  type ConversationRegister,
  type RelationshipStage,
} from "../src/executive/RegisterState";

let failures = 0;
const assert = (cond: boolean, label: string) => {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  if (!cond) failures++;
};

interface Row {
  name: string;
  turns: string[];
  /** Relationship stage for each turn (1-based). */
  relForTurn: (turn: number) => RelationshipStage;
  trust?: number;
  hasPersonalHistory?: boolean;
  /** Expected canonical register after the LAST turn. */
  expect: ConversationRegister;
  /** Expected prompt-rule fragments after the last turn. */
  promptFragments: string[];
  /** Expected relationship line after the last turn. */
  expectRelationship: RelationshipStage;
  /** The register should have been established on this exact turn. */
  expectEstablishedTurn?: number;
}

const exec = new ConversationExecutive();

function runTurn(
  text: string,
  turn: number,
  rel: RelationshipStage,
  trust: number,
  hasPersonalHistory: boolean,
) {
  exec.observeRegister(text, turn, rel);
  const ctx = buildConversationContext({
    input: {
      text,
      sttConfidence: 0.9,
      wasInterruption: false,
      audioRms: 0.02,
      languageMode: "detected",
    },
    language: exec.getLanguageState(),
    register: exec.getRegisterState(),
    emotion: { dominant: "neutral", energy: 0.5, engagement: 0.5, trust },
    memory: { hasPersonalHistory, sessionTurn: turn },
    timing: { turnCount: turn, silenceDurationMs: 300 },
  });
  const plan = exec.plan(ctx);
  const directive = exec.translatePlanToPrompt(plan);
  const registerLine = directive.split("\n").find((l) => l.startsWith("register:"))!;
  const relationshipLine = directive.split("\n").find((l) => l.startsWith("relationship:"))!;
  return {
    state: exec.getRegisterState(),
    planRegister: plan.register,
    relationship: plan.relationship,
    registerLine,
    relationshipLine,
    languageState: exec.getLanguageState(),
  };
}

function verify(row: Row) {
  console.log(`\n── ${row.name} ──`);
  exec.resetLanguage();
  exec.resetRegister();
  let last: ReturnType<typeof runTurn> | null = null;
  row.turns.forEach((t, i) => {
    const turn = i + 1;
    last = runTurn(
      t,
      turn,
      row.relForTurn(turn),
      row.trust ?? 0.5,
      row.hasPersonalHistory ?? false,
    );
    console.log(
      `  turn ${turn} (${row.relForTurn(turn)}): "${t.length > 46 ? t.slice(0, 43) + "…" : t}"` +
        `\n    detected → conversation=${last.state.register} (conf ${last.state.confidence.toFixed(2)}, stab ${last.state.stability.toFixed(2)}, turn ${last.state.establishedTurn})`,
    );
  });
  if (!last) return;

  const state = last.state;
  assert(
    state.register === row.expect,
    `conversation register = ${row.expect} (got ${state.register})`,
  );
  for (const frag of row.promptFragments) {
    assert(last.registerLine.includes(frag), `prompt register directive: "${frag}"`);
  }
  assert(
    last.registerLine.startsWith(`register: ${row.expect} (confidence`),
    `prompt register opens with ${row.expect}`,
  );
  assert(
    last.relationshipLine.startsWith(`relationship: ${row.expectRelationship}`),
    `relationship line = ${row.expectRelationship}`,
  );
  assert(
    last.planRegister.register === state.register,
    "plan.register matches executive state (single source of truth)",
  );
  assert(
    last.relationship === row.expectRelationship,
    `plan.relationship = ${row.expectRelationship} (got ${last.relationship})`,
  );
  assert(
    state.confidenceReasons.length > 0 && state.confidenceReasons.every((r) => r.length > 4),
    "confidence is explainable (non-empty, human-readable reasons)",
  );
  assert(
    state.stability >= 0 && state.stability <= 1,
    `stability in [0,1] (got ${state.stability})`,
  );
  assert(
    state.confidence >= 0 && state.confidence <= 1,
    `confidence in [0,1] (got ${state.confidence})`,
  );
  if (row.expectEstablishedTurn !== undefined) {
    assert(
      state.establishedTurn === row.expectEstablishedTurn,
      `established at turn ${row.expectEstablishedTurn} (got ${state.establishedTurn})`,
    );
  }
  const allConsistent =
    state.register === row.expect && last.registerLine.startsWith(`register: ${row.expect}`);
  assert(allConsistent, "3-field consistency: detected/conversation/prompt aligned");
}

// The ladder is deterministic: plan.relationship is derived from
// (turnCount, hasPersonalHistory, trust). relForTurn must match it so
// the engine's gating and the plan's directive can never diverge.
const ladder = (trust: number, hasPersonalHistory: boolean) => (t: number) =>
  determineRelationshipStage({ sessionTurn: t, hasPersonalHistory, trust });

// ─── Canonical registers ─────────────────────────────────────────────

verify({
  name: "Casual friends",
  turns: [
    "Hey, what's up?",
    "Yeah I'm kinda tired bro",
    "Haha same man, wanna grab food?",
    "Dude that sounds awesome",
  ],
  relForTurn: ladder(0.5, false),
  expect: "CASUAL",
  promptFragments: ["respond in relaxed, conversational language", "no formality"],
  expectRelationship: "ACQUAINTING",
  expectEstablishedTurn: 3,
});

verify({
  name: "Professional interview",
  turns: [
    "Good afternoon, thank you for taking the time",
    "I appreciate your explanation, could you clarify the requirements?",
    "Certainly, I will send the documents by evening",
  ],
  relForTurn: ladder(0.5, false),
  expect: "PROFESSIONAL",
  promptFragments: ["respond courteously and professionally", "no slang"],
  expectRelationship: "ACQUAINTING",
  expectEstablishedTurn: 1,
});

verify({
  name: "Academic discussion",
  turns: [
    "Could you elaborate on the underlying principle?",
    "The analysis assumes a significant correlation between these variables",
    "However, further research is required to validate this hypothesis",
  ],
  relForTurn: ladder(0.5, false),
  expect: "ACADEMIC",
  promptFragments: ["respond precisely and analytically", "no slang"],
  expectRelationship: "ACQUAINTING",
  expectEstablishedTurn: 1,
});

verify({
  name: "Playful banter",
  turns: [
    "Haha that's actually funny 😂",
    "Lol you're the best!!!",
    "Haha well that escalated quickly",
  ],
  relForTurn: ladder(0.5, false),
  expect: "PLAYFUL",
  promptFragments: ["respond lightly and playfully", "matching their fun"],
  expectRelationship: "ACQUAINTING",
  expectEstablishedTurn: 3,
});

verify({
  name: "Emotional support",
  turns: [
    "I understand, that sounds really difficult",
    "I'm here for you, don't worry",
    "It's okay to take your time",
  ],
  relForTurn: ladder(0.5, false),
  expect: "SUPPORTIVE",
  promptFragments: ["respond gently and supportively", "validate the feeling first"],
  expectRelationship: "ACQUAINTING",
  expectEstablishedTurn: 1,
});

verify({
  name: "Neutral fallback",
  turns: ["The window is open", "The file is on the desk", "It will be ready soon"],
  relForTurn: ladder(0.5, false),
  expect: "NEUTRAL",
  promptFragments: ["match the user's register naturally"],
  expectRelationship: "ACQUAINTING",
});

// ─── Momentum: the spec's exact examples ─────────────────────────────

verify({
  name: '"Bro…" must not flip a professional conversation',
  turns: [
    "Good morning, I appreciate your time",
    "Certainly, the report is ready",
    "Thank you for the update",
    "Bro...",
  ],
  relForTurn: ladder(0.5, false),
  expect: "PROFESSIONAL",
  promptFragments: ["respond courteously and professionally"],
  expectRelationship: "ACQUAINTING",
  expectEstablishedTurn: 1,
});

verify({
  name: "One polite sentence must not destroy a casual conversation",
  turns: [
    "Hello, how are you?",
    "Thank you for the warm welcome",
    "Hey man, that sounds awesome!",
    "Yeah I'm kinda tired bro",
    "Haha same man, wanna grab food?",
    "Thank you very much for your patience",
  ],
  relForTurn: ladder(0.5, false),
  expect: "CASUAL",
  promptFragments: ["respond in relaxed, conversational language"],
  expectRelationship: "ACQUAINTING",
  expectEstablishedTurn: 5,
});

// ─── Relationship progression (spec ladder) ──────────────────────────

verify({
  name: "Relationship progression: Neutral → Professional → Casual → Intimate",
  turns: [
    "Hello",
    "Hello there, how are you?",
    "I'm good thanks, nice to meet you",
    "Yeah it was a really fun weekend",
    "Honestly bro, we should hang out again sometime",
    "Haha yeah man, totally, let's do it!",
    "Yeah I'm kinda tired today honestly",
    "Bro you won't believe what happened at work",
    "I finally got the promotion though",
    "Honestly, I trust you, you matter to me",
    "I feel safe with you, honestly",
    "Thank you for being here, I never told anyone this",
    "I miss you when we don't talk",
    "You mean so much to me",
    "I feel safe sharing this with you",
    "I trust you completely",
    "I need you to know something important",
    "You matter to me more than anything",
    "I'm so grateful you're here",
  ],
  relForTurn: ladder(0.7, false),
  trust: 0.7,
  expect: "INTIMATE",
  promptFragments: ["respond quietly, personally and gently", "never exaggerated"],
  expectRelationship: "COMFORTABLE",
  expectEstablishedTurn: 12,
});

// ─── Momentum micro-checks ───────────────────────────────────────────

{
  console.log("\n── Momentum micro-check (gradual shift needs a window majority) ──");
  exec.resetLanguage();
  exec.resetRegister();
  const seq = [
    "Hey what's up",
    "Yeah I'm tired",
    "Kinda long day",
    "I appreciate your help though",
    "Certainly, thank you",
    "I would like to thank you again",
    "Thank you very much for your time",
  ];
  let flippedAt: number | null = null;
  let lastRegister: ConversationRegister | null = null;
  seq.forEach((t, i) => {
    const turn = i + 1;
    exec.observeRegister(t, turn, "ACQUAINTING");
    const s = exec.getRegisterState();
    if (lastRegister && s.register !== lastRegister) flippedAt = turn;
    lastRegister = s.register;
  });
  const final = exec.getRegisterState();
  assert(
    final.register === "PROFESSIONAL",
    `gradual shift resolves to PROFESSIONAL (got ${final.register})`,
  );
  assert(flippedAt === 7, `flip happens only after a window majority (got turn ${flippedAt})`);
  assert(
    (final.transitionReason ?? "").includes("window agreement"),
    `transition is explainable: "${final.transitionReason}"`,
  );
  assert(
    final.establishedTurn === 7,
    `established at the flip turn (got ${final.establishedTurn})`,
  );
}

{
  console.log("\n── Momentum micro-check (burst shifts, bounded flips) ──");
  exec.resetLanguage();
  exec.resetRegister();
  const burst = [
    "Hey what's up", // CASUAL
    "Yeah I'm good", // CASUAL
    "Kinda tired bro", // CASUAL
    "I appreciate your time", // PROFESSIONAL
    "Certainly, thank you", // PROFESSIONAL
    "I would appreciate a response", // PROFESSIONAL
    "I will send the report", // PROFESSIONAL
    "Haha that's so funny 😂", // PLAYFUL
    "Lol you're the best!!!", // PLAYFUL
    "Haha well that escalated quickly", // PLAYFUL
    "Haha okay then, great", // PLAYFUL
  ];
  let flips = 0;
  let prev: ConversationRegister | null = null;
  const stabilities: number[] = [];
  burst.forEach((t, i) => {
    exec.observeRegister(t, i + 1, "ACQUAINTING");
    const s = exec.getRegisterState();
    if (prev && s.register !== prev) flips++;
    prev = s.register;
    stabilities.push(s.stability);
  });
  const final = exec.getRegisterState();
  assert(
    final.register === "PLAYFUL",
    `burst resolves to the final register (got ${final.register})`,
  );
  assert(flips <= 2, `bounded flips across bursts (got ${flips})`);
  assert(
    stabilities.some((s) => s < 1),
    "stability dips during transitions (honest uncertainty)",
  );
  console.log(
    `  final=${final.register} conf=${final.confidence} stability=${final.stability} flips=${flips}`,
  );
}

{
  console.log("\n── Single-observation determinism ──");
  const single = classifyRegisterObservation("Bro", "ACQUAINTING");
  assert(single.register === "CASUAL", `"Bro" alone reads CASUAL (got ${single.register})`);
  assert(single.confidence <= 0.6, `single word is never fully trusted (got ${single.confidence})`);

  const tie = classifyRegisterObservation("I'm good thanks", "ACQUAINTING");
  assert(
    tie.register === "NEUTRAL" && tie.confidence === 0.2,
    `ambiguous tie resolves to NEUTRAL with low confidence (got ${tie.register}/${tie.confidence})`,
  );

  const neutral = classifyRegisterObservation("The file is on the desk", "NEW");
  assert(
    neutral.register === "NEUTRAL" && neutral.confidence === 0,
    `plain sentence stays NEUTRAL (got ${neutral.register}/${neutral.confidence})`,
  );

  // Intimacy must be earned — the exact same sentence at NEW is neutral.
  const gated = classifyRegisterObservation("I trust you, you matter to me", "NEW");
  assert(
    gated.register === "NEUTRAL",
    `INTIMATE sentence at NEW relationship is gated to neutral (got ${gated.register})`,
  );
  const earned = classifyRegisterObservation("I trust you, you matter to me", "COMFORTABLE");
  assert(
    earned.register === "INTIMATE" && earned.confidence <= 0.6,
    `same sentence at COMFORTABLE reads INTIMATE, confidence capped (got ${earned.register}/${earned.confidence})`,
  );
}

{
  console.log("\n── Relationship ladder is deterministic ──");
  assert(
    determineRelationshipStage({ sessionTurn: 1, hasPersonalHistory: false, trust: 0.5 }) === "NEW",
    "turn 1 → NEW",
  );
  assert(
    determineRelationshipStage({ sessionTurn: 5, hasPersonalHistory: false, trust: 0.5 }) ===
      "ACQUAINTING",
    "turn 5 → ACQUAINTING",
  );
  assert(
    determineRelationshipStage({ sessionTurn: 12, hasPersonalHistory: false, trust: 0.5 }) ===
      "COMFORTABLE",
    "turn 12 → COMFORTABLE",
  );
  assert(
    determineRelationshipStage({ sessionTurn: 8, hasPersonalHistory: true, trust: 0.5 }) ===
      "COMFORTABLE",
    "personal history accelerates to COMFORTABLE",
  );
  assert(
    determineRelationshipStage({ sessionTurn: 22, hasPersonalHistory: false, trust: 0.7 }) ===
      "INTIMATE",
    "turn 22 + trust 0.7 → INTIMATE",
  );
  assert(
    determineRelationshipStage({ sessionTurn: 22, hasPersonalHistory: false, trust: 0.4 }) ===
      "COMFORTABLE",
    "turn 22 without trust stays COMFORTABLE (intimacy is trust-gated)",
  );
}

// ─── Language explainability + directive machine-parseability ────────

{
  console.log("\n── Both engines expose explainable confidence ──");
  exec.resetLanguage();
  exec.resetRegister();
  exec.observeLanguage("How was your weekend?", 1);
  exec.observeLanguage("It was really good", 2);
  exec.observeLanguage("मौसम काफी अच्छा है आज", 3);
  exec.observeLanguage("हाँ, बहुत अच्छा दिन था", 4);
  exec.observeLanguage("कल फिर से शुरू होगा काम", 5);
  const lang = exec.getLanguageState();
  assert(
    lang.confidenceReasons.length > 0 && lang.confidenceReasons.every((r) => r.length > 4),
    "language confidence is explainable (reasons present)",
  );
  assert(
    (lang.transitionReason ?? "").includes("window agreement"),
    `language transition is explainable: "${lang.transitionReason}"`,
  );
  assert(lang.momentumWindow >= 1, `language momentum window populated (${lang.momentumWindow})`);

  exec.resetRegister();
  exec.observeRegister("Hey what's up", 1, "ACQUAINTING");
  exec.observeRegister("Yeah I'm good", 2, "ACQUAINTING");
  const reg = exec.getRegisterState();
  assert(reg.confidenceReasons.length > 0, "register confidence is explainable (reasons present)");
  assert(reg.momentumWindow >= 1, `register momentum window populated (${reg.momentumWindow})`);
}

{
  console.log("\n── Prompt directive is machine-checkable ──");
  exec.resetLanguage();
  exec.resetRegister();
  exec.observeRegister("Hey dude, wanna hang out tonight?", 1, "ACQUAINTING");
  const ctx = buildConversationContext({
    input: {
      text: "Hey dude, wanna hang out tonight?",
      sttConfidence: 0.9,
      wasInterruption: false,
      audioRms: 0.02,
      languageMode: "casual",
    },
    language: exec.getLanguageState(),
    register: exec.getRegisterState(),
    emotion: { dominant: "neutral", energy: 0.5, engagement: 0.5 },
    timing: { turnCount: 1, silenceDurationMs: 100 },
  });
  const plan = exec.plan(ctx);
  const directive = exec.translatePlanToPrompt(plan);
  assert(directive.includes("[EXECUTIVE PLAN]"), "directive inside the plan block");
  assert(directive.includes("[/EXECUTIVE PLAN]"), "plan block closes");
  assert(
    /register: \w+ \(confidence 0\.\d{2}, stable since turn \d+\)/.test(directive),
    "register line is machine-parseable",
  );
  assert(
    /relationship: (NEW|ACQUAINTING|COMFORTABLE|INTIMATE) — /.test(directive),
    "relationship line is machine-parseable",
  );
  assert(
    plan.register.register === exec.getRegisterState().register,
    "plan carries the executive's canonical register",
  );
  assert(
    plan.relationship ===
      determineRelationshipStage({
        sessionTurn: 1,
        hasPersonalHistory: false,
        trust: 0.5,
      }),
    "plan relationship matches the deterministic ladder",
  );
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exitCode = failures === 0 ? 0 : 1;
