/**
 * ConversationUnderstanding — the ONE canonical interpretation layer.
 *
 * Perception answers "What happened?".
 * ConversationUnderstanding answers "What does it mean?".
 * Executive answers "What should AURA do?".
 * LLM answers "How should AURA say it?".
 *
 * This module produces a single immutable ConversationUnderstanding object
 * per turn. Every Executive policy consumes it. Nothing else may
 * independently interpret the conversation.
 *
 * Phase 11 rule: if a feature would create another interpretation system,
 * merge it HERE instead.
 */

import type { ConversationContext } from "./ConversationContext";

// ─── The interpretation vocabulary ──────────────────────────────────

export type LiteralMeaning =
  | "greeting"
  | "question"
  | "answer"
  | "story"
  | "opinion"
  | "correction"
  | "repair"
  | "goodbye"
  | "silence"
  | "thinking" // user holds the floor mid-thought
  | "trailing" // user trails off, half-thought
  | "retraction" // user drops the thread
  | "request"
  | "backchannel"
  | "statement";

export type ConversationMove =
  | "Ask"
  | "Answer"
  | "Comfort"
  | "Challenge"
  | "Clarify"
  | "Repair"
  | "Reflect"
  | "Explore"
  | "Observe"
  | "Continue"
  | "Close"
  | "Wait";

export type SpeakerGoal =
  | "seek-information"
  | "seek-comfort"
  | "vent"
  | "think-aloud"
  | "teach"
  | "debate"
  | "share-excitement"
  | "complain"
  | "tell-story"
  | "test-aura"
  | "seek-validation"
  | "express-uncertainty"
  | "repair"
  | "small-talk"
  | "inform"
  | "close"
  | "drop-thread";

export type ExpectedResponse =
  | "information"
  | "empathy"
  | "agreement"
  | "challenge"
  | "clarification"
  | "advice"
  | "listening"
  | "silence"
  | "follow-up";

export type ConversationState =
  | "opening"
  | "building"
  | "deepening"
  | "conflict"
  | "repair"
  | "reflection"
  | "topic-shift"
  | "ending";

export interface ImplicitMeaning {
  label: string; // "not-fine", "needs-empathy", "seeking-reassurance", "dissatisfied", "withdrawing"
  confidence: number;
  reasoning: string[];
  alternatives: string[];
}

export interface SocialSignal {
  name: string;
  confidence: number;
  evidence: string[];
}

export interface UnderstandingConfidence {
  value: number; // 0–1, calibrated-ish: how sure the interpretation is
  readonly reasoning: readonly string[]; // why this interpretation won
  readonly alternatives: readonly { move: ConversationMove; p: number }[]; // ranked runner-ups
}

export interface SharedContext {
  openQuestion: boolean; // a question is still unanswered
  repairPending: boolean; // the user is mid-repair
  topicUnfinished: boolean; // previous turn was a half-thought
  emotionUnresolved: boolean; // heavy emotion is still in the room
  branchActive: boolean; // a new topic was opened this turn
  readonly notes: readonly string[];
}

export interface UnderstandingContext {
  sttConfidence: number;
  wordCount: number;
  silenceMs: number;
  turnCount: number;
  memoryConflict: boolean;
  ambiguityTagged: boolean;
  engagement: number;
  vulnerability: number;
  tension: number;
  frustration: number;
}

export interface ConversationUnderstanding {
  literal: LiteralMeaning;
  move: ConversationMove;
  speakerGoal: SpeakerGoal;
  expected: ExpectedResponse;
  implicit: ImplicitMeaning | null;
  social: ReadonlyArray<SocialSignal>;
  state: ConversationState;
  shared: SharedContext;
  confidence: UnderstandingConfidence;
  context: UnderstandingContext;
  raw: { text: string; clean: string; isQuestion: boolean };
}

// ─── Detection vocabulary (the only interpretation primitives) ──────

