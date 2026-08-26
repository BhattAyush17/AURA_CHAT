/**
 * Phase 8 Verification — AURA Language Adaptation Directive.
 *
 * The LLM never infers conversation language; the Executive owns it.
 * For every scenario this suite verifies the full deterministic chain:
 *   Detected Language  → classifyLanguageObservation (per utterance)
 *   Conversation Language → LanguageMomentumEngine (momentum state)
 *   Prompt Language    → executive.translatePlanToPrompt (directive block)
 *   Response Language  → ttsLanguageCode (spoken register)
 *   Thought Viewer Language → localizeThinkingUtterance (murmurs)
 *
 * Run: npx tsx scripts/test-language.ts
 */
import { ConversationExecutive } from "../src/executive/ConversationExecutive";
import { buildConversationContext } from "../src/executive/ConversationContext";
import {
  classifyLanguageObservation,
  localizeThinkingUtterance,
  ttsLanguageCode,
  type ConversationLanguage,
  type LanguageState,
} from "../src/executive/LanguageState";

let failures = 0;
const assert = (cond: boolean, label: string) => {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  if (!cond) failures++;
};

interface Row {
  name: string;
  turns: string[];
  /** Expected canonical register after the LAST turn. */
  expect: ConversationLanguage;
  /** Expected prompt-rule fragments after the last turn. */
  promptFragments: string[];
  /** Expected TTS code after the last turn (null = keep user setting). */
  tts: "hi-IN" | "en-IN" | null;
  /** Thought viewer localization expectation. */
  thought: string;
}

const exec = new ConversationExecutive();

function runTurn(text: string, turn: number) {
  const observed = exec.observeLanguage(text, turn);
  const ctx = buildConversationContext({
    input: {
      text,
      sttConfidence: 0.9,
      wasInterruption: false,
      audioRms: 0.02,
      languageMode: "detected",
    },
    language: exec.getLanguageState(),
    emotion: { dominant: "neutral", energy: 0.5, engagement: 0.5 },
    timing: { turnCount: turn, silenceDurationMs: 300 },
  });
  const plan = exec.plan(ctx);
  const directive = exec
    .translatePlanToPrompt(plan)
    .split("\n")
    .find((l) => l.startsWith("language:"))!;
  return {
    observed: observed.dominant,
    state: exec.getLanguageState(),
    planLanguage: plan.language,
    directive,
    tts: ttsLanguageCode(plan.language),
    thought: localizeThinkingUtterance("Let me think…", plan.language),
  };
}

function verify(row: Row) {
  console.log(`\n── ${row.name} ──`);
  exec.resetLanguage();
  let last: ReturnType<typeof runTurn> | null = null;
  row.turns.forEach((t, i) => {
    last = runTurn(t, i + 1);
    console.log(
      `  turn ${i + 1}: "${t.length > 46 ? t.slice(0, 43) + "…" : t}"` +
        `\n    detected=${last.observed} → conversation=${last.state.dominant} (conf ${last.state.confidence.toFixed(2)}, stab ${last.state.stability.toFixed(2)}, turn ${last.state.establishedAtTurn})`,
    );
  });
  if (!last) return;

  const state = last.state;
  assert(
    state.dominant === row.expect,
    `conversation language = ${row.expect} (got ${state.dominant})`,
  );
  for (const frag of row.promptFragments) {
    assert(last.directive.includes(frag), `prompt language directive: "${frag}"`);
  }
  assert(last.directive.startsWith(`language: ${row.expect}`), `prompt opens with ${row.expect}`);
  assert(last.tts === row.tts, `response (TTS) language = ${row.tts} (got ${last.tts})`);
  assert(
    last.thought === row.thought,
    `thought viewer language = "${row.thought}" (got "${last.thought}")`,
  );
  assert(
    last.state.dominant === last.planLanguage.dominant,
    "plan.language matches executive state (single source of truth)",
  );
  const allConsistent =
    state.dominant === row.expect &&
    last.directive.includes(`language: ${row.expect}`) &&
    last.tts === row.tts;
  assert(
    allConsistent,
    "5-field consistency: detected/conversation/prompt/response/thought aligned",
  );
}

