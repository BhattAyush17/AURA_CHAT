const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
function load(path, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => {
        if (!(name in deps)) throw new Error(`Missing mock ${name}`);
        return deps[name];
      },
      console,
      structuredClone,
      ...globals,
    },
  );
  return exports;
}
const { IntentionStore } = load("src/runtime/autonomousConversation/IntentionStore.ts");
const store = new IntentionStore(2);
const candidate = (id, more = {}) => ({
  id,
  dedupeKey: id,
  source: "proactive",
  description: "offer help",
  revision: 1,
  evidenceIds: ["turn-1"],
  createdAt: 0,
  expiresAt: 100,
  earliestAttemptAt: 0,
  priority: 0.5,
  ...more,
});
assert.equal(store.enqueue(candidate("a"), 0), true);
assert.equal(store.enqueue(candidate("a"), 0), false);
assert.equal(store.reserve(1, 1).id, "a");
assert.equal(store.reserve(1, 1), undefined, "atomic claim");
store.defer("a", 20, "busy");
assert.equal(store.reserve(1, 19), undefined);
assert.equal(store.reserve(1, 20).id, "a");
store.finish("a", "delivered", "completed");
assert.equal(store.enqueue(candidate("a"), 25), false, "delivered intentions dedupe");
store.enqueue(candidate("b"), 25);
store.reserve(2, 26);
assert.equal(
  store.snapshot().find((e) => e.id === "b").status,
  "cancelled",
  "new revision supersedes",
);
store.enqueue(candidate("c"), 30);
store.expire(101);
assert.equal(store.snapshot().find((e) => e.id === "c").status, "expired");
assert.ok(store.snapshot().length <= 2);

const autonomous = load("src/runtime/autonomousConversation/AutonomousConversationEngine.ts");
const input = {
  planInitiative: "Continue",
  strategy: "Explore",
  literal: "opinion",
  move: "Explore",
  speakerGoal: "share-excitement",
  expected: "follow-up",
  shared: {
    openQuestion: false,
    repairPending: false,
    topicUnfinished: false,
    emotionUnresolved: false,
  },
  emotion: {
    tension: 0,
    energy: 0.9,
    warmth: 0.5,
    engagement: 0.9,
    frustration: 0,
    vulnerability: 0,
    arc: "stable",
  },
  memory: { hasPersonalHistory: false, retrievedCount: 0, relevanceScores: [] },
  timing: { silenceDurationMs: 10000, turnCount: 3 },
  frustration: 0,
  initiativeMetrics: {
    consecutiveQuestions: 0,
    recentQuestionCount: 0,
    userCarryingConversation: false,
    questionFatigue: 0,
    lastUserRespondedToQuestion: true,
  },
  social: {
    should_question: true,
    should_continue_listening: false,
    question_value: 0.8,
    conversational_momentum: {
      user_elaborating: false,
      unfinished_thought: false,
      user_wants_space: false,
      topic_depth: 2,
      exploratory: true,
      storytelling: false,
      argumentative: false,
    },
  },
  questionFatigue: 0,
  planMemoryPolicy: "Ignore",
  hasMusicContext: false,
  atmospherePresent: false,
  backgroundEvaluation: true,
};
assert.equal(autonomous.evaluateAutonomous(input).shouldSpeak, true);
assert.equal(autonomous.evaluateAutonomous({ ...input, userInterrupted: true }).shouldSpeak, false);
assert.equal(
  autonomous.evaluateAutonomous({ ...input, literal: "goodbye", speakerGoal: "close" }).shouldSpeak,
  false,
);

