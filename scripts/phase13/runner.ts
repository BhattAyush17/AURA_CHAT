import { ConversationExecutive } from "../../src/executive";
import { understand } from "../../src/executive/ConversationUnderstanding";
import { deriveSocialUnderstanding, allInfluences } from "../../src/executive/SocialWorldModel";
import {
  buildConversationContext,
  type TranscriptEntry,
} from "../../src/executive/ConversationContext";
import { determineRelationshipStage } from "../../src/executive/RegisterState";
import type { ExecutionPlan } from "../../src/executive/ExecutionPlan";
import { callLlm, type LlmHistoryEntry } from "./llm";
import { fidelityOf, humanJudge } from "./fidelity";
import type { Dataset, DatasetTurn } from "./types";
import { BUDGET_WORDS } from "../../src/executive/InformationBudget";

export interface EngineActivation {
  perception: string;
  understanding: string;
  swm: string;
  memory: string;
  relationship: string;
  reflection: string;
  language: string;
  register: string;
  executive: string;
  plan: string;
  prompt: string;
  llm: string;
  speech: string;
  telemetry: string;
  reflectionUpdate: string;
}

export interface TurnRecord {
  turn: number;
  userText: string;
  perception: {
    sttConfidence: number;
    interruption: boolean;
    silenceMs: number;
    tags: string[];
  };
  understanding: {
    move: string;
    literal: string;
    goal: string;
    implicit: string | null;
    expected: string;
    social: string[];
    clarify: boolean;
  };
  swm: string[];
  memory: { policy: string; retrieved: number; injected: number; referenced: boolean };
  relationship: string;
  reflection: { weights: string; adaptations: string[] };
  language: { dominant: string; confidence: number; stability: number };
  register: { register: string; confidence: number; stability: number };
  executive: {
    strategy: string;
    initiative: string;
    budget: string;
    confidence: string;
    rationale: string;
  };
  prompt: string;
  promptTokens: number;
  llm: string | null;
  speech: {
    speed: number;
    energy: number;
    warmth: number;
    emphasis: number;
    thinking: string | null;
  };
  telemetryEvents: number;
  reflectionUpdate: { signals: string[]; notes: string[] };
  fidelity: ReturnType<typeof fidelityOf> | null;
  human: ReturnType<typeof humanJudge> | null;
  pipelineMs: number;
  engines: EngineActivation;
}

export interface ConversationRun {
  dataset: Dataset;
  model: string;
  startedAt: string;
  turns: TurnRecord[];
  stats: {
    interruptions: number;
    repairs: number;
    callbacks: number;
    memoryUsed: number;
    reflectionAdaptations: number;
    languageSwitches: number;
    registerChanges: number;
    avgFidelity: number;
    avgHumanity: number;
    realism: number;
    productionReady: boolean;
    pipelineMsAvg: number;
  };
}

function buildBehaviorAnalysis(turn: DatasetTurn) {
  const b = turn.behavior;
  if (!b) return null;
  return {
    act: b.act ?? null,
    tags: b.tags ?? [],
    template: null,
    source: "dataset",
    energy: b.energy ?? 0.5,
    behavior_instructions: "",
    emotional_state: turn.emo?.dominant ?? "neutral",
    intensity: b.intensity ?? 0.5,
    frustration: b.frustration,
    playfulness: b.playfulness,
    vulnerability: b.vulnerability,
    trust: b.trust,
    status: "completed",
  };
}