const BACKCHANNELS = new Set([
  "yeah",
  "yes",
  "ok",
  "okay",
  "hmm",
  "mhm",
  "mm",
  "mmhmm",
  "aha",
  "ha",
  "haha",
  "lol",
  "true",
  "right",
  "nice",
  "cool",
  "exactly",
  "oh",
  "ohh",
  "acha",
  "achha",
  "haan",
  "hn",
  "yep",
  "sure",
  "got",
  "wow",
  "damn",
  "bilkul",
  "sahi",
  "theek",
  "theek hai",
  "ji",
  "arre",
  "uff",
  "haina",
  "ah",
  "ooh",
]);

const GREETINGS = new Set([
  "hi",
  "hello",
  "hey",
  "namaste",
  "hola",
  "yo",
  "good morning",
  "good evening",
  "abe oye",
  "abe oy",
  "oye",
  "oy",
  "ooye",
  "arey",
  "ae",
]);

const FAREWELLS = new Set([
  "bye",
  "goodbye",
  "goodnight",
  "good night",
  "cya",
  "see you",
  "alvida",
  "bye bye",
  "tata",
]);

const REJECTION_PATTERNS = [
  "that s not what i meant",
  "that s not what i said",
  "you misunderstood",
  "you got it wrong",
  "you re wrong",
  "that s wrong",
  "that s not right",
  "i didn t mean",
  "i didn t say",
  "no i meant",
  "wait no",
  "no wait",
  "no no no",
];

const HOLD_PATTERNS = [
  "hold on",
  "hold up",
  "one sec",
  "one second",
  "give me a sec",
  "just a sec",
  "let me think",
  "let me explain",
  "let me finish",
  "let me say",
  "let me check",
  "hang on",
  "wait a minute",
  "wait a sec",
  "wait let me",
  "just a moment",
  "one moment",
];

const RETRACTION_PATTERNS = [
  "never mind",
  "forget it",
  "leave it",
  "skip it",
  "let it go",
  "ditch that",
];

const CORRECTION_PATTERNS = [
  "i meant",
  "i mean",
  "actually i",
  "what i meant",
  "i was trying to say",
  "nahi actually",
  "wait nahi",
  "wait no actually",
];

const IRONY_PHRASES = [
  "yeah right",
  "sure because",
  "sure, because",
  "great, another",
  "great another",
  "what a surprise",
  "works perfectly",
  "as if",
  "oh really",
  "like i care",
  "big deal",
  "just great",
  "how wonderful",
  "oh joy",
  "sooo excited",
];

const HEDGE_WORDS = [
  "maybe",
  "perhaps",
  "i think",
  "not sure",
  "i guess",
  "kuch",
  "pata nahi",
  "shayad",
];

const CLOSING_MARKERS = [
  "i have to go",
  "got to run",
  "i should go",
  "that s all for today",
  "that s all",
  "ttyl",
  "talk to you later",
  "see you later",
  "i m off",
  "i gotta go",
];

const TOPIC_SHIFT_MARKERS = [
  "by the way",
  "btw",
  "anyway",
  "so anyway",
  "moving on",
  "speaking of",
  "on another note",
  "different topic",
];

const VALIDATION_MARKERS = [
  "right?",
  "does that make sense",
  "am i right",
  "tell me i m",
  "do you think i m",
  "was that the right",
];

const POLITENESS_MARKERS = [
  "please",
  "thanks",
  "thank you",
  "could you",
  "would you mind",
  "kindly",
];

const INDIRECT_QUESTION_PATTERNS = [
  "i was wondering",
  "i d love to know",
  "i d like to know",
  "do you happen to know",
  "curious about",
  "just curious",
  "you know what would be nice",
  "i d like to ask",
];

const REQUEST_PATTERNS = [
  "could you please",
  "please could you",
  "can you please",
  "please can you",
  "would you mind",
  "kindly",
  "i need you to",
  "do me a favour",
  "can you help",
  "could you help",
  "help me",
];

const DISAGREEMENT_PATTERNS = [
  "i disagree",
  "i don t agree",
  "i don t think so",
  "that s debatable",
  "here s my counterpoint",
  "but that s not true",
  "you re not right",
];