// ─── The directive's verification matrix ─────────────────────────────

verify({
  name: "Pure Hindi",
  turns: ["आज मौसम काफी अच्छा है।"],
  expect: "PURE_HINDI",
  promptFragments: ["respond entirely in natural Hindi", "avoid translated-sounding Hindi"],
  tts: "hi-IN",
  thought: "सोच रही हूँ…",
});

verify({
  name: "Pure English",
  turns: ["I had a rough day today."],
  expect: "PURE_ENGLISH",
  promptFragments: ["respond entirely in natural English", "do not insert Hindi"],
  tts: "en-IN",
  thought: "Let me think…",
});

verify({
  name: "Hinglish",
  turns: ["Yaar today was actually pretty hectic."],
  expect: "HINGLISH",
  promptFragments: ["mirror the user's Hindi-English balance", "do not collapse into one language"],
  tts: "hi-IN",
  thought: "सोच रही हूँ…",
});

verify({
  name: "Hindi with English technical words",
  turns: ["कल meeting है, project deadline निकट आ रही है।"],
  expect: "HINDI_WITH_ENGLISH",
  promptFragments: [
    "keeping the user's English terms exactly as they said them",
    "never translate them",
  ],
  tts: "hi-IN",
  thought: "सोच रही हूँ…",
});

verify({
  name: "English with Hindi expressions",
  turns: ["I think मुझे पता exactly what happened yesterday morning"],
  expect: "ENGLISH_WITH_HINDI",
  promptFragments: ["respond in English; mirror the user's Hindi expressions naturally"],
  tts: "en-IN",
  thought: "Let me think…",
});

// ─── Language momentum: gradual shift never flips on one word ───────

verify({
  name: "Long conversation with gradual shift",
  turns: [
    "How was your weekend?",
    "I went to a wedding, it was really fun",
    "The food was amazing honestly",
    "Yaar honestly I just need a break now",
    "Work has been nonstop this week",
    "So basically I am exhausted",
    "Haan yaar, bahut kaam ho gaya",
    "kal phir meeting hai, theek hai",
    "ठीक है, कोई बात नहीं",
    "मैं बस आराम करना चाहता हूँ",
    "आज मौसम भी अच्छा नहीं लग रहा",
  ],
  expect: "PURE_HINDI",
  promptFragments: ["respond entirely in natural Hindi"],
  tts: "hi-IN",
  thought: "सोच रही हूँ…",
});

// Momentum micro-assertions on the gradual-shift sequence
{
  console.log("\n── Momentum micro-check (single borrowed word must not flip) ──");
  exec.resetLanguage();
  exec.observeLanguage("The food was amazing honestly", 1);
  exec.observeLanguage("The music was great too", 2);
  const afterEnglish = exec.getLanguageState();
  exec.observeLanguage("Yaar honestly I just need a break", 3); // one Hinglish turn
  const afterOneHinglish = exec.getLanguageState();
  assert(afterEnglish.dominant === "PURE_ENGLISH", "two English turns → PURE_ENGLISH");
  assert(
    afterOneHinglish.dominant === "PURE_ENGLISH" && afterOneHinglish.establishedAtTurn === 1,
    "one Hinglish turn does NOT flip the conversation language (momentum)",
  );
  for (let i = 4; i <= 9; i++) exec.observeLanguage("Still the same topic though", i);
  const afterSix = exec.getLanguageState();
  assert(
    afterSix.stability === 1,
    `stability 1.0 after 6 clean agreeing turns (got ${afterSix.stability})`,
  );
}

// ─── Rapid code-switching: tracks the blend, no per-turn flapping ────

