/**
 * Phase 11 — Conversation Understanding Index (CUI): human benchmark.
 *
 * 100+ curated real-conversation scenarios with a human conversationalist's
 * ground-truth reading of the room. Every scenario measures the CUE surface
 * the Executive consumes: move, speaker goal, expected response, implicit
 * meaning, conversation state, and the strategy that results.
 *
 * Metrics produced:
 *   - Per-dimension accuracy (move / goal / expected / state / implicit / strategy)
 *   - Social signal precision & recall (sarcasm, hesitation, withdrawal)
 *   - Confidence calibration (accuracy per confidence bin)
 *   - Human agreement (strict full-turn match, lenient move+goal match)
 *   - Conversation Understanding Index — the weighted composite
 *
 * Run: npx tsx scripts/test-understanding-benchmark.ts
 */
import { ConversationExecutive } from "../src/executive/ConversationExecutive";
import { buildConversationContext } from "../src/executive/ConversationContext";
import { StrategyPlanner } from "../src/executive/StrategyPlanner";
import { understand } from "../src/executive/ConversationUnderstanding";
import type { ConversationUnderstanding } from "../src/executive/ConversationUnderstanding";
import type { ConversationContext } from "../src/executive/ConversationContext";
import type {
  ConversationMove,
  SpeakerGoal,
  ExpectedResponse,
  ConversationState,
} from "../src/executive/ConversationUnderstanding";
import type { Strategy } from "../src/executive/ExecutionPlan";

const exec = new ConversationExecutive();
const planner = new StrategyPlanner();

interface BScenario {
  t: string;
  m?: ConversationMove;
  g?: SpeakerGoal;
  e?: ExpectedResponse;
  s?: ConversationState;
  /** Expected implicit label; "" means "no implicit meaning". */
  i?: string;
  S?: Strategy[];
  /** Social signals that must be present / absent. */
  soc?: string[];
  socAbs?: string[];
  c?: Partial<ConversationContext>;
  note: string;
}

