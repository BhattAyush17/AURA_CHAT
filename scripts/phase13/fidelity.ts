import type { ExecutionPlan } from "../../src/executive/ExecutionPlan";
import { BUDGET_WORDS } from "../../src/executive/InformationBudget";
import { classifyLanguageObservation } from "../../src/executive/LanguageState";
import { classifyRegisterObservation } from "../../src/executive/RegisterState";
import type { DatasetTurn } from "./types";

// ─── Word / marker helpers ────────────────────────────────────────────

export const words = (t: string): string[] =>
  t
    .toLowerCase()
    .replace(/[^a-zà-ÿ0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

export const wordCount = (t: string): number => words(t).length;

const ROBOTIC_PATTERNS = [
  /\bas an ai\b/i,
  /\bi'?m (an )?ai\b/i,
  /\bas (your|an) (ai|language model)/i,
  /as a language model/i,
  /here are (some|a few)/i,
  /\bfirstly\b/i,
  /\bsecondly\b/i,
  /in conclusion/i,
  /it'?s important to (note|remember)/i,
  /remember that/i,
  /feel free to/i,
  /let me know if you/i,
  /i (cannot|can'?t)( (do|help|provide))?/i,
  /\bwould you like me to/i,
  /do you have any (other )?questions/i,
  /i'?d be happy to/i,
  /of course, here/i,
  /i'?m here to help/i,
];

const STOPWORD = new Set([
  "kabhi",
  "kya",
  "kaun",
  "hai",
  "tha",
  "nahi",
  "iska",
  "koi",
  "aur",
  "wahi",
  "abhi",
  "theek",
  "yaar",
  "bhai",
  "bahut",
  "aap",
  "tum",
  "main",
  "mein",
  "hoga",
  "hoja",
  "kare",
  "karo",
  "raha",
  "rahi",
  "diya",
  "diyi",
  "this",
  "that",
  "with",
  "from",
  "have",
  "were",
  "been",
  "will",
  "about",
  "them",
  "when",
  "what",
  "your",
  "into",
  "just",
  "like",
  "their",
]);

const EMPATHY_MARKERS = [
  "samajh",
  "sunt",
  "feel",
  "sorry",
  "hard",
  "tough",
  "theek",
  "yaar",
  "hmm",
  "i hear",
  "sach",
  "raho",
  "yahan",
  "it's okay",
  "understand",
  "ho jayega",
  "abhi",
  "take your time",
  "presence",
  "baith",
  "ehsaas",
  "khali",
  "acche din",
  "hota hai",
  "hum hai",
  "sath",
];

const HUMOR_MARKERS = [
  "haha",
  "😂",
  "😅",
  "😆",
  "🤣",
  "😄",
  "😉",
  "lol",
  "lmao",
  "funny",
  "mazaak",
  "mazak",
  "chodo",
  "saale",
  "chutiya",
  "gand",
  "joke",
  "hahah",
  "bc",
  "bhai",
];

const WARMTH_MARKERS = [
  "yaar",
  "bhai",
  "sun",
  "bro",
  "dude",
  "acha",
  "achha",
  "theek",
  "bete",
  "love",
  "milte",
  "piyo",
  "apna",
  "friend",
  "😆",
  "😄",
  "😉",
  "🤣",
  "😊",
  "😁",
];

const HEDGE_WORDS = [
  "shayad",
  "maybe",
  "i think",
  "i guess",
  "probably",
  "lagta hai",
  "ho sakta",
  "not sure",
  "i'm not sure",
];

const STRATEGY_MARKERS: Record<string, string[]> = {
  Comfort: EMPATHY_MARKERS,
  Encourage: [
    "you can",
    "you got",
    "believe",
    "deserve",
    "keep",
    "ho jayega",
    "mil jayega",
    "proud",
    "i believe",
    "kar",
    "se kar",
    "go ahead",
    "nice",
    "great",
    "shabash",
    "congrat",
    "congrats",
    "badhai",
    "mubarak",
    "celebrate",
    "party",
    "wish",
    "kudos",
  ],
  Ask: ["?", "kya", "kaise", "kab", "kahan", "why", "what", "how", "bata"],
  Clarify: [
    "?",
    "what do you mean",
    "matalab",
    "matlab",
    "samjha nahi",
    "explain",
    "can you repeat",
    "rephrase",
    "mujhe samjha",
  ],
  Reflect: [
    "so you",
    "you mean",
    "matlab",
    "toh",
    "laga",
    "sounds like",
    "so aap",
    "yaani",
    "you feel",
    "kaha",
    "matalab",
    "ehsaas",
  ],
  Challenge: [
    "nahi",
    "wrong",
    "but",
    "actually",
    "disagree",
    "galat",
    "reconsider",
    "prove",
    "think again",
    "nope",
    "i disagree",
    "saboot",
  ],
  Observe: [
    "hmm",
    "haan",
    "okay",
    "theek",
    "mm",
    "acha",
    "wow",
    "huh",
    "really",
    "true",
    "fair",
    "samajh",
    "sahi",
    "haha",
    "bilkul",
    "badiya",
    "masti",
    "achha",
  ],
  Listen: ["hmm", "haan", "theek", "acha", "sun", "bol", "bata", "hmm"],
  Answer: ["kya", "kyun", "kaise", "isliye", "kyunki", "because", "so", "dekh", "ho"],
  Redirect: ["waise", "anyway", "kuch aur", "different", "change", "chhodo", "lekin"],
  Summarize: ["so overall", "toh", "summary", "main point", "essentially", "short mein"],
};

export function hasMarker(response: string, strategy: string): boolean {
  const markers = STRATEGY_MARKERS[strategy];
  if (!markers) return true;
  const lower = response.toLowerCase();
  return markers.some((m) => lower.includes(m));
}

// ─── Phase 13B: LLM fidelity to the Executive plan ───────────────────

export interface FidelityReport {
  language: boolean;
  register: boolean;
  memory: boolean;
  hallucinatedMemory: boolean;
  strategy: boolean;
  initiative: boolean;
  budget: boolean;
  percent: number;
}

export function fidelityOf(
  llm: string,
  plan: ExecutionPlan,
  injected: string[],
  visibleText: string[],
): FidelityReport {
  const lower = llm.toLowerCase();
  const responseWords = wordCount(llm);

  // Language — the Executive ordered a language; the LLM should speak it.
  // The classifier quantizes into six bands; the three mixed bands are one
  // conversational family (Hinglish), and strictness matters only for the
  // pure ends (PURE_ENGLISH / PURE_HINDI plans).
  const langObs = classifyLanguageObservation(llm);
  const MIXED_FAMILY = ["HINGLISH", "HINDI_WITH_ENGLISH", "ENGLISH_WITH_HINDI"];
  const language =
    langObs.dominant === plan.language.dominant ||
    (MIXED_FAMILY.includes(plan.language.dominant) && MIXED_FAMILY.includes(langObs.dominant)) ||
    (plan.language.dominant === "HINGLISH" && langObs.dominant === "PURE_HINDI") ||
    (plan.language.dominant === "ENGLISH_WITH_HINDI" && langObs.dominant === "PURE_ENGLISH");

  // Register — the Executive ordered a register; the LLM should hold it.
  // One-step adjacency is tolerated: at a NEW relationship the engine
  // conservatively holds NEUTRAL, and a reply one notch warmer (CASUAL /
  // PLAYFUL) is not a violation. Only real breaks (FORMAL↔playful,
  // SUPPORTIVE→sarcastic, ...) fail.
  const regObs = classifyRegisterObservation(llm, plan.relationship);
  const planned = plan.register.register;
  const ADJACENT: Record<string, string[]> = {
    NEUTRAL: ["CASUAL", "PLAYFUL"],
    CASUAL: ["NEUTRAL", "PLAYFUL"],
    PLAYFUL: ["NEUTRAL", "CASUAL"],
    SUPPORTIVE: ["CASUAL", "PLAYFUL"],
  };
  const register =
    regObs.register === planned ||
    (ADJACENT[planned] ?? []).includes(regObs.register) ||
    (["CASUAL", "PLAYFUL", "SUPPORTIVE", "NEUTRAL"].includes(planned) &&
      regObs.register === "NEUTRAL");

  // Memory — required memories must surface; ignored ones must not leak.
  // Stem matching (first 4 chars) absorbs Hinglish inflection ("waited"→"wait").
  const keywords = new Set<string>();
  for (const mem of injected) {
    for (const w of words(mem)) {
      if (w.length >= 4 && !STOPWORD.has(w)) {
        keywords.add(w);
      }
    }
  }
  const stems = new Set([...keywords].map((k) => k.slice(0, 4)));
  const referenced =
    [...keywords].some((k) => lower.includes(k)) || [...stems].some((s) => lower.includes(s));
  const visible = visibleText.join(" ").toLowerCase();
  const leaked =
    [...keywords].some((k) => lower.includes(k) && !visible.includes(k)) ||
    [...stems].some((s) => lower.includes(s) && !visible.includes(s));
  let memory: boolean;
  let hallucinatedMemory = false;
  if (plan.memoryPolicy === "Required" || plan.memoryPolicy === "Optional") {
    memory = injected.length === 0 ? true : referenced;
  } else {
    memory = !leaked;
    if (leaked) hallucinatedMemory = true;
  }

  // Strategy — the response should act like the chosen strategy.
  const strategy = hasMarker(llm, plan.strategy.primary);

  // Initiative — Ask ends in a question; Observe/Wait/Continue do not.
  const endsWithQuestion = /\?[.!…]*$/.test(llm.trim());
  let initiative: boolean;
  switch (plan.initiative) {
    case "Ask":
      initiative = endsWithQuestion;
      break;
    case "Wait":
      initiative = responseWords <= 5;
      break;
    default:
      initiative = !endsWithQuestion || plan.strategy.primary === "Ask";
  }

  // Budget — the Executive set depth; a wall of text is a violation.
  const bound = BUDGET_WORDS[plan.informationBudget] * 1.5;
  const budget = responseWords <= Math.max(bound, 8);

  const checks = [language, register, memory, strategy, initiative, budget];
  const percent = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  return { language, register, memory, hallucinatedMemory, strategy, initiative, budget, percent };
}

// ─── Phase 13C: the human judge (no engine names, no architecture) ────

export interface HumanCheck {
  name: string;
  passed: boolean;
  applicable: boolean;
}

export interface HumanVerdict {
  checks: HumanCheck[];
  score: number;
  feelsHuman: boolean;
}

export function humanJudge(
  llm: string,
  plan: ExecutionPlan,
  turn: DatasetTurn,
  prevLlm: string | null,
): HumanVerdict {
  const lower = llm.toLowerCase();
  const n = wordCount(llm);
  const bound = BUDGET_WORDS[plan.informationBudget] * 1.5;
  const playful = (turn.behavior?.playfulness ?? 0) > 0.5;
  const vulnerable = (turn.emo?.vulnerability ?? 0) > 0.5;
  const longSilence = (turn.silenceMs ?? 0) > 3000;
  const memoryInjected = (turn.memory?.length ?? 0) > 0 && plan.memoryPolicy !== "Ignore";
  const warmContext =
    plan.relationship !== "NEW" && ["CASUAL", "PLAYFUL"].includes(plan.register.register);

  const checks: HumanCheck[] = [];
  const add = (name: string, applicable: boolean, passed: boolean) =>
    checks.push({ name, applicable, passed });

  // Naturalness — no assistant-isms, no essays, no lists.
  add(
    "naturalness",
    true,
    !ROBOTIC_PATTERNS.some((p) => p.test(llm)) && !/^\s*[-*•#\d.]/m.test(llm) && !/\*\*/.test(llm),
  );

  // Flow — responsive length, no repetition of the previous line.
  const overlap =
    prevLlm === null
      ? 0
      : [...new Set(words(prevLlm))].filter((w) => new Set(words(llm)).has(w)).length /
        Math.max(1, new Set(words(llm)).size);
  add("flow", true, n >= 2 && n <= Math.max(bound, 8) && overlap < 0.7);

  // Humor — only matters when the turn was actually funny.
  if (playful) {
    add(
      "humor",
      true,
      HUMOR_MARKERS.some((m) => lower.includes(m)),
    );
  } else {
    add("humor", false, true);
  }

  // Empathy — only matters when the person was actually down.
  if (vulnerable) {
    add(
      "empathy",
      true,
      EMPATHY_MARKERS.some((m) => lower.includes(m)) && !(/\?[.!…]*$/.test(llm.trim()) && n <= 8),
    );
  } else {
    add("empathy", false, true);
  }

  // Timing — long silence must be met with calm, not a rush.
  if (longSilence) {
    add("timing", true, plan.speechBehavior.speechSpeed <= 1.05);
  } else {
    add("timing", false, true);
  }

  // Callbacks — what you said before still matters.
  if (memoryInjected) {
    const f = fidelityOf(llm, plan, turn.memory ?? [], []);
    add("callbacks", true, f.memory);
  } else {
    add("callbacks", false, true);
  }

  // Friendliness — warm when the relationship is warm.
  if (warmContext) {
    add(
      "friendliness",
      true,
      WARMTH_MARKERS.some((m) => lower.includes(m)),
    );
  } else {
    add("friendliness", false, true);
  }

  // Confidence — a friend doesn't hedge every line.
  const hedges = HEDGE_WORDS.filter((h) => lower.includes(h)).length;
  add("confidence", true, hedges <= 2);

  // Presence — actually being there beats reciting.
  add("presence", true, n <= Math.max(bound, 8) && !/i'?m (sorry|unable)/i.test(llm));

  const applicable = checks.filter((c) => c.applicable);
  const passed = applicable.filter((c) => c.passed).length;
  const score = Math.round((passed / applicable.length) * 100) / 10;
  return { checks, score, feelsHuman: score >= 7 };
}
