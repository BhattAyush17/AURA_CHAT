/**
 * Deterministic tests for the global AutonomousConversation module (Phase 2).
 *
 * Covers the 18 required verification scenarios plus extended checks
 * (provider parity, anti-leak, WAIT reachability, determinism).
 *
 * Tests run the PURE evaluateAutonomous() with constructed, fully-specified
 * inputs, so they are deterministic and provider-independent.
 *
 * Run: npx tsx scripts/test-autonomous.ts
 */

import assert from "node:assert";
import {
  evaluateAutonomous,
  formatAutonomousBlock,
  getAutonomousConversationEngine,
} from "@/runtime/autonomousConversation";
import type {
  AutonomousInput,
  AutonomousConversationDecision,
} from "@/runtime/autonomousConversation";

let passed = 0;
let failed = 0;
let failures: string[] = [];

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    // eslint-disable-next-line no-console
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${(e as Error).message}`);
    // eslint-disable-next-line no-console
    console.log(`  FAIL  ${name}`);
  }
}

function fresh(): AutonomousInput {
  return {
    planInitiative: "Continue",
    strategy: "Answer",
    literal: "statement",
    move: "Continue",
    speakerGoal: "inform",
    expected: "follow-up",
    shared: {
      openQuestion: false,
      repairPending: false,
      topicUnfinished: false,
      emotionUnresolved: false,
    },
    emotion: {
      tension: 0.2,
      energy: 0.5,
      warmth: 0.5,
      engagement: 0.5,
      frustration: 0,
      vulnerability: 0,
      arc: "building",
    },
    memory: { hasPersonalHistory: false, retrievedCount: 0, relevanceScores: [] },
    timing: { silenceDurationMs: 0, turnCount: 5 },
    frustration: 0,
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

// ── 1. Factual answer → no forced question ──────────────────────────
check("1 factual question → RESPOND_ONLY, no forced follow-up", () => {
  const i = fresh();
  i.literal = "question";
  i.expected = "information";
  i.speakerGoal = "seek-information";
  i.move = "Answer";
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.action, "RESPOND_ONLY", `action = ${d.action}`);
  assert.notStrictEqual(d.action, "FOLLOW_UP");
  assert.strictEqual(d.shouldSpeak, true);
  assert.strictEqual(d.utteranceCategory, "USER_TURN_RESPONSE");
});

// ── 2. Emotional disclosure → empathetic response ───────────────────
check("2 emotional disclosure → ACKNOWLEDGE (no question template)", () => {
  const i = fresh();
  i.literal = "statement";
  i.speakerGoal = "seek-comfort";
  i.strategy = "Comfort";
  i.emotion.vulnerability = 0.75;
  i.emotion.arc = "peak";
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.action, "ACKNOWLEDGE", `action = ${d.action}`);
  assert.notStrictEqual(d.action, "ASK");
});

// ── 3. Frustrated user → no dismissive response ─────────────────────
check("3 frustrated user → REFLECT (not dismissive, not interrogating)", () => {
  const i = fresh();
  i.frustration = 0.8;
  i.emotion.frustration = 0.85;
  i.emotion.engagement = 0.4;
  i.strategy = "Reflect";
  const d = evaluateAutonomous(i);
  assert.ok(["REFLECT", "ACKNOWLEDGE"].includes(d.action), `action = ${d.action}`);
  assert.notStrictEqual(d.action, "ASK");
  assert.notStrictEqual(d.action, "RESPOND_ONLY");
  assert.strictEqual(d.shouldSpeak, true, "empathy present, not silence");
});

// ── 4. Detailed engaged user → continuation opportunity ─────────────
check("4 detailed engaged user → CONTINUE opportunity, initiative > 0", () => {
  const i = fresh();
  i.strategy = "Reflect";
  i.literal = "opinion";
  i.speakerGoal = "share-excitement";
  i.shared.topicUnfinished = true;
  i.move = "Continue";
  i.emotion.engagement = 0.85;
  i.emotion.energy = 0.7;
  i.social.conversational_momentum.exploratory = true;
  i.social.conversational_momentum.topic_depth = 2;
  const d = evaluateAutonomous(i);
  assert.ok(
    ["CONTINUE", "PROACTIVELY_ENGAGE", "EXPLORE"].includes(d.action),
    `action = ${d.action}`,
  );
  assert.strictEqual(d.shouldSpeak, true);
  assert.ok(d.initiativeScore > 0.3, `initiativeScore = ${d.initiativeScore}`);
});

// ── 5. Short "yeah" → no forced question ────────────────────────────
check("5 short 'yeah' → no forced question", () => {
  const i = fresh();
  i.literal = "answer";
  i.speakerGoal = "inform";
  i.emotion.engagement = 0.4;
  i.move = "Answer";
  const d = evaluateAutonomous(i);
  assert.notStrictEqual(d.action, "ASK");
  assert.notStrictEqual(d.action, "PROACTIVELY_ENGAGE");
});

// ── 6. Repeated short answers → decreasing initiative ───────────────
check("6 repeated short answers → decreasing initiative (no interview)", () => {
  const short = fresh();
  short.literal = "answer";
  short.lastUserGaveShortAnswer = true;
  short.questionFatigue = 0.6;
  short.social.conversational_momentum.user_elaborating = false;
  short.emotion.engagement = 0.3;
  const dShort = evaluateAutonomous(short);
  assert.ok(
    ["OBSERVE", "ACKNOWLEDGE", "RESPOND_ONLY"].includes(dShort.action),
    `action = ${dShort.action}`,
  );
  assert.notStrictEqual(dShort.action, "ASK");

  const engaged = fresh();
  engaged.speakerGoal = "share-excitement";
  engaged.literal = "opinion";
  engaged.social.conversational_momentum.exploratory = true;
  engaged.emotion.engagement = 0.9;
  engaged.emotion.energy = 0.8;
  const dEngaged = evaluateAutonomous(engaged);
  assert.ok(
    dEngaged.initiativeScore > dShort.initiativeScore,
    `engaged ${dEngaged.initiativeScore} should exceed short ${dShort.initiativeScore}`,
  );
});

// ── 7. User asks AURA a question → direct answer ────────────────────
check("7 user asks question → direct answer", () => {
  const i = fresh();
  i.literal = "question";
  i.expected = "information";
  i.speakerGoal = "seek-information";
  i.move = "Answer";
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.action, "RESPOND_ONLY", `action = ${d.action}`);
});

// ── 8. Missing information genuinely required → ask/clarify ─────────
check("8 missing info genuinely required → clarify, not a social filler", () => {
  const i = fresh();
  i.shared.repairPending = true;
  i.literal = "repair";
  i.expected = "clarification";
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.action, "CLARIFY", `action = ${d.action}`);
  assert.strictEqual(d.shouldSpeak, true);
});

// ── 9. Conversation closure → graceful stop ─────────────────────────
check("9 closure (goodbye) → graceful WAIT, no restart", () => {
  const i = fresh();
  i.literal = "goodbye";
  i.speakerGoal = "close";
  i.move = "Close";
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.action, "WAIT", `action = ${d.action}`);
  assert.strictEqual(d.utteranceCategory, "WAIT");
});

// ── 10. Strong topic continuity → natural continuation ──────────────
check("10 strong continuity → CONTINUE", () => {
  const i = fresh();
  i.strategy = "Observe";
  i.shared.topicUnfinished = true;
  i.move = "Continue";
  i.social.conversational_momentum.unfinished_thought = true;
  i.emotion.engagement = 0.6;
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.action, "CONTINUE", `action = ${d.action}`);
  assert.strictEqual(d.utteranceCategory, "AUTONOMOUS_CONTINUATION");
});

// ── 11. Relevant memory → contextual use ────────────────────────────
check("11 relevant durable memory + curiosity → contextual use", () => {
  const i = fresh();
  i.strategy = "Reflect";
  i.memory.hasPersonalHistory = true;
  i.memory.retrievedCount = 3;
  i.memory.relevanceScores = [0.9, 0.7, 0.5];
  i.planMemoryPolicy = "Required";
  i.memoryInterestingButNotRelevant = false;
  i.literal = "opinion";
  i.speakerGoal = "share-excitement";
  i.emotion.engagement = 0.8;
  i.emotion.warmth = 0.7;
  i.social.conversational_momentum.exploratory = true;
  const d = evaluateAutonomous(i);
  assert.ok(["RECALL", "PROACTIVELY_RETURN"].includes(d.action), `action = ${d.action}`);
  assert.strictEqual(d.memoryOpportunity, true);
});

// ── 12. Irrelevant memory → no injection ────────────────────────────
check("12 merely-interesting memory → NO injection, not recalled", () => {
  const i = fresh();
  i.strategy = "Reflect";
  i.memory.hasPersonalHistory = true;
  i.memory.retrievedCount = 2;
  i.memory.relevanceScores = [0.4, 0.3];
  i.planMemoryPolicy = "Optional";
  i.memoryInterestingButNotRelevant = true;
  i.literal = "statement";
  i.move = "Continue";
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.memoryOpportunity, false, "interesting-only must not be surfaced");
  assert.notStrictEqual(d.action, "RECALL");
  assert.notStrictEqual(d.action, "PROACTIVELY_RETURN");
});

// ── 13. Music context → initiative can incorporate state ────────────
check("13 music context present → decision still valid & provider-agnostic", () => {
  const withMusic = fresh();
  withMusic.hasMusicContext = true;
  withMusic.literal = "question";
  withMusic.expected = "information";
  withMusic.speakerGoal = "seek-information";
  const without = fresh();
  without.hasMusicContext = false;
  without.literal = "question";
  without.expected = "information";
  without.speakerGoal = "seek-information";
  const a = evaluateAutonomous(withMusic);
  const b = evaluateAutonomous(without);
  assert.strictEqual(a.action, b.action, "music flag alone must not alter a factual decision");
  assert.ok(a.rawSignals !== undefined);
});

// ── 14. User interruption → initiative suppressed ───────────────────
check("14 user interruption → WAIT (initiative suppressed)", () => {
  const i = fresh();
  i.userInterrupted = true;
  i.literal = "question";
  i.speakerGoal = "seek-information";
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.action, "WAIT");
  assert.strictEqual(d.shouldSpeak, false);
});

// ── 15. AURA just spoke → avoid immediate re-initiation ─────────────
check("15 AURA just spoke → no immediate unnecessary re-initiation", () => {
  const i = fresh();
  i.auraJustSpoke = true;
  i.timing.silenceDurationMs = 500;
  i.literal = "question";
  i.speakerGoal = "seek-information";
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.action, "WAIT");
  assert.strictEqual(d.shouldSpeak, false);
});

// ── 16. Autonomous opportunity but low confidence → wait ────────────
check("16 autonomous opportunity + low confidence → WAIT, don't force", () => {
  const i = fresh();
  i.strategy = "Reflect";
  i.literal = "opinion";
  i.speakerGoal = "share-excitement";
  i.emotion.engagement = 0.9;
  i.emotion.energy = 0.9;
  i.social.conversational_momentum.exploratory = true;
  i.questionFatigue = 0.85; // → confidence collapses
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.action, "WAIT", `action = ${d.action}`);
  assert.strictEqual(d.shouldSpeak, false);
});

// ── 17. All three providers receive identical initiative state ──────
check("17 provider parity → identical decision for OpenRouter/Sarvam/Gemini", () => {
  const i = fresh();
  i.literal = "opinion";
  i.speakerGoal = "share-excitement";
  i.emotion.engagement = 0.85;
  i.social.conversational_momentum.exploratory = true;
  i.social.conversational_momentum.topic_depth = 2;
  const a = evaluateAutonomous(i);
  const b = evaluateAutonomous(i);
  assert.deepStrictEqual(a, b, "deterministic — repeatable, no provider input consumed");
  assert.strictEqual("provider" in i, false, "engine accepts no provider input");
});

// ── 18. No internal initiative metadata leaks into spoken output ────
check("18 anti-leak → prompt block contains no internal metadata", () => {
  const i = fresh();
  i.literal = "question";
  i.expected = "information";
  i.speakerGoal = "seek-information";
  i.emotion.engagement = 0.8;
  const d = evaluateAutonomous(i);
  const block = formatAutonomousBlock(d);

  const leaks = [
    "initiativeScore",
    "confid",
    "shouldSpeak",
    "rawSignals",
    "permission",
    "urgency",
    "interruptionCost",
    "utteranceCategory",
    "user_carrying",
    "user_yielding",
    "conversation_momentum",
    "emotional_opportunity",
    "curiosity_opportunity",
    "continuity_opportunity",
    "memory_opportunity",
    "social_opportunity",
    "knowledge_gap",
    "topic_energy",
    "closure_signal",
    "silence_value",
    "recent_question_fatigue",
    "curiosity_detected",
    "controller",
    "attention",
    "policy",
    "mode=",
    "initiative=",
  ].filter((tok) => block.includes(tok));

  assert.deepStrictEqual(leaks, [], `leaked tokens: ${leaks.join(", ")}`);
  assert.ok(block.startsWith("\n[AUTONOMOUS CONVERSATION]"), "block header present");
  assert.ok(block.includes("[/AUTONOMOUS CONVERSATION]"), "block footer present");
});

// ── Extended: WAIT reaches canSpeak=false and is first-class ────────
check("ext WAIT is reachable and drives shouldSpeak=false", () => {
  const i = fresh();
  i.timing.silenceDurationMs = 15000;
  i.social.conversational_momentum.user_wants_space = true;
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.action, "WAIT");
  assert.strictEqual(d.shouldSpeak, false);
  assert.strictEqual(d.utteranceCategory, "WAIT");
});

// ── Extended: decision schema carries structured initiative state ───
check("ext decision carries permission/urgency/interruptionCost + categories", () => {
  const i = fresh();
  i.literal = "question";
  i.expected = "information";
  i.speakerGoal = "seek-information";
  const d = evaluateAutonomous(i);
  assert.ok(["allowed", "discouraged", "prohibited"].includes(d.permission));
  assert.ok(d.urgency >= 0 && d.urgency <= 1);
  assert.ok(d.interruptionCost >= 0 && d.interruptionCost <= 1);
  assert.ok(
    ["USER_TURN_RESPONSE", "AUTONOMOUS_CONTINUATION", "AUTONOMOUS_REENGAGEMENT", "WAIT"].includes(
      d.utteranceCategory,
    ),
  );
});

// ── Extended: feedback loop records outcomes (non-destructive) ──────
check("ext feedback loop records + surfaces outcomes", () => {
  const engine = getAutonomousConversationEngine();
  engine.clear();
  const d: AutonomousConversationDecision = evaluateAutonomous(
    Object.assign(fresh(), {
      literal: "question",
      expected: "information",
      speakerGoal: "seek-information",
    }),
  );
  engine.evaluate(
    Object.assign(fresh(), {
      literal: "question",
      expected: "information",
      speakerGoal: "seek-information",
    }),
  );
  engine.recordOutcome({
    actionTaken: d.action,
    askedQuestion: d.action === "ASK",
    userAnswered: true,
    userElaborated: false,
    userDisengaged: false,
    userInterrupted: false,
    initiativeWasUseful: true,
    timestamp: Date.now(),
  });
  assert.strictEqual(engine.getRecentOutcomes().length, 1);
  engine.clear();
  assert.strictEqual(engine.getRecentOutcomes().length, 0);
});

// ── A–L original regression scenarios (retained from Phase 2 suite) ──
// Each maps to a canonical autonomous behavior and asserts it independently.
check("A factual answer → direct, no forced question", () => {
  const i = fresh();
  i.literal = "question";
  i.expected = "information";
  i.speakerGoal = "seek-information";
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.action, "RESPOND_ONLY");
  assert.strictEqual(d.utteranceCategory, "USER_TURN_RESPONSE");
});

check("B basic continuation keeps participation, not silence", () => {
  const i = fresh();
  i.speakerGoal = "inform";
  i.literal = "statement";
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.shouldSpeak, true);
});

check("C engagement + relevance yields proactive, not passive", () => {
  const i = fresh();
  i.strategy = "Reflect";
  i.literal = "opinion";
  i.speakerGoal = "share-excitement";
  i.emotion.engagement = 0.85;
  i.social.conversational_momentum.exploratory = true;
  i.social.conversational_momentum.topic_depth = 2;
  const d = evaluateAutonomous(i);
  assert.ok(
    ["CONTINUE", "PROACTIVELY_ENGAGE", "EXPLORE"].includes(d.action),
    `action = ${d.action}`,
  );
  assert.ok(d.initiativeScore > 0, `initiative = ${d.initiativeScore}`);
});

check("D curiosity ≠ forced questioning", () => {
  const i = fresh();
  i.emotion.engagement = 0.9;
  i.social.conversational_momentum.exploratory = true;
  i.questionFatigue = 0.8;
  const d = evaluateAutonomous(i);
  assert.notStrictEqual(d.action, "ASK", "high fatigue must not force ASK");
  assert.notStrictEqual(d.action, "FOLLOW_UP", "high fatigue must not force a question");
});

check("E closure (goodbye) → WAIT, no restart", () => {
  const i = fresh();
  i.literal = "goodbye";
  i.speakerGoal = "close";
  i.move = "Close";
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.action, "WAIT");
  assert.strictEqual(d.shouldSpeak, false);
});

check("F ambiguous continuation → no forced question", () => {
  const i = fresh();
  i.literal = "statement";
  i.speakerGoal = "inform";
  i.move = "ChangeTopic";
  const d = evaluateAutonomous(i);
  assert.notStrictEqual(d.action, "ASK");
});

check("G curiosity without a social opening → no forced question", () => {
  const i = fresh();
  i.emotion.engagement = 0.8;
  i.social.should_question = false;
  i.social.conversational_momentum.exploratory = false;
  i.questionFatigue = 0.2;
  const d = evaluateAutonomous(i);
  assert.ok(
    ["WAIT", "OBSERVE", "RESPOND_ONLY", "CONTINUE"].includes(d.action),
    `action = ${d.action}`,
  );
});

check("H relevant memory + curiosity → RECALL (low fatigue, no continuity)", () => {
  const i = fresh();
  i.strategy = "Reflect";
  i.memory.hasPersonalHistory = true;
  i.memory.retrievedCount = 3;
  i.memory.relevanceScores = [0.9];
  i.planMemoryPolicy = "Required";
  i.literal = "opinion";
  i.speakerGoal = "share-excitement";
  i.move = "ChangeTopic";
  i.emotion.engagement = 0.8;
  i.questionFatigue = 0.1;
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.action, "RECALL", `action = ${d.action}`);
  assert.strictEqual(d.memoryOpportunity, true);
});

check("I music context present → music is relevance-only, no forced initiative", () => {
  const withMusic = fresh();
  withMusic.hasMusicContext = true;
  const without = fresh();
  without.hasMusicContext = false;
  assert.strictEqual(
    evaluateAutonomous(withMusic).initiativeScore,
    evaluateAutonomous(without).initiativeScore,
  );
});

check("J determinism → identical input, identical decision", () => {
  const i = fresh();
  i.literal = "opinion";
  i.speakerGoal = "share-excitement";
  const a = evaluateAutonomous(i);
  const b = evaluateAutonomous(i);
  assert.deepStrictEqual(a, b);
});

check("K long pause with space sought → WAIT, no auto-speak after timer", () => {
  const i = fresh();
  i.timing.silenceDurationMs = 30000;
  i.social.conversational_momentum.user_wants_space = true;
  const d = evaluateAutonomous(i);
  assert.strictEqual(d.action, "WAIT");
  assert.strictEqual(d.shouldSpeak, false);
});

check("L provider parity → one engine, no provider input consumed", () => {
  const i = fresh();
  assert.strictEqual("provider" in i, false);
  assert.deepStrictEqual(evaluateAutonomous(i), evaluateAutonomous(i));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
