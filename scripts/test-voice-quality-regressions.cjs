// Execute production callbacks with deterministic transport/audio boundaries.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const noop = () => {};
const ref = (current) => ({ current });
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

async function playback() {
  let events;
  const ended = [];
  const vad = [];
  let completed = 0;
  class Session {
    constructor(_config, callbacks) {
      events = callbacks;
    }
    async connect() {}
    disconnect() {}
  }
  class Input {
    async acquire() {
      return {};
    }
    setVadState(...args) {
      vad.push(args);
    }
    startStreaming() {}
    stopStreaming() {}
  }
  class Output {
    initialize() {}
    enqueueChunk(_data, callback) {
      ended.push(callback);
    }
    stopPlayback() {}
  }
  const exports = {};
  vm.runInNewContext(
    compile(fs.readFileSync("src/providers/gemini-next/GeminiVoiceEngine.ts", "utf8")),
    {
      exports,
      console,
      require: (path) => {
        if (path && path.includes("PlaybackState")) {
          return { playbackState: { getState: () => ({ isPlaying: false }) } };
        }
        return {
          GeminiSession: Session,
          GeminiAudioInput: Input,
          GeminiAudioOutput: Output,
        };
      },
    },
  );
  const engine = new exports.GeminiVoiceEngine({}, { onTurnComplete: () => completed++ });
  await engine.start();
  events.onAudioChunkReceived("first");
  events.onAudioChunkReceived("second");
  events.onTurnComplete();
  assert.equal(completed, 0, "generation completion must wait for buffered playback");
  ended.shift()();
  assert.equal(completed, 0);
  ended.shift()();
  assert.equal(completed, 1, "draining audio must complete the turn");
  assert.equal(engine.telemetry.isPlaying, false);
  assert.deepEqual(vad.at(-1), [true, false, false, false]);

  events.onAudioChunkReceived("interrupted");
  const stale = ended.shift();
  events.onInterrupted();
  events.onAudioChunkReceived("replacement");
  events.onTurnComplete();
  stale();
  assert.equal(completed, 1, "cancelled playback cannot finish the replacement turn");
  ended.shift()();
  assert.equal(completed, 2);

  events.onAudioChunkReceived("stopped");
  const stopped = ended.shift();
  events.onTurnComplete();
  engine.stop();
  stopped();
  assert.equal(completed, 2, "stopping must invalidate outstanding audio callbacks");
}

function processCallback(file) {
  const source = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "processTurn") {
      callback = node.initializer.arguments[0].getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(callback);
  return compile(`globalThis.runTurn = ${callback};`);
}