// ─── The benchmark set (human-read ground truth) ─────────────────────
const B: BScenario[] = [
  // ── Greetings ─────────────────────────────────────────────────────
  {
    t: "Hello!",
    m: "Continue",
    g: "small-talk",
    s: "opening",
    i: "",
    S: ["Answer"],
    note: "Plain greeting, return it.",
  },
  {
    t: "Hey Aura, good morning!",
    m: "Continue",
    g: "small-talk",
    s: "opening",
    i: "",
    note: "Greeting with name.",
  },
  { t: "Namaste", m: "Continue", g: "small-talk", s: "opening", i: "", note: "Hindi greeting." },
  { t: "Yo", m: "Continue", g: "small-talk", s: "opening", i: "", note: "Casual greeting." },
  {
    t: "Hi! Long time no see",
    m: "Continue",
    g: "small-talk",
    s: "opening",
    i: "",
    note: "Reconnection greeting.",
  },

  // ── Goodbyes ──────────────────────────────────────────────────────
  {
    t: "Bye, talk to you later",
    m: "Close",
    g: "close",
    s: "ending",
    i: "",
    S: ["Redirect"],
    note: "Warm close.",
  },
  {
    t: "Gotta go, see you later",
    m: "Close",
    g: "close",
    s: "ending",
    i: "",
    note: "Rushed close.",
  },
  { t: "Goodnight", m: "Close", g: "close", s: "ending", i: "", note: "Night close." },
  { t: "I have to go now", m: "Close", g: "close", s: "ending", i: "", note: "Duty close." },
  { t: "That's all for today", m: "Close", g: "close", s: "ending", i: "", note: "Wrap-up close." },

  // ── Backchannels ──────────────────────────────────────────────────
  { t: "Yeah yeah", m: "Continue", g: "small-talk", i: "", note: "Continuation." },
  { t: "Hmm", m: "Continue", g: "small-talk", i: "", note: "Minimal acknowledgment." },
  { t: "Okay okay", m: "Continue", g: "small-talk", i: "", note: "Agreement." },
  { t: "Mhm", m: "Continue", g: "small-talk", i: "", note: "Listening token." },
  { t: "True, true", m: "Continue", g: "small-talk", i: "", note: "Concession." },
  { t: "Acha", m: "Continue", g: "small-talk", i: "", note: "Hindi acknowledgment." },

  // ── Backchannel after long silence → re-engage ────────────────────
  {
    t: "Hmm",
    m: "Explore",
    c: { timing: { silenceDurationMs: 12000, turnCount: 10 } },
    g: "small-talk",
    i: "",
    S: ["Ask"],
    note: "Silence then token — re-engage gently.",
  },
  {
    t: "Yeah",
    m: "Explore",
    c: { timing: { silenceDurationMs: 10000, turnCount: 12 } },
    g: "small-talk",
    i: "",
    note: "Stalled thread.",
  },

  // ── Direct questions ──────────────────────────────────────────────
  {
    t: "What's the weather like today?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    s: "building",
    i: "",
    S: ["Answer"],
    note: "Direct information request.",
  },
  {
    t: "Kal kya plan hai?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    s: "building",
    i: "",
    S: ["Answer"],
    note: "Hinglish question.",
  },
  {
    t: "Where are my keys?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    s: "building",
    i: "",
    note: "Practical query.",
  },
  {
    t: "How was your trip to Goa?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    s: "building",
    i: "",
    note: "Narrative query.",
  },
  {
    t: "What time is the movie?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    s: "building",
    i: "",
    note: "Factual query.",
  },
  {
    t: "What do you think about the new policy?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    s: "building",
    i: "",
    note: "Opinion query.",
  },
  {
    t: "Kaise ho?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    s: "building",
    i: "",
    note: "Hinglish check-in.",
  },

  // ── Indirect questions ────────────────────────────────────────────
  {
    t: "I was wondering if you could help me with this",
    m: "Ask",
    g: "seek-information",
    e: "information",
    i: "",
    note: "Polite indirect ask.",
  },
  {
    t: "Do you happen to know where the station is?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    i: "",
    note: "Softened question.",
  },
  {
    t: "Just curious — how long have you lived here?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    i: "",
    note: "Curiosity framing.",
  },
  {
    t: "You know what would be nice? Coffee.",
    m: "Ask",
    g: "seek-information",
    e: "information",
    i: "",
    note: "Framed suggestion.",
  },

  // ── Requests ──────────────────────────────────────────────────────
  {
    t: "Could you please turn off the lights?",
    m: "Ask",
    g: "seek-information",
    e: "advice",
    i: "",
    S: ["Answer"],
    note: "Polite command.",
  },
  {
    t: "Can you please help me carry this?",
    m: "Ask",
    g: "seek-information",
    e: "advice",
    i: "",
    note: "Help request.",
  },
  {
    t: "Can you help me with my homework?",
    m: "Ask",
    g: "seek-information",
    e: "advice",
    i: "",
    note: "Help request, question form.",
  },
  {
    t: "Help me find my phone",
    m: "Ask",
    g: "seek-information",
    e: "advice",
    i: "",
    note: "Direct imperative.",
  },
  {
    t: "Please pass the salt",
    m: "Ask",
    g: "seek-information",
    e: "advice",
    i: "",
    note: "Polite imperative.",
  },
  {
    t: "Would you mind opening the window?",
    m: "Ask",
    g: "seek-information",
    e: "advice",
    i: "",
    note: "Hedged request.",
  },
  {
    t: "I need you to book a cab",
    m: "Ask",
    g: "seek-information",
    e: "advice",
    i: "",
    note: "Explicit request.",
  },
  {
    t: "Kindly send the report",
    m: "Ask",
    g: "seek-information",
    e: "advice",
    i: "",
    note: "Formal request.",
  },

  // ── Repair (rejection of AURA's reading) ──────────────────────────
  {
    t: "No, that's not what I meant.",
    m: "Repair",
    g: "repair",
    e: "clarification",
    s: "repair",
    i: "",
    S: ["Clarify", "Reflect", "Redirect"],
    note: "Direct misalignment.",
  },
  {
    t: "You misunderstood me.",
    m: "Repair",
    g: "repair",
    e: "clarification",
    s: "repair",
    i: "",
    note: "Blame-style repair.",
  },
  {
    t: "That's wrong.",
    m: "Repair",
    g: "repair",
    e: "clarification",
    s: "repair",
    i: "",
    note: "Flat rejection.",
  },
  {
    t: "No, I meant the blue one.",
    m: "Repair",
    g: "repair",
    e: "clarification",
    s: "repair",
    i: "",
    note: "Corrective re-anchor.",
  },
  {
    t: "That's not right.",
    m: "Repair",
    g: "repair",
    e: "clarification",
    s: "repair",
    i: "",
    note: "Soft rejection.",
  },
  {
    t: "Wait, no — that's not what I said.",
    m: "Repair",
    g: "repair",
    e: "clarification",
    s: "repair",
    i: "",
    note: "Held then repaired.",
  },
  {
    t: "No no no, I didn't say that.",
    m: "Repair",
    g: "repair",
    e: "clarification",
    s: "repair",
    i: "",
    note: "Emphatic repair.",
  },
  {
    t: "You got it wrong.",
    m: "Repair",
    g: "repair",
    e: "clarification",
    s: "repair",
    i: "",
    note: "Accusatory repair.",
  },
  {
    t: "I didn't mean it like that.",
    m: "Repair",
    g: "repair",
    e: "clarification",
    s: "repair",
    i: "",
    note: "Soft repair.",
  },
  {
    t: "But you said the opposite earlier!",
    m: "Repair",
    g: "repair",
    e: "clarification",
    s: "repair",
    i: "",
    note: "Contradiction repair.",
  },

  // ── Retraction ────────────────────────────────────────────────────
  { t: "Never mind, forget it.", m: "Observe", g: "drop-thread", i: "", note: "Thread dropped." },
  {
    t: "Forget it, let's move on.",
    m: "Observe",
    g: "drop-thread",
    i: "",
    note: "Thread abandoned.",
  },
  { t: "Leave it, skip it.", m: "Observe", g: "drop-thread", i: "", note: "Brush-off." },
  { t: "Ditch that, forget it", m: "Observe", g: "drop-thread", i: "", note: "Dismissal." },

  // ── Correction (self re-anchor) ───────────────────────────────────
  {
    t: "Well, actually I meant the other one.",
    m: "Clarify",
    g: "repair",
    e: "clarification",
    i: "",
    note: "Self-correction.",
  },
  {
    t: "What I meant was the earlier plan.",
    m: "Clarify",
    g: "repair",
    e: "clarification",
    i: "",
    note: "Re-anchor with detail.",
  },
  {
    t: "I was trying to say something else.",
    m: "Clarify",
    g: "repair",
    e: "clarification",
    i: "",
    note: "Attempted re-anchor.",
  },
  {
    t: "I mean, it's fine really",
    m: "Clarify",
    g: "repair",
    e: "clarification",
    i: "",
    note: "Soft self-repair.",
  },

  // ── Thinking / hold ───────────────────────────────────────────────
  {
    t: "hmm, wait, let me think...",
    m: "Wait",
    g: "think-aloud",
    e: "silence",
    i: "",
    S: ["Listen", "Observe"],
    note: "Floor held mid-thought.",
  },
  {
    t: "Hold on, one sec",
    m: "Wait",
    g: "think-aloud",
    e: "silence",
    i: "",
    note: "Explicit hold.",
  },
  {
    t: "Let me check my calendar",
    m: "Wait",
    g: "think-aloud",
    e: "silence",
    i: "",
    note: "Task hold.",
  },
  {
    t: "Hang on a minute",
    m: "Wait",
    g: "think-aloud",
    e: "silence",
    i: "",
    note: "Holding the floor.",
  },
  { t: "Give me a sec", m: "Wait", g: "think-aloud", e: "silence", i: "", note: "Brief hold." },
  { t: "Just a moment", m: "Wait", g: "think-aloud", e: "silence", i: "", note: "Soft hold." },

  // ── Trailing off ──────────────────────────────────────────────────
  {
    t: "And then I thought... you know...",
    m: "Wait",
    g: "think-aloud",
    e: "silence",
    i: "",
    S: ["Listen", "Observe"],
    note: "Half-thought.",
  },
  {
    t: "So if we... hmm...",
    m: "Wait",
    g: "think-aloud",
    e: "silence",
    i: "",
    note: "Trail into silence.",
  },
  {
    t: "It's just that... I mean...",
    m: "Wait",
    g: "think-aloud",
    e: "silence",
    i: "",
    note: "Failed launch.",
  },

  // ── Silence ───────────────────────────────────────────────────────
  { t: "", m: "Wait", g: "think-aloud", e: "silence", i: "", note: "Nothing said." },
  {
    t: "…",
    m: "Wait",
    g: "think-aloud",
    e: "silence",
    i: "",
    note: "Silence token.",
    c: { input: { sttConfidence: 0.1 } },
  },

  // ── Stories / sharing ─────────────────────────────────────────────
  {
    t: "I broke up with my girlfriend yesterday",
    m: "Reflect",
    g: "tell-story",
    e: "listening",
    i: "",
    S: ["Reflect", "Listen"],
    note: "Raw share, needs presence.",
    c: {
      emotion: { vulnerability: 0.5, tension: 0.4 },
      behaviorAnalysis: { act: "share", tags: ["sharing", "story"], intensity: 0.6 },
    },
  },
  {
    t: "We went to Goa and it was amazing",
    m: "Reflect",
    g: "tell-story",
    e: "listening",
    i: "",
    note: "Happy recount.",
    c: { behaviorAnalysis: { act: "share", tags: ["story"], intensity: 0.5 } },
  },
  {
    t: "My father passed away last year",
    m: "Comfort",
    g: "tell-story",
    e: "listening",
    i: "",
    note: "Grief share.",
    c: {
      emotion: { vulnerability: 0.6 },
      behaviorAnalysis: { act: "share", tags: ["sharing", "story"], intensity: 0.7 },
    },
  },
  {
    t: "I've been thinking about my father a lot",
    m: "Comfort",
    g: "tell-story",
    e: "listening",
    i: "",
    note: "Reflective share.",
    c: {
      emotion: { vulnerability: 0.55 },
      behaviorAnalysis: { act: "share", tags: ["sharing"], intensity: 0.5 },
    },
  },
  {
    t: "My exam went really well",
    m: "Reflect",
    g: "tell-story",
    e: "listening",
    i: "",
    note: "Pride share.",
    c: {
      emotion: { energy: 0.7 },
      behaviorAnalysis: { act: "share", tags: ["story"], intensity: 0.5 },
    },
  },
  {
    t: "I had the worst day at work",
    m: "Reflect",
    g: "tell-story",
    e: "listening",
    i: "",
    note: "Woe share.",
    c: {
      emotion: { vulnerability: 0.5 },
      behaviorAnalysis: { act: "share", tags: ["feeling"], intensity: 0.6 },
    },
  },
  {
    t: "Let me tell you what happened today",
    m: "Reflect",
    g: "tell-story",
    e: "listening",
    i: "",
    note: "Story opening.",
    c: { behaviorAnalysis: { act: "share", tags: ["sharing"], intensity: 0.5 } },
  },
  {
    t: "I finally quit my job",
    m: "Reflect",
    g: "tell-story",
    e: "listening",
    i: "",
    note: "Life update.",
    c: { behaviorAnalysis: { act: "share", tags: ["sharing", "story"], intensity: 0.6 } },
  },

  // ── Opinions ──────────────────────────────────────────────────────
  {
    t: "I think that movie is overrated",
    m: "Answer",
    g: "inform",
    i: "",
    note: "Opinion statement.",
    c: { behaviorAnalysis: { act: "state", tags: ["opinion"], intensity: 0.5 } },
  },
  {
    t: "That place has the best food in town",
    m: "Answer",
    g: "inform",
    i: "",
    note: "Positive opinion.",
    c: { behaviorAnalysis: { act: "state", tags: ["opinion"], intensity: 0.6 } },
  },
  {
    t: "Honestly, this plan won't work",
    m: "Answer",
    g: "inform",
    i: "",
    note: "Negative opinion.",
    c: { behaviorAnalysis: { act: "state", tags: ["opinion"], intensity: 0.6 } },
  },
  {
    t: "The new update is a mess",
    m: "Answer",
    g: "inform",
    i: "",
    note: "Product gripe.",
    c: { behaviorAnalysis: { act: "state", tags: ["opinion"], intensity: 0.5 } },
  },

  // ── Hedges ────────────────────────────────────────────────────────
  {
    t: "I think maybe we should change the plan",
    m: "Answer",
    g: "express-uncertainty",
    e: "clarification",
    i: "",
    S: ["Clarify", "Observe", "Ask", "Answer"],
    soc: ["hesitation"],
    note: "Unsure suggestion.",
    c: { emotion: { vulnerability: 0.25 } },
  },
  {
    t: "Not sure about this",
    m: "Answer",
    g: "express-uncertainty",
    e: "clarification",
    i: "",
    soc: ["hesitation"],
    note: "Outright unsure.",
  },
  {
    t: "I guess we could try that",
    m: "Answer",
    g: "express-uncertainty",
    e: "clarification",
    i: "",
    soc: ["hesitation"],
    note: "Tentative agree.",
  },
  {
    t: "Perhaps we should wait",
    m: "Answer",
    g: "express-uncertainty",
    e: "clarification",
    i: "",
    soc: ["hesitation"],
    note: "Soft suggestion.",
  },
  {
    t: "Kuch pata nahi",
    m: "Answer",
    g: "express-uncertainty",
    e: "clarification",
    i: "",
    soc: ["hesitation"],
    note: "Hinglish unsure.",
  },
  {
    t: "Shayad kal",
    m: "Answer",
    g: "express-uncertainty",
    e: "clarification",
    i: "",
    soc: ["hesitation"],
    note: "Maybe tomorrow.",
  },

  // ── Sarcasm / irony ───────────────────────────────────────────────
  {
    t: "Oh great, another crash. Just what I needed.",
    m: "Answer",
    g: "inform",
    i: "dissatisfied",
    soc: ["sarcasm"],
    note: "Ironic complaint.",
    c: { emotion: { frustration: 0.5 } },
  },
  {
    t: "Yeah right, sure it worked perfectly",
    m: "Answer",
    g: "inform",
    i: "dissatisfied",
    soc: ["sarcasm"],
    note: "Skeptical dismissal.",
  },
  {
    t: "Oh joy, another meeting",
    m: "Answer",
    g: "inform",
    i: "dissatisfied",
    soc: ["sarcasm"],
    note: "Deadpan.",
  },
  {
    t: "Sure, because that always works",
    m: "Answer",
    g: "inform",
    i: "dissatisfied",
    soc: ["sarcasm"],
    note: "Rhetorical jab.",
  },
  {
    t: "What a surprise, the wifi is down again",
    m: "Answer",
    g: "inform",
    i: "dissatisfied",
    soc: ["sarcasm"],
    note: "Weary sarcasm.",
  },
  {
    t: "As if I'd ever trust that again",
    m: "Answer",
    g: "inform",
    i: "dissatisfied",
    soc: ["sarcasm"],
    note: "Dismissive irony.",
  },
  {
    t: "Oh really, you don't say",
    m: "Answer",
    g: "inform",
    i: "dissatisfied",
    soc: ["sarcasm"],
    note: "Dry irony.",
  },
  {
    t: "What's the weather like today?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    socAbs: ["sarcasm"],
    note: "Literal question — no sarcasm.",
  },

  // ── Disagreement ──────────────────────────────────────────────────
  {
    t: "I disagree with that take.",
    m: "Challenge",
    g: "debate",
    e: "challenge",
    s: "conflict",
    i: "",
    S: ["Challenge", "Reflect"],
    note: "Direct counter.",
  },
  {
    t: "I don't agree with that at all",
    m: "Challenge",
    g: "debate",
    e: "challenge",
    s: "conflict",
    i: "",
    note: "Flat disagreement.",
  },
  {
    t: "I don't think so.",
    m: "Challenge",
    g: "debate",
    e: "challenge",
    s: "conflict",
    i: "",
    note: "Terse rebuttal.",
  },
  {
    t: "That's debatable.",
    m: "Challenge",
    g: "debate",
    e: "challenge",
    s: "conflict",
    i: "",
    note: "Challenge by understatement.",
  },
  {
    t: "You're not right about this",
    m: "Challenge",
    g: "debate",
    e: "challenge",
    s: "conflict",
    i: "",
    note: "Direct refutation.",
  },
  {
    t: "Here's my counterpoint:",
    m: "Challenge",
    g: "debate",
    e: "challenge",
    s: "conflict",
    i: "",
    note: "Structured rebuttal.",
  },

  // ── Vulnerability / comfort ───────────────────────────────────────
  {
    t: "I'm so scared about the surgery",
    m: "Comfort",
    g: "seek-comfort",
    e: "empathy",
    i: "",
    S: ["Comfort"],
    note: "Fear share.",
    c: { emotion: { vulnerability: 0.8, tension: 0.7 } },
  },
  {
    t: "I'm really anxious about the interview tomorrow",
    m: "Comfort",
    g: "seek-comfort",
    e: "empathy",
    i: "",
    note: "Anxiety share.",
    c: { emotion: { vulnerability: 0.7, tension: 0.6 } },
  },
  {
    t: "I feel like I'm failing at everything",
    m: "Comfort",
    g: "seek-comfort",
    e: "empathy",
    i: "",
    note: "Defeat share.",
    c: { emotion: { vulnerability: 0.75 } },
  },
  {
    t: "Nobody understands me",
    m: "Comfort",
    g: "seek-comfort",
    e: "empathy",
    i: "",
    note: "Alienation share.",
    c: { emotion: { vulnerability: 0.7 } },
  },
  {
    t: "I keep messing everything up",
    m: "Comfort",
    g: "seek-comfort",
    e: "empathy",
    i: "",
    note: "Self-blame.",
    c: { emotion: { vulnerability: 0.7 } },
  },
  {
    t: "Sometimes I feel so alone",
    m: "Comfort",
    g: "seek-comfort",
    e: "empathy",
    i: "",
    note: "Loneliness share.",
    c: { emotion: { vulnerability: 0.8 } },
  },
  {
    t: "It's been a really hard week",
    m: "Comfort",
    g: "seek-comfort",
    e: "empathy",
    i: "",
    note: "Weariness share.",
    c: { emotion: { vulnerability: 0.6 } },
  },
  {
    t: "I'm not sure I can do this",
    m: "Comfort",
    g: "express-uncertainty",
    e: "clarification",
    i: "",
    note: "Unsure + vulnerable — probe gently.",
    c: { emotion: { vulnerability: 0.65 } },
  },
  // ── Frustration ───────────────────────────────────────────────────
  {
    t: "This is so frustrating!",
    m: "Answer",
    g: "complain",
    e: "empathy",
    i: "",
    note: "Pure vent.",
    c: { emotion: { frustration: 0.75 } },
  },
  {
    t: "Ugh, why does this always happen",
    m: "Ask",
    g: "seek-information",
    e: "information",
    i: "",
    note: "Rhetorical complaint in question form.",
    c: { emotion: { frustration: 0.7 } },
  },
  {
    t: "I'm so sick of this app crashing",
    m: "Answer",
    g: "complain",
    e: "empathy",
    i: "",
    note: "Product vent.",
    c: { emotion: { frustration: 0.7 } },
  },
  {
    t: "Stop telling me what to do!",
    m: "Ask",
    g: "seek-information",
    e: "advice",
    i: "",
    note: "Frustrated command.",
    c: {
      emotion: { frustration: 0.7 },
      behaviorAnalysis: { act: "command", tags: ["command"], intensity: 0.8 },
    },
  },
  {
    t: "This is not working, fix it now",
    m: "Ask",
    g: "seek-information",
    e: "advice",
    i: "",
    S: ["Answer"],
    note: "Frustrated fix-request.",
    c: {
      emotion: { frustration: 0.75 },
      behaviorAnalysis: { act: "command", tags: ["command"], intensity: 0.8 },
    },
  },

  // ── Excitement ────────────────────────────────────────────────────
  {
    t: "I got the job! I actually got it!",
    m: "Reflect",
    g: "share-excitement",
    e: "agreement",
    i: "",
    S: ["Encourage", "Reflect"],
    soc: ["excitement"],
    note: "Triumph share.",
    c: { emotion: { arc: "peak", energy: 0.8, engagement: 0.9 } },
  },
  {
    t: "We're going to Japan!!",
    m: "Reflect",
    g: "share-excitement",
    e: "agreement",
    i: "",
    soc: ["excitement"],
    note: "Travel excitement.",
    c: { emotion: { energy: 0.85 } },
  },
  {
    t: "I finally did it!!",
    m: "Reflect",
    g: "share-excitement",
    e: "agreement",
    i: "",
    soc: ["excitement"],
    note: "Milestone joy.",
    c: { emotion: { arc: "peak", energy: 0.8 } },
  },
  {
    t: "This is the best day ever",
    m: "Reflect",
    g: "share-excitement",
    e: "agreement",
    i: "",
    soc: ["excitement"],
    note: "Peak day statement.",
    c: { emotion: { energy: 0.8 } },
  },

  // ── Seeking validation ────────────────────────────────────────────
  {
    t: "I did the right thing, right?",
    m: "Ask",
    g: "seek-validation",
    e: "agreement",
    i: "",
    note: "Tag-question reassurance.",
    c: { emotion: { vulnerability: 0.6 } },
  },
  {
    t: "Was that the right call?",
    m: "Ask",
    g: "seek-validation",
    e: "agreement",
    i: "",
    note: "Decision doubt.",
    c: { emotion: { vulnerability: 0.5 } },
  },
  {
    t: "Does that make sense?",
    m: "Ask",
    g: "seek-validation",
    e: "agreement",
    i: "",
    note: "Comprehension check.",
  },
  {
    t: "Am I right?",
    m: "Ask",
    g: "seek-validation",
    e: "agreement",
    i: "",
    note: "Direct validation ask.",
  },
  {
    t: "Tell me I'm not crazy",
    m: "Comfort",
    g: "seek-validation",
    e: "agreement",
    i: "",
    note: "Reassurance plea.",
    c: { emotion: { vulnerability: 0.6 } },
  },

  // ── Implicit: hidden requests ─────────────────────────────────────
  {
    t: "It's really hot in here.",
    m: "Answer",
    g: "inform",
    e: "advice",
    i: "hidden-request",
    note: "Air-conditioning hint.",
    c: { emotion: { energy: 0.3 } },
  },
  {
    t: "I'm so hungry",
    m: "Answer",
    g: "inform",
    e: "advice",
    i: "hidden-request",
    note: "Food hint.",
    c: { emotion: { energy: 0.3 } },
  },
  {
    t: "I'm thirsty",
    m: "Answer",
    g: "inform",
    e: "advice",
    i: "hidden-request",
    note: "Water hint.",
  },
  {
    t: "It's too bright in here",
    m: "Answer",
    g: "inform",
    e: "advice",
    i: "hidden-request",
    note: "Lighting hint.",
    c: { emotion: { energy: 0.3 } },
  },
  {
    t: "I can't see anything",
    m: "Answer",
    g: "inform",
    e: "advice",
    i: "hidden-request",
    note: "Visibility hint.",
  },
  {
    t: "It's so noisy outside",
    m: "Answer",
    g: "inform",
    e: "advice",
    i: "hidden-request",
    note: "Noise hint.",
    c: { emotion: { energy: 0.3 } },
  },
  {
    t: "It's so dark in here",
    m: "Answer",
    g: "inform",
    e: "advice",
    i: "hidden-request",
    note: "Darkness hint.",
  },

  // ── Implicit: not-fine ────────────────────────────────────────────
  {
    t: "I'm fine.",
    m: "Comfort",
    g: "seek-comfort",
    e: "empathy",
    i: "not-fine",
    note: "Stock answer over vulnerability.",
    c: { emotion: { vulnerability: 0.6, energy: 0.3 } },
  },
  {
    t: "I'm okay.",
    m: "Comfort",
    g: "seek-comfort",
    e: "empathy",
    i: "not-fine",
    note: "Same, softer.",
    c: { emotion: { vulnerability: 0.55 } },
  },
  {
    t: "I'm fine.",
    m: "Answer",
    g: "inform",
    e: "follow-up",
    i: "fine",
    note: "No contradiction — take at face value.",
  },
  {
    t: "I'm fine.",
    m: "Comfort",
    g: "seek-comfort",
    e: "empathy",
    i: "not-fine",
    note: "Late, low-energy, vulnerable.",
    c: { emotion: { vulnerability: 0.8, energy: 0.2 } },
  },

  // ── Implicit: seeking reassurance ─────────────────────────────────
  {
    t: "I don't know what to do anymore",
    m: "Answer",
    g: "inform",
    e: "follow-up",
    i: "seeking-reassurance",
    note: "Lost-phrasing reach for grounding.",
    c: { emotion: { vulnerability: 0.4 } },
  },
  {
    t: "I'm lost",
    m: "Answer",
    g: "inform",
    e: "follow-up",
    i: "seeking-reassurance",
    note: "Explicit lost.",
    c: { emotion: { vulnerability: 0.4 } },
  },
  {
    t: "What's the point anymore?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    i: "seeking-reassurance",
    note: "Question form of despair.",
    c: { emotion: { vulnerability: 0.5 } },
  },

  // ── Topic shift ───────────────────────────────────────────────────
  {
    t: "Anyway, back to what we were discussing",
    m: "Answer",
    g: "inform",
    s: "topic-shift",
    i: "",
    note: "Re-ground.",
  },
  {
    t: "By the way, do you know Sarah?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    s: "topic-shift",
    i: "",
    note: "Branching question.",
  },
  {
    t: "Speaking of trips, how was yours?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    s: "topic-shift",
    i: "",
    note: "Associative shift.",
  },
  {
    t: "On another note, I'm moving to Mumbai",
    m: "Answer",
    g: "inform",
    s: "topic-shift",
    i: "",
    note: "Fresh topic.",
  },

  // ── Memory conflict & misc ────────────────────────────────────────
  {
    t: "Remember when I moved to Delhi?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    i: "",
    note: "Conflicting memories on the table.",
    c: { memory: { relevanceScores: [0.72, 0.61, 0.2] } },
  },
  {
    t: "Teach me some Spanish",
    m: "Ask",
    g: "teach",
    e: "information",
    i: "",
    note: "Teaching ask.",
    c: { behaviorAnalysis: { act: "request", tags: ["teaching"], intensity: 0.6 } },
  },
  {
    t: "Thank you so much!",
    m: "Answer",
    g: "inform",
    e: "follow-up",
    i: "",
    soc: ["politeness"],
    note: "Gratitude.",
  },
  { t: "You're so smart", m: "Answer", g: "inform", e: "follow-up", i: "", note: "Compliment." },
  {
    t: "Okay, okay",
    m: "Continue",
    g: "small-talk",
    i: "",
    note: "Backchannel.",
    c: { emotion: { energy: 0.3 } },
  },
  { t: "Please", m: "Answer", g: "inform", i: "", note: "Bare politeness." },
  { t: "Hmm?", m: "Continue", g: "small-talk", i: "", note: "Prompt for more." },
  {
    t: "Wait, don't answer yet",
    m: "Wait",
    g: "think-aloud",
    e: "silence",
    i: "",
    note: "Explicit hold.",
  },
  {
    t: "So… what do you think?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    i: "",
    note: "Nudge for a view.",
  },
  {
    t: "I did the right thing, right?",
    m: "Ask",
    g: "seek-validation",
    e: "agreement",
    i: "",
    note: "Tag question at 0.55 STT.",
    c: { input: { sttConfidence: 0.55 } },
  },
  {
    t: "The movie starts at 8, right?",
    m: "Ask",
    g: "seek-validation",
    e: "agreement",
    i: "",
    note: "Validation at 0.6 STT.",
    c: { input: { sttConfidence: 0.6 } },
  },
  {
    t: "maybe try the other one",
    m: "Answer",
    g: "express-uncertainty",
    e: "clarification",
    i: "",
    note: "Hedge at 0.6 STT.",
    c: { input: { sttConfidence: 0.6 } },
  },
  {
    t: "I think maybe",
    m: "Answer",
    g: "express-uncertainty",
    e: "clarification",
    i: "",
    note: "Terse hedge at 0.5 STT.",
    c: { input: { sttConfidence: 0.5 } },
  },
  {
    t: "okay",
    m: "Continue",
    g: "small-talk",
    i: "",
    soc: ["withdrawal"],
    note: "One word after a long pause, low energy.",
    c: { emotion: { energy: 0.3 }, timing: { silenceDurationMs: 6000 } },
  },
  {
    t: "yeah",
    m: "Continue",
    g: "small-talk",
    i: "",
    socAbs: ["withdrawal"],
    note: "Brisk acknowledgment — no withdrawal.",
    c: { emotion: { energy: 0.7 } },
  },
  {
    t: "What's the weather like today?",
    m: "Ask",
    g: "seek-information",
    e: "information",
    socAbs: ["hesitation"],
    note: "Confident question — no hesitation.",
  },
];

