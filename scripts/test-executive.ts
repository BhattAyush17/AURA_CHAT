/**
 * Smoke test for the Phase 7.0 Conversation Executive.
 * Run: npx tsx scripts/test-executive.ts  (or bun run)
 */
import { ConversationExecutive } from "../src/executive/ConversationExecutive";
import { buildConversationContext } from "../src/executive/ConversationContext";

const exec = new ConversationExecutive();

function scenario(name: string, partial: Parameters<typeof buildConversationContext>[0]) {
  const ctx = buildConversationContext(partial);
  const plan = exec.plan(ctx);
  console.log(`\n── ${name} ── (${plan.executiveTimeMs.toFixed(1)}ms)`);
  console.log(
    `strategy: ${plan.strategy.primary}${plan.strategy.secondary ? ` → ${plan.strategy.secondary}` : ""}`,
  );
  console.log(`confidence: ${plan.confidence.label} (${plan.confidence.value})`);
  console.log(
    `clarification: ${plan.clarification.required ? "YES" : "no"}${plan.clarification.required ? " — " + plan.clarification.triggeredBy.join("; ") : ""}`,
  );
  console.log(
    `memory: ${plan.memoryPolicy} | budget: ${plan.informationBudget} | initiative: ${plan.initiative}`,
  );
  console.log(
    `speech: speed=${plan.speechBehavior.speechSpeed} energy=${plan.speechBehavior.energy} warmth=${plan.speechBehavior.warmth} pause=${plan.speechBehavior.pauseBeforeMs}ms`,
  );
  console.log(
    `thinking: ${plan.thinkingBehavior.kind}${plan.thinkingBehavior.utterance ? ` ("${plan.thinkingBehavior.utterance}")` : ""}`,
  );
  console.log(`rationale: ${plan.rationale.join(" | ")}`);
  return plan;
}

// 1. Clear, high-confidence factual question
scenario("Clear factual question", {
  input: {
    text: "What is the capital of France?",
    sttConfidence: 0.95,
    wasInterruption: false,
    audioRms: 0.02,
    languageMode: "english",
  },
  emotion: { dominant: "neutral", energy: 0.5, engagement: 0.5 },
  timing: { turnCount: 3, silenceDurationMs: 200 },
});

// 2. Low STT confidence — must clarify
scenario("STT at 42%", {
  input: {
    text: "pls book a flight to delhi",
    sttConfidence: 0.42,
    wasInterruption: false,
    audioRms: 0.01,
    languageMode: "english",
  },
  emotion: { dominant: "neutral", energy: 0.5, engagement: 0.5 },
  timing: { turnCount: 5, silenceDurationMs: 100 },
});

// 3. "I'm fine." — deflection with low acoustics
scenario("'I'm fine.' (deflection)", {
  input: {
    text: "I'm fine.",
    sttConfidence: 0.92,
    wasInterruption: false,
    audioRms: 0.01,
    languageMode: "english",
  },
  emotion: {
    dominant: "withdrawn",
    vulnerability: 0.65,
    energy: 0.25,
    warmth: 0.3,
    engagement: 0.3,
    tension: 0.4,
    arc: "withdrawing",
  },
  timing: { turnCount: 8, silenceDurationMs: 1500 },
});

// 4. Frustrated user with short text
scenario("Frustrated, short input", {
  input: {
    text: "it's not working",
    sttConfidence: 0.88,
    wasInterruption: false,
    audioRms: 0.15,
    languageMode: "english",
  },
  emotion: { dominant: "frustrated", frustration: 0.8, energy: 0.7, tension: 0.6 },
  timing: { turnCount: 12, silenceDurationMs: 100 },
});

// 5. Emotional peak — encourage
scenario("Emotional peak, high energy", {
  input: {
    text: "I finally finished the project! After three months of work!",
    sttConfidence: 0.93,
    wasInterruption: false,
    audioRms: 0.1,
    languageMode: "english",
  },
  emotion: {
    dominant: "excited",
    energy: 0.85,
    engagement: 0.8,
    tension: 0.2,
    arc: "peak",
    vulnerability: 0.2,
  },
  timing: { turnCount: 6, silenceDurationMs: 100 },
});

// 6. Long thread — summarize/redirect
scenario("Very long thread (25 turns)", {
  input: {
    text: "yeah exactly",
    sttConfidence: 0.9,
    wasInterruption: false,
    audioRms: 0.03,
    languageMode: "hinglish",
  },
  emotion: { dominant: "neutral", energy: 0.5, engagement: 0.6 },
  timing: { turnCount: 25, silenceDurationMs: 300 },
});

// 7. Conflicting memories
scenario("Conflicting memories", {
  input: {
    text: "What do you think about the job?",
    sttConfidence: 0.91,
    wasInterruption: false,
    audioRms: 0.03,
    languageMode: "english",
  },
  emotion: { dominant: "neutral", energy: 0.5, engagement: 0.6 },
  memory: {
    retrieved: ["user wanted to quit job", "user got promoted and loves job"],
    relevanceScores: [0.72, 0.68],
    hasPersonalHistory: true,
    sessionTurn: 40,
  },
  timing: { turnCount: 40, silenceDurationMs: 200 },
});