async function contextFlow(provider, hidden, failMidStream = false, supersede = false) {
  const previous = [
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" },
  ];
  let request;
  let reads = 0;
  let calls = 0;
  const appended = [];
  let releaseEarlier;
  const earlierAnalysis = new Promise((resolve) => {
    releaseEarlier = resolve;
  });
  const runtime = {
    processCognitiveTurn: async () => "cognitive context",
    getLastAtmosphereDecision: () => null,
    getLastExecutivePrompt: () => "",
  };
  const context = {
    console,
    performance,
    AbortController,
    setTimeout: () => 0,
    clearTimeout: noop,
    turnNonceRef: ref(0),
    stopSpeech: noop,
    stopThinkingAudio: noop,
    stopRecognition: noop,
    conversationalPauses: { resetForNewTurn: noop },
    lastAudioEndRef: ref(0),
    wasInterruptedRef: ref(false),
    spokenTextRef: ref(""),
    prevTurnInterruptedRef: ref(false),
    processTurnStartRef: ref(0),
    turnWasUserInitiatedRef: ref(false),
    setIsThinking: noop,
    setStatus: noop,
    lastTokenTimeRef: ref(0),
    inferThinkingIntent: () => "searching",
    resolveThinkingCue: () => null,
    transcript_: { addTurn: noop, addInterruptedTurn: noop, turnCountRef: ref(0) },
    sessionStatsRef: ref({ turns: 0, abortedStreams: 0 }),
    behavior: {
      analyzeForTurn: async (text) => (text === "Superseded utterance" ? earlierAnalysis : null),
    },
    prompts: {},
    sessionIdRef: ref("test"),
    modeRef: ref("adaptive"),
    userIdRef: ref("test"),
    connectionState: { updateLatency: noop },
    RuntimeManager: { getInstance: () => runtime },
    atmosphereRef: ref(null),
    buildMusicContext: () => "",
    messagesRef: ref(previous),
    // React does not commit the queued state update synchronously.
    addMessages: (messages) => appended.push(...messages),
    fetchAbortRef: ref(null),
    ENDPOINTS: { analyzeStream: "/stream" },
    getCredential: () => "",
    boundCognitiveBlock: (x) => x,
    playbackState: { getState: () => ({}) },
    lastAudioActivityRef: ref(0),
    heldTextRef: ref(null),
    heldAtRef: ref(0),
    pushConversationTrace: noop,
    TextDecoder,
    toolExtractorRef: ref({ reset: noop, feed: (text) => text, extractTools: () => [] }),
    sentenceQueueRef: ref([]),
    currentTurnIdRef: ref(0),
    streamEpochRef: ref(0),
    lastTokenTsRef: ref(0),
    firstTokenArrivedRef: ref(false),
    conversationState: { reportSpeakingFinished: noop },
    isSessionActiveRef: ref(false),
    startSessionRef: ref(null),
    fetch: async (_url, options) => {
      calls++;
      request = JSON.parse(options.body);
      if (failMidStream)
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: async () => {
                reads++;
                if (reads > 1) throw new Error("read continued after a terminal provider error");
                return {
                  done: false,
                  value: new TextEncoder().encode(
                    'data: {"event":"text_chunk","text":"Partial answer"}\n\n' +
                      'data: {"event":"error","error":"provider unavailable"}\n\n',
                  ),
                };
              },
            }),
          },
        };
      throw Object.assign(new Error("test transport boundary"), { name: "AbortError" });
    },
  };
  const file =
    provider === "openrouter"
      ? "src/providers/openrouter/useProvider.ts"
      : "src/providers/sarvam/useSarvam.ts";
  vm.runInNewContext(processCallback(file), context);
  const earlier = supersede
    ? context.runTurn("Superseded utterance", "test", "en-US", false)
    : null;
  await context.runTurn("Current utterance", "test", "en-US", hidden);
  releaseEarlier(null);
  if (earlier) await earlier;
  if (supersede)
    assert.equal(calls, 1, "late cognitive work must not start a superseded LLM request");
  assert.ok(request, "turn must reach transport");
  assert.deepEqual(
    request.conversation_history,
    [...previous, { role: hidden ? "system" : "user", content: "Current utterance" }],
    `${provider}: current ${hidden ? "hidden" : "spoken"} utterance must reach the LLM exactly once`,
  );
  assert.equal(request.origin, hidden ? "autonomous" : "user");
  if (failMidStream) {
    assert.equal(reads, 1, "terminal error must escape the JSON parsing catch");
    assert.equal(calls, 1, "partial responses must not be regenerated and repeated");
    assert.equal(appended.filter((m) => m.role === "assistant").length, 1);
    assert.match(appended.at(-1).content, /^Partial answer/);
    assert.notEqual(appended.at(-1).content, "Partial answer", "history must mark partial replies");
  }
}

(async () => {
  let failures = 0;
  const tests = [["buffered Gemini playback", playback]];
  for (const provider of ["openrouter", "sarvam"]) {
    for (const hidden of [false, true])
      tests.push([`${provider} context hidden=${hidden}`, () => contextFlow(provider, hidden)]);
    tests.push([`${provider} midstream failure`, () => contextFlow(provider, false, true)]);
    tests.push([
      `${provider} superseded cognition`,
      () => contextFlow(provider, false, false, true),
    ]);
  }
  for (const [name, test] of tests) {
    try {
      await test();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }
  process.exitCode = failures ? 1 : 0;
})();