async function coordinator() {
  let now = Date.now(),
    onSnapshot,
    onActivity,
    resolveFetch;
  let snapshot = { revision: 1, updatedAt: now, input: structuredClone(input) };
  let delivered = 0,
    cancelled = 0;
  const runtime = {
    getAutonomySnapshot: () => structuredClone(snapshot),
    subscribeAutonomy: (fn) => {
      onSnapshot = fn;
      return () => {};
    },
    observe: () => {},
    buildAutonomousPrompt: (t) => t,
  };
  const pipeline = {
    status: "listening",
    isSpeaking: false,
    isThinking: false,
    getSessionId: () => "real-session",
    deliverAutonomous: () => {
      delivered++;
      return true;
    },
    cancelAutonomous: () => cancelled++,
  };
  const { ProactiveEngine } = load(
    "src/runtime/ProactiveEngine.ts",
    {
      "./ConversationStateManager": {
        ConversationStateManager: {
          getInstance: () => ({ getState: () => "IDLE", subscribe: () => () => {} }),
        },
      },
      "./RuntimeManager": { RuntimeManager: { getInstance: () => runtime } },
      "@/telemetry/RuntimeTelemetry": { auraTelemetry: { recordError: () => {} } },
      "@/config/api": { ENDPOINTS: { proactive: "/proactive" } },
      "./autonomousConversation/IntentionStore": { IntentionStore },
      "./autonomousConversation/AutonomousConversationEngine": autonomous,
      "./autonomousConversation/AutonomyEvents": {
        subscribeAutonomyUserActivity: (fn) => {
          onActivity = fn;
          return () => {};
        },
      },
    },
    {
      Date: class extends Date {
        static now() {
          return now;
        }
      },
      setInterval: () => 1,
      clearInterval: () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
      AbortController,
      crypto: { randomUUID: () => "network" },
      fetch: () => new Promise((r) => (resolveFetch = r)),
    },
  );
  const engine = ProactiveEngine.getInstance();
  engine.start("user", () => pipeline);
  onSnapshot();
  now += 6000;
  await engine.tick();
  assert.equal(
    delivered,
    1,
    `eligible event reaches provider once: ${JSON.stringify(engine.diagnostics())}`,
  );
  await engine.tick();
  assert.equal(delivered, 1, "submitted intention cannot duplicate");
  onActivity();
  assert.equal(cancelled, 1, "speech cancels in-flight response");
  assert.equal(engine.diagnostics().intentions[0].status, "interrupted");
  snapshot.revision = 2;
  onSnapshot();
  resolveFetch({ ok: true, json: async () => ({ action: "offer", inject_text: "stale" }) });
  await new Promise((r) => setImmediate(r));
  assert.ok(
    !engine.diagnostics().intentions.some((i) => i.id === "network"),
    "stale network response discarded",
  );
  engine.stop();
  engine.start("user", () => pipeline);
  engine.configure("shadow");
  onSnapshot();
  now += 6000;
  await engine.tick();
  assert.equal(delivered, 1, "shadow never dispatches");
  assert.ok(engine.diagnostics().traces.some((t) => t.outcome === "SPEAK_SHADOW"));
  engine.stop();
}
async function gemini() {
  let events,
    output = [],
    callbacks = [];
  class Session {
    constructor(c, e) {
      events = e;
    }
    async connect() {}
    requestAutonomousResponse() {
      return true;
    }
    disconnect() {}
  }
  class Input {
    async acquire() {
      return {};
    }
    setVadState() {}
    startStreaming() {}
    stopStreaming() {}
  }
  class Output {
    initialize() {}
    enqueueChunk(data, cb) {
      output.push(data);
      callbacks.push(cb);
    }
    stopPlayback() {}
  }
  const { GeminiVoiceEngine } = load("src/providers/gemini-next/GeminiVoiceEngine.ts", {
    "./GeminiSession": { GeminiSession: Session },
    "./GeminiAudioInput": { GeminiAudioInput: Input },
    "./GeminiAudioOutput": { GeminiAudioOutput: Output },
    "../../music/PlaybackState": { playbackState: { getState: () => ({ isPlaying: false }) } },
  });
  const engine = new GeminiVoiceEngine({}, {});
  await engine.start();
  assert.equal(engine.requestAutonomousResponse("intent"), true);
  assert.equal(engine.requestAutonomousResponse("duplicate"), false);
  engine.cancelAutonomousResponse();
  events.onAudioChunkReceived("stale");
  assert.equal(output.length, 0, "cancelled generation audio is dropped");
  events.onInterrupted();
  events.onAudioChunkReceived("user-response");
  assert.equal(output[0], "user-response", "interruption starts fresh response");
  engine.stop();
}
function reflection() {
  const saved = [];
  const { ReflectionEngine } = load(
    "src/executive/ReflectionEngine.ts",
    {},
    { localStorage: { getItem: () => null, setItem: (k, v) => saved.push(v) } },
  );
  const engine = new ReflectionEngine();
  const plan = {
    strategy: { primary: "Answer" },
    confidence: { label: "Low" },
    informationBudget: "Normal",
    clarification: { required: false },
    tone: { warmth: 0.5 },
    understanding: { move: "Answer", confidence: { value: 0.2 }, expected: "information" },
  };
  engine.reflect({ plan, userReactedNegatively: false, userFollowedUp: false });
  assert.equal(saved.length, 0, "unknown outcome does not learn");
  for (let i = 0; i < 2; i++)
    engine.reflect({ plan, userReactedNegatively: true, userFollowedUp: false });
  assert.equal(saved.length, 0, "single correction does not rewrite preferences");
  engine.reflect({ plan, userReactedNegatively: true, userFollowedUp: false });
  assert.ok(engine.weights.clarifyBias > 0);
  const before = engine.weights.clarifyBias;
  engine.reflect({ plan, userReactedNegatively: false, userFollowedUp: true });
  assert.ok(engine.weights.clarifyBias < before, "learning is reversible");
}
(async () => {
  await coordinator();
  await gemini();
  reflection();
  console.log(
    "PASS autonomy: lifecycle, dedupe, expiry, supersession, shadow, stale network, interruption, output suppression, reflection",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