{
  console.log("\n── Rapid code-switching ──");
  exec.resetLanguage();
  const alternation = [
    "So the plan is simple",
    "तो प्लान सीधा है",
    "We just need the numbers",
    "हमें बस नंबर चाहिए",
    "And then we present it",
    "और फिर प्रेजेंटेशन है",
    "Everyone will see the result",
    "हर कोई नतीजा देखेगा",
  ];
  let flips = 0;
  let prev: ConversationLanguage | null = null;
  const stabilities: number[] = [];
  alternation.forEach((t, i) => {
    exec.observeLanguage(t, i + 1);
    const s = exec.getLanguageState();
    if (prev && s.dominant !== prev) flips++;
    prev = s.dominant;
    stabilities.push(s.stability);
  });
  const final = exec.getLanguageState();
  assert(
    final.dominant !== "UNKNOWN",
    `rapid switching resolves to a register (got ${final.dominant})`,
  );
  assert(flips <= 3, `bounded flips across 8 switching turns (got ${flips})`);
  assert(
    stabilities.slice(1).every((s) => s < 1),
    "stability stays < 1 during switching (honest uncertainty)",
  );
  console.log(
    `  final=${final.dominant} conf=${final.confidence} stability=${final.stability} flips=${flips}`,
  );
}

// ─── First Conversation Rule ─────────────────────────────────────────

{
  console.log("\n── First Conversation Rule ──");
  exec.resetLanguage();
  exec.observeLanguage("Hi, how are you?", 1);
  assert(
    exec.getLanguageState().establishedAtTurn === 1,
    "first English message establishes language at turn 1",
  );

  exec.resetLanguage();
  exec.observeLanguage("नमस्ते, कैसे हो?", 1);
  assert(
    exec.getLanguageState().establishedAtTurn === 1,
    "first Hindi message establishes language at turn 1",
  );
}

// ─── Intent independence ─────────────────────────────────────────────

{
  console.log("\n── Intent independence (language stable across intents) ──");
  exec.resetLanguage();
  const intents = [
    "तुम क्या सोचती हो इस बारे में?", // question
    "मैं बहुत परेशान हूँ आज", // emotional
    "रुको, ये तो गलत है", // argument
    "तो फिर हमने यह किया, और फिर वो हुआ", // story
    "चलो अब टॉपिक बदलते हैं", // topic change
  ];
  intents.forEach((t, i) => exec.observeLanguage(t, i + 1));
  const s = exec.getLanguageState();
  assert(
    s.dominant === "PURE_HINDI" || s.dominant === "HINDI_WITH_ENGLISH",
    `intent never changes the register (got ${s.dominant})`,
  );
}

// ─── UNKNOWN handling ────────────────────────────────────────────────

{
  console.log("\n── UNKNOWN handling ──");
  exec.resetLanguage();
  exec.observeLanguage("!!! ...", 1);
  const s = exec.getLanguageState();
  assert(
    s.dominant === "UNKNOWN" && s.confidence === 0,
    "punctuation-only → UNKNOWN, zero confidence",
  );
  exec.observeLanguage("क्या हाल है?", 2);
  assert(
    exec.getLanguageState().dominant === "PURE_HINDI",
    "first meaningful message adopts immediately",
  );
}

// ─── TTS + thought consistency across the full plan chain ───────────

{
  console.log("\n── Prompt directive is machine-checkable ──");
  exec.resetLanguage();
  exec.observeLanguage("Yaar kya kar raha hai tu", 1);
  const ctx = buildConversationContext({
    input: {
      text: "Yaar kya kar raha hai tu",
      sttConfidence: 0.9,
      wasInterruption: false,
      audioRms: 0.02,
      languageMode: "hinglish",
    },
    language: exec.getLanguageState(),
    emotion: { dominant: "neutral", energy: 0.5, engagement: 0.5 },
    timing: { turnCount: 1, silenceDurationMs: 100 },
  });
  const plan = exec.plan(ctx);
  const directive = exec.translatePlanToPrompt(plan);
  assert(directive.includes("[EXECUTIVE PLAN]"), "directive inside the plan block");
  assert(directive.includes("[/EXECUTIVE PLAN]"), "plan block closes");
  assert(
    /language: \w+( \/ secondary \w+)? \(confidence 0\.\d{2}, stable since turn \d+\)/.test(
      directive,
    ),
    "language line is machine-parseable",
  );
  assert(
    (plan.language as LanguageState).dominant === exec.getLanguageState().dominant,
    "plan carries the executive's canonical state",
  );
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exitCode = failures === 0 ? 0 : 1;