const CONTRADICTION_PATTERNS = [
  "that contradicts",
  "you said the opposite",
  "but you said",
  "but earlier you",
  "you told me differently",
];

const IMPLICIT_HIDDEN_REQUEST = [
  "it s really hot",
  "it s so hot",
  "i m hungry",
  "i m so hungry",
  "i m thirsty",
  "i m so thirsty",
  "it s too bright",
  "it s too dark",
  "it s so dark",
  "i can t see anything",
  "it s so noisy",
  "it s too noisy",
];

const IMPLICIT_NOT_FINE = ["i m fine", "i am fine", "i m okay", "i m ok", "i m alright"];
const IMPLICIT_TIRED = ["i m tired", "i am tired", "i m exhausted", "i m drained"];
const IMPLICIT_REASSURANCE = [
  "i don t know anymore",
  "i don t know what to do",
  "i don t know where to go",
  "i m lost",
  "what s the point",
];

/** Normalize conversational text: lowercase, strip punctuation, collapse whitespace. */
export function cleanText(text: string): string {
  const out: string[] = [];
  for (const ch of text.toLowerCase()) {
    const code = ch.codePointAt(0) ?? 0;
    const keep =
      (code >= 0x61 && code <= 0x7a) || // a-z
      (code >= 0x30 && code <= 0x39) || // 0-9
      (code >= 0x0900 && code <= 0x0a4f) || // Devanagari + Gujarati
      ch === " ";
    out.push(keep ? ch : " ");
  }
  return out.join("").replace(/\s+/g, " ").trim();
}

function cleanTokens(text: string): string[] {
  return cleanText(text).split(/\s+/).filter(Boolean);
}

function wordCount(text: string): number {
  const words = text.trim().split(/\s+/);
  return text.trim() ? words.length : 0;
}

function isQuestion(text: string): boolean {
  const stripped = text
    .trim()
    .replace(/^(ugh|oh|ohh|hmm|hey|wait|well|so|aah|arrgh)[\s,:.!]+/i, "");
  if (/[?？]/.test(stripped)) return true;
  if (/^what a\b/i.test(stripped)) return false; // "What a day." is an exclamation
  return /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|kaise|kya|kyu|kab|kahan|kaun)\b/i.test(
    stripped,
  );
}

// ─── The single builder ─────────────────────────────────────────────
// understand(ctx) is the ONLY place conversation meaning is inferred.

const MOVE_OPTIONS: ConversationMove[] = [
  "Ask",
  "Answer",
  "Comfort",
  "Challenge",
  "Clarify",
  "Repair",
  "Reflect",
  "Explore",
  "Observe",
  "Continue",
  "Close",
  "Wait",
];

