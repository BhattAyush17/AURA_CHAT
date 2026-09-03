/**
 * Dead-branch / reachability + latency audit for AutonomousConversationEngine.
 * Run: npx tsx scripts/audit-autonomous-reach.ts
 */
import { evaluateAutonomous } from "@/runtime/autonomousConversation";
import type { AutonomousInput } from "@/runtime/autonomousConversation";

const ACTIONS = [
  "WAIT",
  "CLARIFY",
  "ACKNOWLEDGE",
  "REFLECT",
  "OBSERVE",
  "RESPOND_ONLY",
  "FOLLOW_UP",
  "OFFER",
  "ASK",
  "EXPLORE",
  "CONTINUE",
  "RECALL",
  "PROACTIVELY_ENGAGE",
  "PROACTIVELY_RETURN",
];

function base(): AutonomousInput {
  return {
    planInitiative: "Continue",
    strategy: "Answer",
    literal: "statement",
    move: "Continue",
    speakerGoal: "inform",
    expected: "follow-up",
    shared: { openQuestion: false, repairPending: false, topicUnfinished: false, emotionUnresolved: false },
    emotion: { tension: 0.3, energy: 0.5, warmth: 0.5, engagement: 0.5, frustration: 0.1, vulnerability: 0, arc: "building" },
    memory: { hasPersonalHistory: false, retrievedCount: 0, relevanceScores: [] },
    timing: { silenceDurationMs: 0, turnCount: 10 },
    frustration: 0.1,
    initiativeMetrics: {
      consecutiveQuestions: 0,
      recentQuestionCount: 0,
      userCarryingConversation: false,
      questionFatigue: 0,
      lastUserRespondedToQuestion: true,
    },
    social: {
      should_question: false,
      should_continue_listening: false,
      question_value: 0.5,
      conversational_momentum: {
        user_elaborating: false,
        unfinished_thought: false,
        user_wants_space: false,
        topic_depth: 0,
        exploratory: false,
        storytelling: false,
        argumentative: false,
      },
    },
    questionFatigue: 0,
    planMemoryPolicy: "Optional",
    hasMusicContext: false,
    atmospherePresent: false,
  };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function r(): number {
  return Math.round(Math.random() * 100) / 100;
}

const seen = new Set<string>();

// Deterministic scenario probes from the 18-test suite (targets specific actions).
const scenarioInputs: Array<Partial<AutonomousInput>> = [
  { literal: "question", expected: "information", speakerGoal: "seek-information", move: "Answer" }, // RESPOND_ONLY
  { vulnerability: 0.75, literal: "statement", speakerGoal: "seek-comfort", strategy: "Comfort", emotion: { ...base().emotion, vulnerability: 0.75, arc: "peak" } }, // ACKNOWLEDGE
  { literal: "opinion", speakerGoal: "share-excitement", move: "Continue", shared: { ...base().shared, topicUnfinished: true }, emotion: { ...base().emotion, engagement: 0.85 }, social: { ...base().social, conversational_momentum: { ...base().social.conversational_momentum, exploratory: true, topic_depth: 2 } } }, // CONTINUE
  { shared: { ...base().shared, repairPending: true }, literal: "repair", expected: "clarification" }, // CLARIFY
  { literal: "goodbye", speakerGoal: "close", move: "Close" }, // WAIT
  { strategy: "Reflect", memory: { hasPersonalHistory: true, retrievedCount: 3, relevanceScores: [0.9] }, planMemoryPolicy: "Required", literal: "opinion", speakerGoal: "share-excitement", emotion: { ...base().emotion, engagement: 0.8 } }, // RECALL
  { strategy: "Reflect", literal: "opinion", speakerGoal: "share-excitement", move: "Continue", memory: { hasPersonalHistory: true, retrievedCount: 3, relevanceScores: [0.9] }, planMemoryPolicy: "Required", shared: { ...base().shared, topicUnfinished: true }, emotion: { ...base().emotion, engagement: 0.8 } }, // PROACTIVELY_RETURN
  { strategy: "Reflect", literal: "opinion", speakerGoal: "share-excitement", emotion: { ...base().emotion, engagement: 0.9, energy: 0.9 }, questionFatigue: 0, social: { ...base().social, conversational_momentum: { ...base().social.conversational_momentum, exploratory: true } } },
];

for (const s of scenarioInputs) {
  const e = evaluateAutonomous(Object.assign(base(), s));
  seen.add(e.action);
}

// Randomized stress probe for broader reachability.
for (let n = 0; n < 50000; n++) {
  const i = base();
  i.literal = pick(["statement", "question", "answer", "request", "opinion", "repair", "goodbye", "command"]);
  i.move = pick(["Continue", "Answer", "ChangeTopic", "Close", "Ask"]);
  i.speakerGoal = pick(["inform", "seek-information", "seek-comfort", "share-excitement", "vent", "close", "persuade"]);
  i.expected = pick(["follow-up", "information", "clarification", "validation", "acknowledgement", "advice"]);
  i.strategy = pick(["Answer", "Ask", "Clarify", "Comfort", "Encourage", "Challenge", "Observe", "Reflect", "Redirect", "Summarize", "Listen"]);
  i.planInitiative = pick(["Continue", "Proactive", "Respond-only", "Wait"]);
  i.userInterrupted = Math.random() < 0.15;
  i.auraJustSpoke = Math.random() < 0.2;
  i.lastUserGaveShortAnswer = Math.random() < 0.3;
  i.memoryInterestingButNotRelevant = Math.random() < 0.3;
  i.frustration = r();
  i.questionFatigue = r();
  i.emotion.tension = r();
  i.emotion.energy = r();
  i.emotion.warmth = r();
  i.emotion.engagement = r();
  i.emotion.frustration = r();
  i.emotion.vulnerability = r();
  i.emotion.arc = pick(["building", "peak", "declining", "flat"]);
  i.memory.hasPersonalHistory = Math.random() < 0.5;
  i.memory.retrievedCount = Math.floor(r() * 5);
  i.memory.relevanceScores = Array.from({ length: i.memory.retrievedCount }, () => r());
  i.timing.silenceDurationMs = r() * 20000;
  i.timing.turnCount = Math.floor(r() * 40);
  i.shared.openQuestion = Math.random() < 0.3;
  i.shared.repairPending = Math.random() < 0.2;
  i.shared.topicUnfinished = Math.random() < 0.3;
  i.shared.emotionUnresolved = Math.random() < 0.2;
  i.social.should_question = Math.random() < 0.4;
  i.social.should_continue_listening = Math.random() < 0.3;
  i.social.question_value = r();
  const cm = i.social.conversational_momentum;
  cm.user_elaborating = Math.random() < 0.3;
  cm.unfinished_thought = Math.random() < 0.3;
  cm.user_wants_space = Math.random() < 0.2;
  cm.topic_depth = Math.floor(r() * 3);
  cm.exploratory = Math.random() < 0.3;
  cm.storytelling = Math.random() < 0.2;
  cm.argumentative = Math.random() < 0.2;
  i.hasMusicContext = Math.random() < 0.3;
  i.atmospherePresent = Math.random() < 0.5;
  i.planMemoryPolicy = pick(["Required", "Optional", "DoNotRecall"]);

  const d = evaluateAutonomous(i);
  seen.add(d.action);
}

// Latency.
const t0 = performance.now();
const N = 200000;
for (let n = 0; n < N; n++) evaluateAutonomous(base());
const dt = performance.now() - t0;
console.log(`elapsed ${dt.toFixed(1)}ms for ${N} evals → ${(dt / N).toFixed(4)}ms/eval`);

const reached = [...seen].sort();
console.log(`distinct actions reached (${reached.length}): ${reached.join(", ")}`);

const expected = new Set(["WAIT", "CLARIFY", "ACKNOWLEDGE", "REFLECT", "OBSERVE", "RESPOND_ONLY", "FOLLOW_UP", "OFFER", "ASK", "EXPLORE", "CONTINUE", "RECALL", "PROACTIVELY_ENGAGE", "PROACTIVELY_RETURN"]);
const missing = [...expected].filter((a) => !seen.has(a));
if (missing.length) {
  console.log("NOT REACHED:", missing.join(", "));
  process.exit(1);
} else {
  console.log("All documented actions reachable. ✓");
}