// 8. Farewell
scenario("Goodbye", {
  input: {
    text: "bye good night",
    sttConfidence: 0.94,
    wasInterruption: false,
    audioRms: 0.02,
    languageMode: "english",
  },
  emotion: { dominant: "calm", energy: 0.4, engagement: 0.4 },
  timing: { turnCount: 15, silenceDurationMs: 200 },
});

// 9. Long silence after established conversation
scenario("Long silence", {
  input: {
    text: "so...",
    sttConfidence: 0.85,
    wasInterruption: false,
    audioRms: 0.01,
    languageMode: "english",
  },
  emotion: { dominant: "neutral", energy: 0.4, engagement: 0.5 },
  timing: { turnCount: 10, silenceDurationMs: 9500 },
});

// 10. Reflection: force a bad turn then reflect
const badPlan = scenario("Reflection source (forced negative)", {
  input: {
    text: "What is the capital of France?",
    sttConfidence: 0.95,
    wasInterruption: false,
    audioRms: 0.02,
    languageMode: "english",
  },
  emotion: { dominant: "neutral", energy: 0.5, engagement: 0.5 },
  timing: { turnCount: 3, silenceDurationMs: 200 },
});
const reflection = exec.reflect(badPlan, { userReactedNegatively: true, userFollowedUp: false });
console.log(`\n── Reflection ──`);
console.log(`signals: ${reflection.signals.join(", ")}`);
console.log(
  `weights: clarifyBias=${exec.reflection.weights.clarifyBias} brevityBias=${exec.reflection.weights.brevityBias} warmthBias=${exec.reflection.weights.warmthBias}`,
);

// 11. Low confidence + reflection clarifyBias high → force clarification
const lowConfPlan = scenario("Low confidence after reflection bias", {
  input: {
    text: "what do you mean",
    sttConfidence: 0.52,
    wasInterruption: false,
    audioRms: 0.02,
    languageMode: "english",
  },
  emotion: { dominant: "confused", energy: 0.4, engagement: 0.5 },
  timing: { turnCount: 4, silenceDurationMs: 100 },
});
console.log(`\nReflection stats:`, JSON.stringify(exec.reflection.stats()));

// 12. Plan → Prompt translation (Development Rule 6) — must be machine-checkable
const planPrompt = exec.translatePlanToPrompt(badPlan);
console.log(`\n── translatePlanToPrompt ──`);
console.log(planPrompt);
const assert = (cond: boolean, label: string) => {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  if (!cond) process.exitCode = 1;
};
assert(planPrompt.includes("[EXECUTIVE PLAN]"), "prompt opens with plan tag");
assert(planPrompt.includes(`strategy: ${badPlan.strategy.primary}`), "strategy present");
assert(planPrompt.includes(`depth: ${badPlan.informationBudget}`), "budget present");
assert(planPrompt.includes("[/EXECUTIVE PLAN]"), "prompt closes with plan tag");
assert(!planPrompt.includes("\n\n\n"), "no empty runs");

// 13. brevityBias must adjust the budget ladder (learning, not heuristics)
// A Detailed budget + negative reaction → reflection trims depth on the next plan.
const baseCtx = buildConversationContext({
  input: {
    text: "How does DNS resolution work in detail?",
    sttConfidence: 0.95,
    wasInterruption: false,
    audioRms: 0.02,
    languageMode: "english",
  },
  emotion: { dominant: "neutral", energy: 0.5, engagement: 0.6 },
  timing: { turnCount: 3, silenceDurationMs: 200, averageResponseLengthWords: 60 },
});
const before = exec.plan(baseCtx);
for (let i = 0; i < 3; i++) {
  exec.reflect(before, { userReactedNegatively: true, userFollowedUp: false });
}
const after = exec.plan(baseCtx);
assert(after.informationBudget !== before.informationBudget, "verbosity feedback trims budget");
console.log(
  `brevityBias=${exec.reflection.weights.brevityBias.toFixed(2)} → budget ${before.informationBudget} → ${after.informationBudget}`,
);

// 14. Phase 7.2: Listening Intelligence snapshot must reach the Executive
// (noise floor calibrated, sustained dominant speech, real silence drained)
const listeningCtx = buildConversationContext({
  input: {
    text: "it's been a really long day",
    sttConfidence: 0.91,
    wasInterruption: false,
    audioRms: 0.03,
    languageMode: "english",
    listening: {
      speechProbability: 0.96,
      noiseLevel: -46.5,
      speechDetected: true,
      realSilence: 0,
      vadConfidence: 0.92,
      detectionSource: "silero",
      dominantSpeechDetected: true,
    },
  },
  emotion: { dominant: "withdrawn", vulnerability: 0.55, energy: 0.35, engagement: 0.4 },
  timing: { turnCount: 14, silenceDurationMs: 700 },
});
const listeningPlan = scenario("Listening Intelligence snapshot (silero, dominant)", {
  ...listeningCtx,
  input: { ...listeningCtx.input },
});
assert(
  listeningCtx.input.listening.detectionSource === "silero" &&
    listeningCtx.input.listening.speechDetected === true &&
    listeningCtx.input.listening.dominantSpeechDetected === true,
  "listening snapshot embedded in conversation context",
);
assert(
  typeof listeningPlan.strategy.primary === "string" && listeningPlan.confidence.value >= 0,
  "executive plans with listening input",
);