export function understand(ctx: ConversationContext): ConversationUnderstanding {
  const text = ctx.input.text.trim();
  const clean = cleanText(text);
  const words = cleanTokens(text);
  const wc = words.length;
  const stt = ctx.input.sttConfidence;
  const emo = ctx.emotion;
  const behavior = ctx.behaviorAnalysis;
  const reasoning: string[] = [];

  const contradicting = CONTRADICTION_PATTERNS.some((p) => clean.includes(p));
  const disagreeing =
    behavior?.act === "debate" ||
    behavior?.tags?.includes("disagreement") === true ||
    DISAGREEMENT_PATTERNS.some((p) => clean.includes(p));

  // ── Literal meaning ──────────────────────────────────────────────
  const first = words[0] ?? "";
  let literal: LiteralMeaning = "statement";
  if (text.length === 0 || stt < 0.2) {
    literal = "silence";
  } else if (
    FAREWELLS.has(clean) ||
    FAREWELLS.has(first) ||
    CLOSING_MARKERS.some((m) => clean.includes(m))
  ) {
    literal = "goodbye";
  } else if (GREETINGS.has(clean) || GREETINGS.has(first)) {
    literal = "greeting";
  } else if (words.every((w) => BACKCHANNELS.has(w)) || (wc <= 2 && BACKCHANNELS.has(first))) {
    literal = "backchannel";
  } else if (contradicting || REJECTION_PATTERNS.some((p) => clean.includes(p))) {
    literal = "repair";
  } else if (
    clean === "wait" ||
    (clean.startsWith("wait ") && !CORRECTION_PATTERNS.some((p) => clean.includes(p))) ||
    HOLD_PATTERNS.some((p) => clean.includes(p))
  ) {
    literal = "thinking";
  } else if (RETRACTION_PATTERNS.some((p) => clean.includes(p))) {
    literal = "retraction";
  } else if ((text.endsWith("…") || text.endsWith("...")) && wc <= 15 && !isQuestion(text)) {
    literal = "trailing";
  } else if (CORRECTION_PATTERNS.some((p) => clean.includes(p))) {
    literal = "correction";
  } else if (
    INDIRECT_QUESTION_PATTERNS.some((p) => clean.includes(p)) ||
    clean === "guess" ||
    clean.startsWith("guess ")
  ) {
    literal = "question";
  } else if (REQUEST_PATTERNS.some((p) => clean.includes(p)) || clean.startsWith("please ")) {
    literal = "request";
  } else if (isQuestion(text)) {
    literal = "question";
  } else if (behavior?.act === "request" || behavior?.act === "command") {
    literal = "request";
  } else if (behavior?.tags?.some((t) => ["story", "sharing", "confession"].includes(t))) {
    literal = "story";
  } else if (behavior?.tags?.some((t) => ["opinion", "feeling"].includes(t))) {
    literal = "opinion";
  }
  reasoning.push(`literal=${literal}`);

  // ── Move — evidence-weighted over the 12 move classes ─────────────
  const moveScores: Record<ConversationMove, number> = {
    Ask: 0,
    Answer: 0,
    Comfort: 0,
    Challenge: 0,
    Clarify: 0,
    Repair: 0,
    Reflect: 0,
    Explore: 0,
    Observe: 0,
    Continue: 0,
    Close: 0,
    Wait: 0,
  };
  const evidence: Record<ConversationMove, string[]> = {
    Ask: [],
    Answer: [],
    Comfort: [],
    Challenge: [],
    Clarify: [],
    Repair: [],
    Reflect: [],
    Explore: [],
    Observe: [],
    Continue: [],
    Close: [],
    Wait: [],
  };
  const add = (move: ConversationMove, w: number, why: string) => {
    moveScores[move] += w;
    evidence[move].push(why);
  };

  const hedged =
    HEDGE_WORDS.some((h) => clean.includes(h)) &&
    !behavior?.tags?.includes("opinion") &&
    !behavior?.tags?.includes("story");
  const softHedge = ["maybe", "perhaps", "not sure", "i guess", "kuch", "pata nahi", "shayad"].some(
    (h) => clean.includes(h),
  );
  const ironicPhrase = IRONY_PHRASES.some((p) => clean.includes(p));
  const ironicTag =
    behavior?.tags?.includes("ironic") === true || behavior?.tags?.includes("sarcastic") === true;
  const silent = literal === "silence";
  const longSilence = ctx.timing.silenceDurationMs > 8000;
  const storyLike = behavior?.tags?.some((t) =>
    ["sharing", "confession", "story", "feeling"].includes(t),
  );

  switch (literal) {
    case "greeting":
      add("Continue", 4, "greeting opens/continues the exchange");
      break;
    case "goodbye":
      add("Close", 4, "explicit farewell");
      break;
    case "backchannel":
      if (longSilence) add("Explore", 2, "backchannel after long silence needs re-engagement");
      else add("Continue", 3, "backchannel is a continuation");
      break;
    case "thinking":
      add("Wait", 4, "user holds the floor mid-thought");
      break;
    case "silence":
      add("Wait", 4, "nothing was said — do not fill it");
      break;
    case "trailing":
      add("Wait", 3, "half-thought, nothing to answer yet");
      break;
    case "retraction":
      add("Observe", 3, "user dropped the thread");
      break;
    case "repair":
      add("Repair", 5, "user is correcting AURA's previous reading");
      break;
    case "correction":
      add("Clarify", 4, "user is re-anchoring their own meaning");
      break;
    case "question":
      add("Ask", 4, "user asked a question");
      break;
    case "request":
      add("Ask", 3, "user requested an action");
      break;
    case "story":
      add("Reflect", 3, "user is recounting — witnesses wanted, not judges");
      break;
    default: {
      if (storyLike) {
        add("Reflect", 3, "shared experience invites presence");
      } else {
        add("Answer", 2, "user made a statement");
      }
      break;
    }
  }

  // Cross-signals — always fold into the move evidence
  if (hedged) add("Clarify", 2, "user expressed uncertainty about their own input");
  if (emo.vulnerability > 0.5 && !silent) add("Comfort", 3, "vulnerability is in the room");
  if (emo.vulnerability > 0.35 && !silent) add("Comfort", 1, "moderate vulnerability");
  if (emo.frustration > 0.6) add("Comfort", 2, "frustration venting");
  if (behavior?.act === "debate" || behavior?.tags?.includes("disagreement")) {
    add("Challenge", 3, "explicit debate/disagreement context");
  }
  if (disagreeing) add("Challenge", 3, "disagreement phrasing present");
  if (contradicting) add("Clarify", 2, "user contradicts a prior position");
  if (ironicPhrase || ironicTag) add("Challenge", 2, "irony challenges the surface reading");
  if (emo.energy > 0.7 || (emo.arc === "peak" && emo.energy > 0.6)) {
    add("Reflect", 3, "user is relaying a charged moment");
  }
  if (longSilence && literal === "statement") add("Explore", 2, "stall after long silence");

  // ── Move confidence: softmax over evidence weights ────────────────
  const top = MOVE_OPTIONS.map((m) => ({ m, w: moveScores[m] })).sort((a, b) => b.w - a.w);
  const topMove: ConversationMove = top[0].w > 0 ? top[0].m : "Continue";
  const total = top.reduce((s, t) => s + t.w, 0) || 1;
  const probs = top.map((t) => ({ m: t.m, p: t.w / total }));
  const topProb = probs[0].p;
  const confidenceValue = Math.max(
    0.35,
    Math.min(0.95, 0.5 + (topProb - 0.33) * 0.9 + (stt - 0.5) * 0.25),
  );
  const alternatives = probs
    .filter((t) => t.m !== topMove && t.p > 0)
    .slice(0, 2)
    .map((t) => ({ move: t.m, p: Math.round(t.p * 100) / 100 }));

  // ── Speaker goal ─────────────────────────────────────────────────
  let speakerGoal: SpeakerGoal = "inform";
  const validationAsk = VALIDATION_MARKERS.some(
    (m) => clean.includes(m) || text.toLowerCase().includes(m),
  );
  if (silent) speakerGoal = "think-aloud";
  else if (hedged) speakerGoal = "express-uncertainty";
  else if (literal === "repair" || literal === "correction") speakerGoal = "repair";
  else if (literal === "retraction") speakerGoal = "drop-thread";
  else if (literal === "thinking" || literal === "trailing") speakerGoal = "think-aloud";
  else if (literal === "greeting" || literal === "backchannel") speakerGoal = "small-talk";
  else if (literal === "goodbye") speakerGoal = "close";
  else if (validationAsk) speakerGoal = "seek-validation";
  else if (behavior?.tags?.includes("teaching")) speakerGoal = "teach";
  else if (literal === "question" || literal === "request") {
    speakerGoal = ironicPhrase || ironicTag ? "test-aura" : "seek-information";
  } else if (storyLike || literal === "story") speakerGoal = "tell-story";
  else if (disagreeing) speakerGoal = "debate";
  else if (emo.frustration > 0.6) speakerGoal = "complain";
  else if (emo.vulnerability > 0.5) speakerGoal = "seek-comfort";
  else if (emo.energy > 0.7 || (emo.arc === "peak" && emo.energy > 0.6))
    speakerGoal = "share-excitement";

  // ── Expected response ────────────────────────────────────────────
  let expected: ExpectedResponse = "follow-up";
  switch (topMove) {
    case "Ask":
      expected = literal === "request" ? "advice" : "information";
      break;
    case "Comfort":
      expected = "empathy";
      break;
    case "Repair":
      expected = "clarification";
      break;
    case "Clarify":
      expected = "clarification";
      break;
    case "Reflect":
      expected = "listening";
      break;
    case "Challenge":
      expected = "challenge";
      break;
    case "Wait":
      expected = "silence";
      break;
    case "Close":
      expected = "follow-up";
      break;
    case "Continue":
      expected = "follow-up";
      break;
    case "Observe":
      expected = "silence";
      break;
    default:
      expected = "follow-up";
      break;
  }
  if (speakerGoal === "seek-comfort") expected = "empathy";
  else if (speakerGoal === "tell-story") expected = "listening";
  else if (speakerGoal === "share-excitement") expected = "agreement";
  else if (speakerGoal === "seek-validation") expected = "agreement";
  else if (speakerGoal === "test-aura") expected = "challenge";
  else if (speakerGoal === "express-uncertainty") expected = "clarification";
  else if (speakerGoal === "think-aloud") expected = "silence";
  else if (speakerGoal === "debate") expected = "challenge";
  else if (speakerGoal === "complain") expected = "empathy";
  else if (speakerGoal === "teach") expected = "information";

  // ── Implicit meaning — always with confidence, reasoning, alternatives
  const implicit = deriveImplicitMeaning(text, clean, ctx);
  if (implicit?.label === "hidden-request") expected = "advice";

  // ── Social signals ───────────────────────────────────────────────
  const social: SocialSignal[] = [];
  if (ironicPhrase) {
    social.push({
      name: "sarcasm",
      confidence: literal === "statement" || literal === "opinion" ? 0.7 : 0.5,
      evidence: [`phrase "${clean.slice(0, 40)}" is a known irony pattern`],
    });
  }
  if (ironicTag) {
    social.push({
      name: "irony",
      confidence: 0.8,
      evidence: ["perception tagged this turn ironic"],
    });
  }
  if (hedged || stt < 0.6 || literal === "thinking" || literal === "trailing") {
    social.push({
      name: "hesitation",
      confidence: hedged ? 0.7 : stt < 0.6 ? 0.65 : 0.75,
      evidence: [
        hedged ? "hedge words present" : "",
        stt < 0.6 ? `stt=${stt.toFixed(2)}` : "",
        literal === "thinking" ? "user paused to think" : "",
        literal === "trailing" ? "user trailed off" : "",
      ].filter(Boolean),
    });
  }
  if (wc <= 3 && (emo.energy < 0.35 || ctx.timing.silenceDurationMs > 5000)) {
    social.push({
      name: "withdrawal",
      confidence: 0.6,
      evidence: ["very short utterance", emo.energy < 0.35 ? "low energy" : "long silence"],
    });
  }
  if (emo.energy > 0.7 || (emo.arc === "peak" && emo.energy > 0.6)) {
    social.push({
      name: "excitement",
      confidence: 0.75,
      evidence: [`energy=${emo.energy.toFixed(2)}`, `arc=${emo.arc}`],
    });
  }
  if (behavior?.playfulness !== undefined && behavior.playfulness > 0.6) {
    social.push({
      name: "playfulness",
      confidence: 0.7,
      evidence: [`perception playfulness=${behavior.playfulness.toFixed(2)}`],
    });
  }
  if (emo.frustration > 0.5 || (behavior?.frustration ?? 0) > 0.5) {
    social.push({
      name: "frustration",
      confidence: 0.7,
      evidence: [`frustration=${emo.frustration.toFixed(2)}`],
    });
  }
  if (emo.vulnerability > 0.4 && emo.energy < 0.4 && wc <= 6) {
    social.push({
      name: "embarrassment",
      confidence: 0.55,
      evidence: ["vulnerability + low energy + short utterance"],
    });
  }
  if (stt >= 0.9 && !hedged) {
    social.push({
      name: "user-confidence",
      confidence: 0.7,
      evidence: ["clean transcription", "no hedging"],
    });
  }
  if (
    POLITENESS_MARKERS.some((p) => clean.includes(p)) ||
    ctx.register.register === "PROFESSIONAL"
  ) {
    social.push({
      name: "politeness",
      confidence: 0.7,
      evidence: [
        POLITENESS_MARKERS.some((p) => clean.includes(p)) ? "politeness markers" : "",
        ctx.register.register === "PROFESSIONAL" ? "professional register" : "",
      ].filter(Boolean),
    });
  }
  if (emo.engagement < 0.3) {
    social.push({
      name: "disengagement",
      confidence: 0.65,
      evidence: [`engagement=${emo.engagement.toFixed(2)}`],
    });
  }

  // ── Conversation state ───────────────────────────────────────────
  let state: ConversationState = "building";
  if (ctx.timing.turnCount <= 1 || literal === "greeting") state = "opening";
  else if (literal === "goodbye") state = "ending";
  else if (literal === "repair") state = "repair";
  else if (disagreeing || emo.frustration > 0.6) state = "conflict";
  else if (TOPIC_SHIFT_MARKERS.some((m) => clean.includes(m))) state = "topic-shift";
  else if (storyLike || literal === "story" || literal === "trailing" || literal === "thinking")
    state = "reflection";
  else if (emo.engagement > 0.55 && ctx.timing.turnCount > 5) state = "deepening";

  // ── Shared context — unresolved conversational state ─────────────
  const history = ctx.recentHistory;
  const lastEntry = history.length > 0 ? history[history.length - 1] : undefined;
  const lastUserEntry = [...history].reverse().find((e) => e.isUser);
  const sharedNotes: string[] = [];
  const openQuestion =
    lastUserEntry !== undefined &&
    (isQuestion(lastUserEntry.text) ||
      cleanText(lastUserEntry.text) === "guess" ||
      cleanText(lastUserEntry.text).startsWith("guess "));
  const repairPending =
    lastUserEntry !== undefined &&
    REJECTION_PATTERNS.some((p) => cleanText(lastUserEntry.text).includes(p));
  const topicUnfinished =
    lastUserEntry !== undefined &&
    (lastUserEntry.text.includes("...") || lastUserEntry.text.includes("…"));
  const emotionUnresolved = emo.vulnerability > 0.5 || emo.tension > 0.6;
  const branchActive = TOPIC_SHIFT_MARKERS.some((m) => clean.includes(m));
  if (openQuestion) sharedNotes.push("a question is still on the table");
  if (repairPending) sharedNotes.push("the user is still repairing the reading");
  if (topicUnfinished) sharedNotes.push("the previous thought never landed");
  if (emotionUnresolved) sharedNotes.push("emotion is still unresolved");
  if (branchActive) sharedNotes.push("a new topic branch opened");
  const shared: SharedContext = {
    openQuestion,
    repairPending,
    topicUnfinished,
    emotionUnresolved,
    branchActive,
    notes: Object.freeze(sharedNotes),
  };

  // ── Context signals the policies consume ─────────────────────────
  const rel = ctx.memory.relevanceScores;
  const memoryConflict =
    rel.length >= 2 &&
    (() => {
      const topTwo = [...rel].sort((a, b) => b - a).slice(0, 2);
      return topTwo[0] > 0.5 && Math.abs(topTwo[0] - topTwo[1]) < 0.15;
    })();

  return Object.freeze({
    literal,
    move: topMove,
    speakerGoal,
    expected,
    implicit,
    social: Object.freeze(social),
    state,
    shared: Object.freeze(shared),
    confidence: Object.freeze({
      value: Math.round(confidenceValue * 100) / 100,
      reasoning: Object.freeze([...reasoning, ...(evidence[topMove] ?? [])]),
      alternatives: Object.freeze(alternatives),
    }),
    context: Object.freeze({
      sttConfidence: stt,
      wordCount: wc,
      silenceMs: ctx.timing.silenceDurationMs,
      turnCount: ctx.timing.turnCount,
      memoryConflict,
      ambiguityTagged: behavior?.tags?.includes("ambiguous") === true,
      engagement: emo.engagement,
      vulnerability: emo.vulnerability,
      tension: emo.tension,
      frustration: emo.frustration,
    }),
    raw: Object.freeze({ text, clean, isQuestion: isQuestion(text) }),
  });
}