// ─── Execution & scoring ─────────────────────────────────────────────
interface Tally {
  total: number;
  hit: number;
  miss: number;
  misses: string[];
}

const moveT: Tally = { total: 0, hit: 0, miss: 0, misses: [] };
const goalT: Tally = { total: 0, hit: 0, miss: 0, misses: [] };
const expectT: Tally = { total: 0, hit: 0, miss: 0, misses: [] };
const stateT: Tally = { total: 0, hit: 0, miss: 0, misses: [] };
const implicitT: Tally = { total: 0, hit: 0, miss: 0, misses: [] };
const strategyT: Tally = { total: 0, hit: 0, miss: 0, misses: [] };

const socialStats: Record<string, { tp: number; fp: number; fn: number }> = {
  sarcasm: { tp: 0, fp: 0, fn: 0 },
  hesitation: { tp: 0, fp: 0, fn: 0 },
  withdrawal: { tp: 0, fp: 0, fn: 0 },
};

const calibBins: Record<string, { correct: number; total: number }> = {
  "0.40-0.55": { correct: 0, total: 0 },
  "0.55-0.70": { correct: 0, total: 0 },
  "0.70-0.85": { correct: 0, total: 0 },
  "0.85-1.00": { correct: 0, total: 0 },
};

let strictAgree = 0;
let lenientAgree = 0;
const BIN = [
  { lo: 0.4, hi: 0.55, k: "0.40-0.55" },
  { lo: 0.55, hi: 0.7, k: "0.55-0.70" },
  { lo: 0.7, hi: 0.85, k: "0.70-0.85" },
  { lo: 0.85, hi: 1.01, k: "0.85-1.00" },
];

