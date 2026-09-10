import { AdaptiveExecutionEngine } from "./AdaptiveExecutionEngine";
import { RuntimeTelemetry } from "./RuntimeTelemetry";
import { SpeechCoordinator } from "@/audioRuntime/SpeechCoordinator";
import { MicrophoneSupervisor } from "./resilience/MicrophoneSupervisor";
import { SessionLifecycleManager } from "./lifecycle/SessionLifecycleManager";
import { ConversationInterpreter } from "./conversationInterpreter/ConversationInterpreter";
import { BehaviorAnalysis } from "@/lib/behavior-client";
import { ConversationRuntime } from "./conversationRuntime/ConversationRuntime";
import { HumanResponseTimingEngine } from "./humanTiming/HumanResponseTimingEngine";
import { RuntimeDecisionBuilder } from "./decision/RuntimeDecisionBuilder";
import { RuntimeDecision } from "./decision/DecisionContracts";
import { DecisionTelemetry } from "./decision/DecisionTelemetry";
import { TimingDiffTelemetry } from "./decision/TimingDiffTelemetry";
import { SenseManager } from "@/sense/SenseManager/SenseManager";
import type { SenseEvidenceV1 } from "@/sense/SenseManager/types";
import type { ProviderExecutionDirective, ExecutionAction } from "@/providers/core/ProviderAdapter";
import { AdaptiveCommunicationAnalyzer } from "./language/AdaptiveCommunicationAnalyzer";
import {
  getAdaptiveAttentionLayer,
  type AtmosphereRelevanceDecision,
} from "./attention/AdaptiveAttentionLayer";
import type { AtmosphereContext } from "@/executive/AtmosphereContext";
import { memoryGateway } from "@/lib/memory-gateway";
import { getCurrentUserId } from "@/lib/user-identity";
import { ConversationExecutive } from "@/executive/ConversationExecutive";
import { buildConversationContext } from "@/executive/ConversationContext";
import { getSocialCognitionEngine } from "./socialCognition/SocialCognitionEngine";
import type { SocialDecisionObject } from "./socialCognition/SocialDecision";
import { playbackState } from "@/music/PlaybackState";
import {
  evaluateSocialContext,
  MUSIC_KEYWORDS,
  ENVIRONMENT_KEYWORDS,
} from "./socialPresence/ContextualRelevanceEngine";
import { formatSocialContextBlock } from "./socialPresence/formatSocialContextBlock";

/**
 * RuntimeManager is the single entry point for the Adaptive Runtime.
 * It coordinates Media, Audio, and Execution engines, abstracting device-specifics.
 */
export class RuntimeManager {
  private static instance: RuntimeManager;

  private executionEngine = new AdaptiveExecutionEngine();
  private telemetry = RuntimeTelemetry.getInstance();
  private speechCoordinator = SpeechCoordinator.getInstance(); // Takes ownership of Media Runtime
  private microphoneSupervisor = new MicrophoneSupervisor();
  private lifecycleManager = new SessionLifecycleManager();
  private conversationRuntime = ConversationRuntime.getInstance();
  private hrte = HumanResponseTimingEngine.getInstance();
  private decisionTelemetry = DecisionTelemetry.getInstance();
  private timingDiff = TimingDiffTelemetry.getInstance();
  private conversationExecutive = new ConversationExecutive();

  // Last-turn outputs exposed to providers. Both are byproducts of
  // processCognitiveTurn / buildInitialCognitiveSnapshot; storing them avoids
  // recomputation and lets a provider read the decision it needs when
  // building its outbound request.
  private lastAtmosphereDecision: AtmosphereRelevanceDecision | null = null;
  private lastExecutivePrompt: string = "";

  private constructor() {}

  public static getInstance(): RuntimeManager {
    if (!RuntimeManager.instance) {
      RuntimeManager.instance = new RuntimeManager();
    }
    return RuntimeManager.instance;
  }

  public initialize() {
    const policy = this.executionEngine.determinePolicy();
    this.telemetry.logEvent({
      subsystem: "RuntimeManager",
      severity: "info",
      data: { event: "RuntimeInitialized", policy },
    });
  }

  public getSpeechCoordinator() {
    return this.speechCoordinator;
  }

  public getTelemetry() {
    return this.telemetry;
  }

  public getExecutionEngine() {
    return this.executionEngine;
  }

  public getMicrophoneSupervisor() {
    return this.microphoneSupervisor;
  }

  public getLifecycleManager() {
    return this.lifecycleManager;
  }

  /**
   * Atmosphere relevance decision for the most recent cognitive turn.
   * Providers read `.includeAtmosphere` to decide whether to ask the backend
   * for world grounding this turn. `null` before the first turn.
   */
  public getLastAtmosphereDecision(): AtmosphereRelevanceDecision | null {
    return this.lastAtmosphereDecision;
  }