function deriveImplicitMeaning(
  text: string,
  clean: string,
  ctx: ConversationContext,
): ImplicitMeaning | null {
  const emo = ctx.emotion;

  if (IMPLICIT_HIDDEN_REQUEST.some((p) => clean.includes(p))) {
    return {
      label: "hidden-request",
      confidence: 0.7,
      reasoning: ["courtesy phrasing frames an actual request as a question"],
      alternatives: ["statement-only", "seeking-reassurance"],
    };
  }
  if (IMPLICIT_NOT_FINE.some((p) => clean.includes(p)) && emo.vulnerability > 0.3) {
    return {
      label: "not-fine",
      confidence: 0.7,
      reasoning: ["surface answer is a stock phrase", "vulnerability signal contradicts it"],
      alternatives: ["fine", "dismissive"],
    };
  }
  if (IMPLICIT_TIRED.some((p) => clean.includes(p))) {
    return {
      label: "needs-empathy",
      confidence: 0.8,
      reasoning: ["fatigue phrasing is a request for care, not a report"],
      alternatives: ["needs-advice", "statement-only"],
    };
  }
  if (IMPLICIT_REASSURANCE.some((p) => clean.includes(p))) {
    return {
      label: "seeking-reassurance",
      confidence: 0.75,
      reasoning: ["loss-phrasing is a reach for grounding"],
      alternatives: ["seeking-information", "venting"],
    };
  }
  if (
    (ctx.behaviorAnalysis?.tags?.includes("ironic") === true ||
      ctx.behaviorAnalysis?.tags?.includes("sarcastic") === true ||
      IRONY_PHRASES.some((p) => clean.includes(p))) &&
    text.length > 0
  ) {
    return {
      label: "dissatisfied",
      confidence: 0.65,
      reasoning: ["irony masks a negative judgment about the literal subject"],
      alternatives: ["literal-praise", "playful-teasing"],
    };
  }
  if (clean.includes("i m fine") || clean === "fine" || clean === "ok") {
    // No contradiction from perception → take it at face value but flag it.
    return {
      label: "fine",
      confidence: 0.8,
      reasoning: ["no contradicting perception signal"],
      alternatives: ["not-fine"],
    };
  }
  if (emo.vulnerability > 0.35 && ctx.timing.turnCount > 1 && clean.length < 8) {
    return {
      label: "withdrawing",
      confidence: 0.55,
      reasoning: ["short reply against a heavy emotional backdrop"],
      alternatives: ["statement-only", "fatigue"],
    };
  }
  return null;
}

// ─── Helpers the policies consume (single-owner exports) ────────────

export function isBackchannel(text: string): boolean {
  const words = cleanTokens(text);
  if (words.length === 0) return false;
  if (words.length <= 3 && BACKCHANNELS.has(words[0])) return true;
  return words.every((w) => BACKCHANNELS.has(w));
}

export function isGreeting(text: string): boolean {
  const c = cleanText(text);
  const first = c.split(/\s+/)[0] ?? "";
  return GREETINGS.has(c) || GREETINGS.has(first);
}

export function isFarewell(text: string): boolean {
  const c = cleanText(text);
  const first = c.split(/\s+/)[0] ?? "";
  return FAREWELLS.has(c) || FAREWELLS.has(first);
}