function binOf(v: number): string {
  return BIN.find((b) => v >= b.lo && v < b.hi)?.k ?? (v < 0.4 ? "0.40-0.55" : "0.85-1.00");
}

function score(label: string, tally: Tally, actual: string, expected: string): boolean {
  tally.total++;
  if (actual === expected) {
    tally.hit++;
    return true;
  }
  tally.miss++;
  tally.misses.push(`${label}: got ${actual}, human said ${expected}`);
  return false;
}

console.log("══════════════════════════════════════════════════════════");
console.log("PHASE 11 — CONVERSATION UNDERSTANDING INDEX (HUMAN BENCHMARK)");
console.log("══════════════════════════════════════════════════════════");

let displayed = 0;
for (const sc of B) {
  const ctx = buildConversationContext({
    input: {
      text: sc.t,
      sttConfidence: 0.9,
      wasInterruption: false,
      audioRms: 0.02,
      languageMode: "detected",
      ...sc.c?.input,
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
      ...sc.c?.emotion,
    },
    memory: { ...sc.c?.memory },
    identity: { ...sc.c?.identity },
    timing: {
      silenceDurationMs: 0,
      turnCount: 5,
      lastResponseLatencyMs: 0,
      averageResponseLengthWords: 30,
      ...sc.c?.timing,
    },
    recentHistory: sc.c?.recentHistory,
    behaviorAnalysis: sc.c?.behaviorAnalysis ?? null,
  });

  const u = understand(ctx);
  const plan = exec.plan(ctx);
  const ladder = planner.plan(ctx, u);

  const results: string[] = [];
  let allHit = true;
  let lenientHit = true;
  const push = (label: string, ok: boolean) => {
    results.push(`${ok ? "✅" : "❌"}${label}`);
    if (!ok) allHit = false;
  };

  if (sc.m) {
    const ok = score("move", moveT, u.move, sc.m);
    push(`move:${u.move}${ok ? "" : `≠${sc.m}`}`, ok);
    if (!ok) lenientHit = false;
  }
  if (sc.g) {
    const ok = score("goal", goalT, u.speakerGoal, sc.g);
    push(`goal:${u.speakerGoal}${ok ? "" : `≠${sc.g}`}`, ok);
    if (!ok) lenientHit = false;
  }
  if (sc.e) {
    const ok = score("expected", expectT, u.expected, sc.e);
    push(`exp:${u.expected}${ok ? "" : `≠${sc.e}`}`, ok);
  }
  if (sc.s) {
    const ok = score("state", stateT, u.state, sc.s);
    push(`state:${u.state}${ok ? "" : `≠${sc.s}`}`, ok);
  }
  if (sc.i !== undefined) {
    const actual = u.implicit?.label ?? "";
    const ok = score("implicit", implicitT, actual, sc.i);
    push(`implicit:${actual}${ok ? "" : `≠${sc.i}`}`, ok);
  }
  if (sc.S) {
    const ok = sc.S.includes(ladder.primary);
    strategyT.total++;
    if (ok) strategyT.hit++;
    else {
      strategyT.miss++;
      strategyT.misses.push(`strategy: got ${ladder.primary}, human said [${sc.S.join(",")}]`);
    }
    push(`strategy:${ladder.primary}${ok ? "" : `∉[${sc.S.join(",")}]`}`, ok);
  }

  // Social signals: presence & absence expectations
  const present = new Set(u.social.map((s) => s.name));
  for (const sname of sc.soc ?? []) {
    if (sname in socialStats) {
      if (present.has(sname)) socialStats[sname].tp++;
      else {
        socialStats[sname].fn++;
        push(`soc:${sname}`, false);
        allHit = false;
      }
    } else {
      push(`soc:${sname}`, present.has(sname));
      if (!present.has(sname)) allHit = false;
    }
  }
  for (const sname of sc.socAbs ?? []) {
    if (sname in socialStats) {
      if (present.has(sname)) {
        socialStats[sname].fp++;
        push(`socAbs:${sname}`, false);
        allHit = false;
      }
    } else {
      push(`socAbs:${sname}`, !present.has(sname));
      if (present.has(sname)) allHit = false;
    }
  }

  if (allHit) strictAgree++;
  if (lenientHit) lenientAgree++;

  // Confidence calibration: decision correctness (move+goal) per bin
  const correct = lenientHit;
  const bin = binOf(u.confidence.value);
  calibBins[bin].total++;
  if (correct) calibBins[bin].correct++;

  if (!allHit) {
    console.log(`❌ [${sc.note}] "${sc.t}"`);
    console.log(`   ${results.join(" ")}`);
    console.log(`   conf=${u.confidence.value.toFixed(2)}`);
    displayed++;
  }
}