  /**
   * The `[EXECUTIVE PLAN]` directive built for the most recent cognitive turn.
   * Empty string before the first turn.
   */
  public getLastExecutivePrompt(): string {
    return this.lastExecutivePrompt;
  }

  public dispose() {
    this.speechCoordinator.flush();
    this.microphoneSupervisor.dispose();
    this.lifecycleManager.dispose();
  }

  /**
   * Emotional state vector for memory retrieval/storage.
   *
   * `BehaviorAnalysis` has no `emotionalTags` field — it carries the flat
   * `frustration`/`playfulness`/`vulnerability`/`trust`/`anxiety` scores. The
   * previous `backendBehavior?.emotionalTags ?? {}` therefore always resolved
   * to `{}`, and `scoreEmotionalMatch` returns 0 for an empty state, so
   * emotional matching contributed nothing to ranking. This mirrors the
   * mapping the OpenRouter and Sarvam providers already build.
   */
  private emotionalStateOf(behavior: BehaviorAnalysis | null): Record<string, number> {
    return {
      frustration: behavior?.frustration ?? 0,
      playfulness: behavior?.playfulness ?? 0,
      vulnerability: behavior?.vulnerability ?? 0,
      trust: behavior?.trust ?? 0,
      anxiety: behavior?.anxiety ?? 0,
    };
  }