export async function runConversation(
  dataset: Dataset,
  opts: { callLlm: boolean; model: string; onTurn?: (r: TurnRecord) => void },
): Promise<ConversationRun> {
  const exec = new ConversationExecutive();
  const history: TranscriptEntry[] = [];
  const llmHistory: LlmHistoryEntry[] = [];
  const telemetry: Array<{ ts: string; turn: number; event: string; details: unknown }> = [];
  const records: TurnRecord[] = [];
  let prevLlm: string | null = null;
  let prevLang = "";
  let prevReg = "";
  let languageSwitches = 0;
  let registerChanges = 0;
  let repairs = 0;
  let interruptions = 0;
  let callbacks = 0;
  let memoryUsed = 0;
  let reflectionAdaptations = 0;
  let pipelineMsSum = 0;

  for (let i = 0; i < dataset.turns.length; i++) {
    const turn = dataset.turns[i];
    const turnNo = i + 1;
    const started = performance.now();

    // ── Perception ──────────────────────────────────────────────────────
    telemetry.push({
      ts: new Date().toISOString(),
      turn: turnNo,
      event: "PERCEPTION",
      details: { text: turn.text.slice(0, 60) },
    });
    const behaviorAnalysis = buildBehaviorAnalysis(turn) as any;
    const perception = {
      sttConfidence: 0.92,
      interruption: turn.interruption ?? false,
      silenceMs: turn.silenceMs ?? 0,
      tags: turn.behavior?.tags ?? [],
    };

    // ── Language / Relationship / Register observers ────────────────────
    exec.observeLanguage(turn.text, turnNo);
    const relationship = determineRelationshipStage({
      sessionTurn: turnNo,
      hasPersonalHistory: dataset.hasPersonalHistory,
      trust: dataset.trust,
    });
    exec.observeRegister(turn.text, turnNo, relationship);

    const memoryRetrieved = turn.memory ?? [];
    const ctx = buildConversationContext({
      input: {
        text: turn.text,
        sttConfidence: 0.92,
        wasInterruption: turn.interruption ?? false,
        audioRms: 0.02,
        languageMode: dataset.languageMode,
      },
      language: exec.getLanguageState(),
      register: exec.getRegisterState(),
      emotion: {
        dominant: turn.emo?.dominant ?? "neutral",
        tension: turn.emo?.tension ?? 0.2,
        trust: dataset.trust,
        energy: turn.emo?.energy ?? 0.5,
        warmth: turn.emo?.warmth ?? 0.5,
        engagement: turn.emo?.engagement ?? 0.7,
        frustration: turn.emo?.frustration ?? 0.2,
        vulnerability: turn.emo?.vulnerability ?? 0.15,
        arc: turn.emo?.arc ?? "building",
      },
      memory: {
        retrieved: memoryRetrieved,
        relevanceScores: memoryRetrieved.map(() => 0.7),
        hasPersonalHistory: dataset.hasPersonalHistory,
        sessionTurn: turnNo,
      },
      timing: {
        silenceDurationMs: turn.silenceMs ?? 0,
        turnCount: turnNo,
        lastResponseLatencyMs: 0,
        averageResponseLengthWords: 10,
      },
      recentHistory: history.slice(-6),
      behaviorAnalysis,
    });

    // ── CUE ─────────────────────────────────────────────────────────────
    const u = understand(ctx);
    telemetry.push({
      ts: new Date().toISOString(),
      turn: turnNo,
      event: "UNDERSTANDING",
      details: { move: u.move, goal: u.speakerGoal },
    });

    // ── SWM ─────────────────────────────────────────────────────────────
    const social = deriveSocialUnderstanding(ctx, u);
    const swmInfluences = allInfluences(social).map((s) => s.name);
    telemetry.push({
      ts: new Date().toISOString(),
      turn: turnNo,
      event: "SWM",
      details: swmInfluences,
    });

    // ── Executive (memory policy → relationship → reflection → language → register → strategy → plan → speech) ──
    const reflectionBefore = JSON.stringify(exec.reflection.weights);
    const plan: ExecutionPlan = exec.plan(ctx);
    telemetry.push({
      ts: new Date().toISOString(),
      turn: turnNo,
      event: "EXECUTIVE_PLAN",
      details: {
        strategy: plan.strategy.primary,
        budget: plan.informationBudget,
        initiative: plan.initiative,
      },
    });

    // ── Prompt Builder ──────────────────────────────────────────────────
    const prompt = exec.translatePlanToPrompt(plan);
    const promptTokens = Math.round(prompt.length / 4);
    telemetry.push({
      ts: new Date().toISOString(),
      turn: turnNo,
      event: "PROMPT",
      details: { tokens: promptTokens },
    });

    // ── LLM ─────────────────────────────────────────────────────────────
    let llm: string | null = null;
    if (opts.callLlm) {
      llm = await callLlm(prompt, llmHistory, turn.text, BUDGET_WORDS[plan.informationBudget]);
      telemetry.push({
        ts: new Date().toISOString(),
        turn: turnNo,
        event: "LLM",
        details: { length: llm.length },
      });
    }

    const pipelineMs = Math.round(performance.now() - started);
    pipelineMsSum += pipelineMs;

    // ── Speech Planner ──────────────────────────────────────────────────
    const speech = {
      speed: plan.speechBehavior.speechSpeed,
      energy: plan.speechBehavior.energy,
      warmth: plan.speechBehavior.warmth,
      emphasis: plan.speechBehavior.emphasis,
      thinking: plan.thinkingBehavior.utterance,
    };
    telemetry.push({
      ts: new Date().toISOString(),
      turn: turnNo,
      event: "SPEECH",
      details: speech,
    });

    // ── Telemetry (persisted by the orchestrator to runs/<date>/<id>/telemetry.json) ──
    const telemetryEvents = telemetry.length;

    // ── Reflection Update ───────────────────────────────────────────────
    const nextTurn = dataset.turns[i + 1];
    const reflectionResult = exec.reflect(plan, {
      userReactedNegatively: false,
      userFollowedUp: true,
      nextTurnLengthDelta: nextTurn
        ? nextTurn.text.split(/\s+/).length - (llm ? llm.split(/\s+/).length : 0)
        : 0,
    });
    const reflectionUpdate = {
      signals: reflectionResult.signals,
      notes: reflectionResult.notes,
    };
    const reflectionAfter = JSON.stringify(exec.reflection.weights);
    if (reflectionBefore !== reflectionAfter || reflectionResult.notes.length > 0) {
      reflectionAdaptations++;
    }
    telemetry.push({
      ts: new Date().toISOString(),
      turn: turnNo,
      event: "REFLECTION_UPDATE",
      details: reflectionUpdate,
    });

    // ── Fidelity + Human judge ──────────────────────────────────────────
    const visibleText = [...history.map((h) => h.text)];
    const fidelity = llm ? fidelityOf(llm, plan, memoryRetrieved, visibleText) : null;
    const human = llm ? humanJudge(llm, plan, turn, prevLlm) : null;
    if (fidelity && memoryRetrieved.length > 0 && plan.memoryPolicy !== "Ignore") callbacks++;
    if (plan.memoryPolicy !== "Ignore") memoryUsed++;

    // ── Counters ────────────────────────────────────────────────────────
    if (turn.interruption) interruptions++;
    if ((turn.behavior?.tags ?? []).includes("correction")) repairs++;
    const langNow = exec.getLanguageState().dominant;
    const regNow = exec.getRegisterState().register;
    if (prevLang && langNow !== prevLang) languageSwitches++;
    if (prevReg && regNow !== prevReg) registerChanges++;
    prevLang = langNow;
    prevReg = regNow;

    // ── History ─────────────────────────────────────────────────────────
    history.push({ text: turn.text, isUser: true, timestamp: turnNo });
    if (llm) {
      history.push({ text: llm, isUser: false, timestamp: turnNo });
      llmHistory.push({ role: "user", content: turn.text });
      llmHistory.push({ role: "assistant", content: llm });
    }

    const record: TurnRecord = {
      turn: turnNo,
      userText: turn.text,
      perception,
      understanding: {
        move: u.move,
        literal: u.literal,
        goal: u.speakerGoal,
        implicit: u.implicit?.label ?? null,
        expected: u.expected,
        social: u.social.map((s) => `${s.name}(${s.confidence.toFixed(2)})`),
        clarify: u.expected === "clarification",
      },
      swm: swmInfluences,
      memory: {
        policy: plan.memoryPolicy,
        retrieved: memoryRetrieved.length,
        injected: memoryRetrieved.length,
        referenced: fidelity?.memory ?? false,
      },
      relationship,
      reflection: { weights: reflectionAfter, adaptations: reflectionResult.notes },
      language: {
        dominant: plan.language.dominant,
        confidence: plan.language.confidence,
        stability: plan.language.stability,
      },
      register: {
        register: plan.register.register,
        confidence: plan.register.confidence,
        stability: plan.register.stability,
      },
      executive: {
        strategy: plan.strategy.primary,
        initiative: plan.initiative,
        budget: plan.informationBudget,
        confidence: plan.confidence.label,
        rationale: plan.strategy.rationale ?? plan.confidence.reasoning?.join("; ") ?? "",
      },
      prompt,
      promptTokens,
      llm,
      speech,
      telemetryEvents,
      reflectionUpdate,
      fidelity,
      human,
      pipelineMs,
      engines: {
        perception: `stt=${perception.sttConfidence}`,
        understanding: `${u.move}/${u.speakerGoal}`,
        swm: swmInfluences.slice(0, 3).join(",") || "none",
        memory: `${plan.memoryPolicy}(${memoryRetrieved.length})`,
        relationship,
        reflection: reflectionBefore === reflectionAfter ? "weights-unchanged" : "weights-changed",
        language: plan.language.dominant,
        register: plan.register.register,
        executive: plan.strategy.primary,
        plan: `${plan.informationBudget}/${plan.initiative}/conf:${plan.confidence.label}`,
        prompt: `${promptTokens}t`,
        llm: llm ? `${wordCountOf(llm)}w` : "skip",
        speech: `speed:${plan.speechBehavior.speechSpeed.toFixed(2)}`,
        telemetry: `${telemetryEvents}ev`,
        reflectionUpdate: reflectionResult.notes.length > 0 ? "adapted" : "no-signal",
      },
    };
    records.push(record);
    opts.onTurn?.(record);
    prevLlm = llm;
  }

  const withFidelity = records.filter((r) => r.fidelity);
  const avgFidelity = withFidelity.length
    ? Math.round(
        withFidelity.reduce((a, r) => a + (r.fidelity?.percent ?? 0), 0) / withFidelity.length,
      )
    : 0;
  const withHuman = records.filter((r) => r.human);
  const avgHumanity = withHuman.length
    ? withHuman.reduce((a, r) => a + (r.human?.score ?? 0), 0) / withHuman.length
    : 0;
  const realism = Math.round(avgHumanity * 10) / 10;
  // Engine latency (<50ms/turn) is proven by Phase 13A (wiring mode); in LLM
  // mode the pipeline is dominated by the network call, so readiness there is
  // fidelity + realism alone.
  const engineFast = records.every((r) => r.pipelineMs < 50);
  const productionReady = avgFidelity >= 80 && realism >= 7 && (opts.callLlm ? true : engineFast);

  return {
    dataset,
    model: opts.model,
    startedAt: new Date().toISOString(),
    turns: records,
    stats: {
      interruptions,
      repairs,
      callbacks,
      memoryUsed,
      reflectionAdaptations,
      languageSwitches,
      registerChanges,
      avgFidelity,
      avgHumanity,
      realism,
      productionReady,
      pipelineMsAvg: Math.round(pipelineMsSum / records.length),
    },
  };
}

function wordCountOf(t: string): number {
  return t.split(/\s+/).filter(Boolean).length;
}