// ─── Metrics ─────────────────────────────────────────────────────────
const acc = (t: Tally) => (t.total ? Math.round((t.hit / t.total) * 100) : 0);
const f1 = (s: { tp: number; fp: number; fn: number }) => {
  const p = s.tp + s.fp > 0 ? s.tp / (s.tp + s.fp) : 1;
  const r = s.tp + s.fn > 0 ? s.tp / (s.tp + s.fn) : 1;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
};

const moveAcc = acc(moveT);
const goalAcc = acc(goalT);
const expectAcc = acc(expectT);
const stateAcc = acc(stateT);
const implicitAcc = acc(implicitT);
const strategyAcc = acc(strategyT);

const cui =
  Math.round(
    (moveAcc * 0.25 +
      goalAcc * 0.2 +
      strategyAcc * 0.2 +
      implicitAcc * 0.15 +
      expectAcc * 0.1 +
      stateAcc * 0.1) *
      10,
  ) / 10;

console.log("\n══════════════════════════════════════════════════════════");
console.log("METRICS");
console.log(`scenarios: ${B.length}  (${B.length - displayed} fully matched humans)`);
console.log("──────────────────────────────────────────────────────────");
console.log(`move accuracy:      ${moveAcc}%   (${moveT.hit}/${moveT.total})`);
console.log(`goal accuracy:      ${goalAcc}%   (${goalT.hit}/${goalT.total})`);
console.log(`expected accuracy:  ${expectAcc}%   (${expectT.hit}/${expectT.total})`);
console.log(`state accuracy:     ${stateAcc}%   (${stateT.hit}/${stateT.total})`);
console.log(`implicit accuracy:  ${implicitAcc}%   (${implicitT.hit}/${implicitT.total})`);
console.log(`strategy accuracy:  ${strategyAcc}%   (${strategyT.hit}/${strategyT.total})`);
console.log("──────────────────────────────────────────────────────────");
for (const name of ["sarcasm", "hesitation", "withdrawal"]) {
  const s = socialStats[name];
  console.log(
    `social ${name.padEnd(10)} F1=${(f1(s) * 100).toFixed(1)}%  precision=${s.tp + s.fp > 0 ? ((s.tp / (s.tp + s.fp)) * 100).toFixed(0) : "n/a"}%  recall=${s.tp + s.fn > 0 ? ((s.tp / (s.tp + s.fn)) * 100).toFixed(0) : "n/a"}%  (tp=${s.tp} fp=${s.fp} fn=${s.fn})`,
  );
}
console.log("──────────────────────────────────────────────────────────");
console.log("confidence calibration (accuracy of decision per bin):");
for (const b of BIN) {
  const c = calibBins[b.k];
  console.log(
    `  ${b.k}  ${c.total > 0 ? `${Math.round((c.correct / c.total) * 100)}% (${c.correct}/${c.total})` : "no samples"}`,
  );
}
console.log("──────────────────────────────────────────────────────────");
console.log(
  `human agreement (strict, full surface): ${Math.round((strictAgree / B.length) * 100)}%  (${strictAgree}/${B.length})`,
);
console.log(
  `human agreement (lenient, move+goal):   ${Math.round((lenientAgree / B.length) * 100)}%  (${lenientAgree}/${B.length})`,
);
console.log("──────────────────────────────────────────────────────────");
console.log(`CONVERSATION UNDERSTANDING INDEX: ${cui} / 100`);
console.log("══════════════════════════════════════════════════════════");

if (moveT.misses.length > 0) {
  console.log("\nMISS REASONS (move):");
  moveT.misses.forEach((m) => console.log(`  - ${m}`));
}
if (goalT.misses.length > 0) {
  console.log("\nMISS REASONS (goal):");
  goalT.misses.forEach((m) => console.log(`  - ${m}`));
}
if (implicitT.misses.length > 0) {
  console.log("\nMISS REASONS (implicit):");
  implicitT.misses.forEach((m) => console.log(`  - ${m}`));
}