  /**
   * Evaluates the cognitive and expressive state for the current turn.
   * Flushes the Perception Fusion Layer and delivers the fused evidence to
   * Cognition. This MUST be called by Providers instead of importing engines directly.
   *
   * Phase A contract: the fused evidence is the ONLY intake Cognition receives
   * from the perception layer. An empty result keeps the pre-wiring behavior
   * byte-identical — absence of evidence stays absence.
   *
   * `atmosphere` and `turnSignals` were already being passed by the OpenRouter
   * and Sarvam providers but were not declared here, so JS silently dropped
   * them. They are now accepted and threaded through.
   */
  public async processCognitiveTurn(
    text: string,
    backendBehavior: BehaviorAnalysis | null,
    mode: string = "adaptive",
    atmosphere: AtmosphereContext | null = null,
    turnSignals: { wasInterruption?: boolean; silenceDurationMs?: number } = {},
    sessionId?: string,
  ): Promise<string> {
    // 1. Update Conversation Runtime
    this.conversationRuntime.registerUserTurn(text);

    // 2. Flush fused perception evidence (Senses → Sense Runtime → Fusion)
    const evidence: SenseEvidenceV1[] = await SenseManager.getInstance().collectAllContext();
    if (evidence.length > 0) {
      this.telemetry.logEvent({
        subsystem: "RuntimeManager",
        severity: "info",
        data: {
          event: "FUSED_EVIDENCE_DELIVERED",
          count: evidence.length,
          sources: evidence.map((e) => e.source),
        },
      });
    }

    // 3. Centralized Memory & Cognitive Context Wiring
    const userId = getCurrentUserId();
    const emotionalState = this.emotionalStateOf(backendBehavior);
    const retrievedMemories = await memoryGateway.retrieveMemories(text, userId, emotionalState);

    const stableFacts = retrievedMemories
      .filter((m) => m.metadata?.tier === "stable")
      .map((m) => m.content);
    const recentAndCurrent = retrievedMemories.filter((m) => m.metadata?.tier !== "stable");

    const ctx = buildConversationContext({
      input: {
        text,
        sttConfidence: 1,
        wasInterruption: turnSignals.wasInterruption ?? false,
        audioRms: 0,
        languageMode: "unknown",
      },
      memory: {
        retrieved: recentAndCurrent.map((m) => m.content),
        relevanceScores: recentAndCurrent.map((m) => m.similarity ?? 1),
        hasPersonalHistory: retrievedMemories.length > 0,
        sessionTurn: this.conversationRuntime.getState().turnCount,
      },
      userIdentity: {
        stableFacts: stableFacts,
      },
      timing: {
        turnCount: this.conversationRuntime.getState().turnCount,
        ...(turnSignals.silenceDurationMs !== undefined
          ? { silenceDurationMs: turnSignals.silenceDurationMs }
          : {}),
      },
      atmosphere,
      behaviorAnalysis: backendBehavior,
    });

    // Generate Execution Plan
    const plan = this.conversationExecutive.plan(ctx);

    // Record the atmosphere relevance decision and the plan directive for this
    // turn so providers can read them after the fact (see getLastAtmosphereDecision
    // / getLastExecutivePrompt). Both are computed here regardless, so exposing
    // them adds no work — it only stops the values being discarded.
    this.lastAtmosphereDecision = getAdaptiveAttentionLayer().assessAtmosphere(text, atmosphere);
    this.lastExecutivePrompt = this.conversationExecutive.translatePlanToPrompt(plan);

    // 3.75 Social Cognition — the "how to be present" layer. Runs BEFORE the
    // interpreter so its decision can be threaded into the cognitive block.
    // No user-turn history is tracked yet, so recentHistory is empty (safe —
    // topic/position continuity simply reports nothing on the first turns).
    let socialDecision: SocialDecisionObject | null = null;
    try {
      const trimmed = text.trim();
      socialDecision = getSocialCognitionEngine().processTurn({
        text,
        userId,
        wordCount: trimmed ? trimmed.split(/\s+/).length : 0,
        isQuestion: trimmed.endsWith("?"),
        userInitiated: true,
        backendVulnerability: backendBehavior?.vulnerability ?? 0,
        backendTension: backendBehavior?.tension ?? 0,
        backendEnergy: backendBehavior?.energy ?? 0,
        backendPlayfulness: backendBehavior?.playfulness ?? 0,
        clarificationRequired: false,
        auraAskedQuestionThisTurn: false,
        isAuraInterrupted: turnSignals.wasInterruption ?? false,
        silenceMs: turnSignals.silenceDurationMs ?? 0,
        recentHistory: [],
      });
    } catch (e) {
      console.warn("[RuntimeManager] Social cognition evaluation failed:", e);
      socialDecision = null;
    }

    // 4. Interpret Backend Intelligence for Frontend Execution
    // The interpreter already accepts atmosphere + the relevance decision; it
    // renders only the dimensions marked relevant, so an irrelevant or absent
    // atmosphere still yields an empty block.
    const response = ConversationInterpreter.getInstance().processTurn(
      text,
      backendBehavior,
      evidence,
      plan,
      mode,
      socialDecision,
      atmosphere,
      this.lastAtmosphereDecision,
    );

    // 4b. Social Presence — global, provider-independent contextual evaluation.
    // Consumes existing signals without re-implementing them.
    // Does NOT feed initiativeScore or any autonomous-speech gating.
    let socialPresenceBlock = "";
    try {
      const musicState = playbackState.getState();
      const socialPresenceInput = {
        emotion: {
          tension: ctx.emotion.tension,
          energy: ctx.emotion.energy,
          warmth: ctx.emotion.warmth,
          engagement: ctx.emotion.engagement,
          frustration: ctx.emotion.frustration,
          vulnerability: ctx.emotion.vulnerability,
        },
        music: {
          hasActiveTrack: Boolean(musicState.currentTrack),
          isPlaying: Boolean(musicState.isPlaying),
          title: musicState.currentTrack?.title ?? null,
          artist: musicState.currentTrack?.artist ?? null,
        },
        atmospherePresent: false,
        memory: {
          hasPersonalHistory: ctx.memory.hasPersonalHistory,
          retrievedCount: ctx.memory.retrieved.length,
          maxRelevanceScore:
            ctx.memory.relevanceScores.length > 0 ? Math.max(...ctx.memory.relevanceScores) : 0,
        },
        timing: {
          silenceDurationMs: ctx.timing.silenceDurationMs,
          turnCount: ctx.timing.turnCount,
        },
        userInterrupted: ctx.input.wasInterruption,
        auraJustSpoke: false,
        socialMomentum: {
          user_elaborating: false,
          unfinished_thought: false,
          user_wants_space: false,
          topic_depth: 0,
          exploratory: false,
          storytelling: false,
          argumentative: false,
        },
        relationshipStage: "established",
        autonomousAction: "RESPOND_ONLY",
        senseSourceCount: evidence.length,
        userMentionsMusic: MUSIC_KEYWORDS.test(text),
        userMentionsEnvironment: ENVIRONMENT_KEYWORDS.test(text),
      };
      const socialContext = evaluateSocialContext(socialPresenceInput);
      socialPresenceBlock = formatSocialContextBlock(socialContext);
    } catch (e) {
      console.error("[RuntimeManager] Social Presence evaluation failed:", e);
      socialPresenceBlock = "";
    }

    // 4. Asynchronously update Adaptive Communication Profile (Does not block TTFB)
    setTimeout(() => {
      try {
        AdaptiveCommunicationAnalyzer.getInstance().observe({
          userText: text,
          backendBehavior,
        });
      } catch (e) {
        console.error("[RuntimeManager] Error updating adaptive communication profile:", e);
      }
    }, 0);

    // 6. Asynchronously persist memory (fire-and-forget — never blocks TTFB)
    setTimeout(() => {
      try {
        memoryGateway.storeMemory(text, userId, emotionalState, undefined, sessionId);
      } catch (e) {
        console.error("[RuntimeManager] Error storing memory:", e);
      }
    }, 0);

    return response + socialPresenceBlock;
  }

  /**
   * Generates a pre-formatted Cognitive Context string for Gemini session initialization.
   * This retrieves the latest UserIdentity and AdaptiveCommunication profile without
   * blocking or triggering an active conversation turn.
   *
   * `atmosphere` is already supplied by useLiveNext (browser temporal context)
   * but was previously undeclared and therefore dropped.
   */
  public async buildInitialCognitiveSnapshot(
    userId: string,
    mode: string = "adaptive",
    atmosphere: AtmosphereContext | null = null,
  ): Promise<string> {
    // 1. Fetch any generic/top-level relevant memories
    // Now supported by passing an empty query to the backend which returns
    // relevance-ranked stable facts and current state within context limits.
    const retrievedMemories = await memoryGateway.retrieveMemories("", userId, {});
    const stableFacts = retrievedMemories
      .filter((m) => m.metadata?.tier === "stable")
      .map((m) => m.content);
    const recentAndCurrent = retrievedMemories.filter((m) => m.metadata?.tier !== "stable");

    // 2. Build a baseline conversation context
    const ctx = buildConversationContext({
      input: {
        text: "",
        sttConfidence: 1,
        wasInterruption: false,
        audioRms: 0,
        languageMode: "unknown",
      },
      memory: {
        retrieved: recentAndCurrent.map((m) => m.content),
        relevanceScores: recentAndCurrent.map((m) => m.similarity ?? 1),
        hasPersonalHistory: retrievedMemories.length > 0,
        sessionTurn: 0,
      },
      userIdentity: {
        stableFacts: stableFacts,
      },
      timing: {
        turnCount: 0,
      },
      atmosphere,
      behaviorAnalysis: null,
    });

    // 3. Generate a plan
    const plan = this.conversationExecutive.plan(ctx);

    // 4. Format the final snapshot using the Interpreter
    // We pass empty arrays for evidence/behavior as they are not applicable on session start.
    // There is no user text on session start, so no dimension can be relevance-
    // matched; the decision is left unset and the atmosphere block stays empty.
    const snapshot = ConversationInterpreter.getInstance().processTurn(
      "",
      null,
      [],
      plan,
      mode,
      null,
      atmosphere,
      null,
    );

    return snapshot;
  }

  public routeDecision(decision: RuntimeDecision): ProviderExecutionDirective {
    this.decisionTelemetry.record(decision);

    // Determine Execution Behavior based on decision policies
    let action: ExecutionAction = "SPEAK";

    if (decision.dispatchPolicy === "Hold") {
      action = "WAIT";
    } else if (decision.dispatchPolicy === "Anticipatory") {
      action = "BACKCHANNEL";
    }

    this.telemetry.logEvent({
      subsystem: "RuntimeManager",
      severity: "info",
      data: {
        event: "DECISION_ROUTED",
        action,
        timingIntent: decision.timingIntent,
      },
    });

    return {
      action,
      delayMs: decision.timingIntent,
    };
  }

  public observe(event: any) {
    this.telemetry.logEvent(event);
  }

  public evaluateDecision(
    currentText: string,
    previousText: string,
    ttft: number,
    legacyPauseMs: number,
  ) {
    const streamDecision = this.hrte.evaluateStream(currentText, previousText, 0);
    const hrtePauseMs = this.hrte.calculateFinalPause(ttft);

    this.timingDiff.recordDiff(
      "turn_" + performance.now().toFixed(0),
      legacyPauseMs,
      hrtePauseMs,
      "rule_based",
      streamDecision.intent,
    );

    let dispatchPolicy: "Immediate" | "Delayed" | "Anticipatory" | "Hold" = "Immediate";
    if (streamDecision.intent === "FollowUp" || streamDecision.intent === "QuickFact") {
      dispatchPolicy = "Anticipatory"; // Often mapped to Backchannel
    }
    if (streamDecision.confidence < 50 && currentText.length < 5) {
      dispatchPolicy = "Hold";
    }

    const decision = new RuntimeDecisionBuilder()
      .setConversationType(streamDecision.intent)
      .setConversationState((this.conversationRuntime.getState() as any) || "Speaking")
      .setEndpointConfidence(streamDecision.confidence)
      .setTimingIntent(hrtePauseMs)
      .setDispatchPolicy(dispatchPolicy)
      .build();

    return this.routeDecision(decision);
  }

  public reset() {
    this.conversationRuntime.reset();
    AdaptiveCommunicationAnalyzer.getInstance().clearSession();
  }
}
