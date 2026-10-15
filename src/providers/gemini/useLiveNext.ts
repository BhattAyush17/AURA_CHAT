import { reportAutonomyUserActivity } from "@/runtime/autonomousConversation/AutonomyEvents";
/**
 * useLiveNext — The modernized AURA voice companion hook using GeminiVoiceEngine.
 * Retains the exact same return signature as the original useLive for drop-in replacement.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useGeminiVoiceAdapter } from "../gemini-next/GeminiVoiceAdapter";
import { useTranscriptManager } from "./useTranscript";
import { usePromptOrchestrator } from "./usePromptOrchestrator";
import { useBehaviorInjection } from "./useBehaviorInjection";
import { conversationState } from "@/runtime/ConversationStateManager";
import { ConversationRuntime } from "@/runtime/conversationRuntime/ConversationRuntime";
import { RuntimeManager } from "@/runtime/RuntimeManager";
import { memoryGateway } from "@/lib/memory-gateway";
import { VoiceLanguageManager } from "@/core/voice-language/VoiceLanguageManager";
import { globalLanguageManager } from "@/core/voice-language/globalLanguageManager";
import { GeminiVoiceLanguageAdapter } from "@/providers/gemini-next/GeminiVoiceLanguageAdapter";
import { ResolvedVoiceLanguage } from "@/core/voice-language/VoiceLanguageTypes";
import { geminiTrace } from "@/runtime/diagnostics/GeminiTimingTrace";
import { traceRuntime } from "@/lib/trace-runtime";
import { getStorageManager } from "@/lib/storage/manager";
import {
  shouldShowSetupPrompt,
  incrementConversationCount,
  getConversationCount,
} from "@/lib/usage-tracker";
import { resolveUserId } from "@/lib/user-identity";
import {
  getCredential,
  clearAllCredentials,
  hasRequiredCredentials,
  hasSupabaseCredentials,
} from "@/lib/credentials";
import { isLateNightHour, getSystemPromptForPersonality } from "@/lib/gemini-prompt";

import { generateSeed } from "@/lib/utils/seed-generator";
import { saveSyncMeta } from "@/lib/sync-meta";
import { getDayWiseStore } from "@/lib/storage/DayWiseConversationStore";
import { claimPrimaryTab, isPrimaryTab, HEARTBEAT_KEY, HEARTBEAT_INTERVAL } from "./types";
import { executeAuraAction, buildMusicContext } from "@/lib/aura-actions";
import { assembleCognitiveContext } from "@/lib/aura-context";
import { browserTemporalAtmosphere } from "@/executive/AtmosphereContext";
import { musicService } from "@/music/MusicService";
import { auraTelemetry, type ProviderCall } from "@/telemetry";

import type { UIStatus, AuraAnalysis } from "./types";

export function useLive(mode: string = "adaptive", voice: string = "Zephyr") {
  const isInactive = mode === "__inactive__";
  const storageManager = getStorageManager();

  const [auraState, setAuraState] = useState<AuraAnalysis | null>(null);
  const [sessionStartTime] = useState<number>(() => Date.now());
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showCloudSyncPrompt, setShowCloudSyncPrompt] = useState(false);

  const [memories, setMemories] = useState<string[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string>("local-user");
  const isStartingRef = useRef(false);
  const skipGreetingRef = useRef(false);
  const backendAvailable = useRef(true);
  const geminiCallIdRef = useRef<string | null>(null);
  const lastGeminiUsageRef = useRef<{ prompt: number; candidate: number; total: number }>({
    prompt: 0,
    candidate: 0,
    total: 0,
  });
  const turnCounterRef = useRef(0);

  // Ensure a session exists for telemetry from the moment the hook is consumed.
  if (!auraTelemetry.getSessionId()) {
    auraTelemetry.beginSession();
  }

  // Voice Language System
  const [languageState, setLanguageState] = useState<ResolvedVoiceLanguage | null>(null);
  const languageManager = globalLanguageManager;
  const sendTextRef = useRef<((text: string) => void) | null>(null);
  // Non-triggering context channel: absorbs internal cognition into the live
  // session WITHOUT the model responding aloud to its own directives.
  const injectContextRef = useRef<((text: string) => void) | null>(null);

  useEffect(() => {
    // Register the Gemini adapter so the manager can push configuration updates.
    // Language enforcement rides the NON-TRIGGERING context channel —
    // injectContextRef is set once the voice adapter mounts, so resolve lazily.
    const adapter = new GeminiVoiceLanguageAdapter((text: string) => {
      injectContextRef.current?.(text);
    });
    languageManager.setAdapter(adapter);
  }, [languageManager]);

  useEffect(() => {
    return languageManager.subscribe((state) => {
      setLanguageState(state);
    });
  }, [languageManager]);

  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  const transcript_ = useTranscriptManager();
  const prompts = usePromptOrchestrator();
  const behavior = useBehaviorInjection();

  const handleToolCall = useCallback(async (toolCall: any) => {
    try {
      console.log(`[AURA] 🛠️ Executing Action: ${toolCall.name}`, toolCall.args);
      const result = await executeAuraAction(toolCall.name, toolCall.args || {}, {
        userId: userIdRef.current,
        emotionalTags: {},
      });
      return { result };
    } catch (e: any) {
      console.error(`[AURA] Tool ${toolCall.name} failed:`, e);
      return { error: e.message };
    }
  }, []);

  const handleTurnComplete = useCallback(
    async (userText: string, modelText: string, turnId?: string, turnNonce?: number) => {
      // Begin a per-turn request and link the running Gemini call to it.
      const telemetryTurnId = transcript_.transcriptRef.current.length
        ? `t_${transcript_.transcriptRef.current.length}`
        : undefined;
      const requestId = auraTelemetry.beginRequest({ turnId: telemetryTurnId });
      if (geminiCallIdRef.current) {
        auraTelemetry.attachCallToRequest(geminiCallIdRef.current, requestId);
      }

      if (userText) {
        const interpreted = languageManager.getState().interpretedTranscript;
        const finalInterpreted = interpreted && interpreted !== userText ? interpreted : undefined;
        const finalUserText = finalInterpreted || userText;

        transcript_.addTurn(userText, true, finalInterpreted, turnId, turnNonce);
        conversationState.reportUserFinished();

        // Synchronous Cognitive Sync: Let RuntimeManager process the turn deterministically
        // This saves memories and updates the AdaptiveCommunicationProfile within the turn lifecycle
        try {
          const lastAnalysis = behavior.lastAnalysisRef.current;
          const currentEmotionalState = {
            frustration: lastAnalysis?.frustration || 0,
            playfulness: lastAnalysis?.playfulness || 0,
            vulnerability: lastAnalysis?.vulnerability || 0,
            trust: lastAnalysis?.trust || 0,
            anxiety: lastAnalysis?.anxiety || 0,
          };

          const clientMemories = await memoryGateway.retrieveMemories(
            finalUserText,
            userIdRef.current,
            currentEmotionalState,
          );

          const cognitiveBlock = await RuntimeManager.getInstance().processCognitiveTurn(
            finalUserText,
            behavior.lastAnalysisRef.current,
            modeRef.current,
            browserTemporalAtmosphere(),
          );

          const executivePlan = RuntimeManager.getInstance().getLastExecutivePrompt();
          if (sendTextRef.current) {
            const systemDirectives = [];

            if (clientMemories && clientMemories.length > 0) {
              const memoryLines = clientMemories
                .slice(0, 5)
                .map((m) => `- ${(m.content || "").slice(0, 150)}`);
              if (memoryLines.length > 0) {
                systemDirectives.push(
                  `[SYSTEM: CONVERSATION MEMORIES]\n${memoryLines.join("\n")}\n[END MEMORY]`,
                );
              }
            }

            if (cognitiveBlock)
              systemDirectives.push(`[SYSTEM: COGNITIVE BLOCK]\n${cognitiveBlock}`);
            if (executivePlan)
              systemDirectives.push(`[SYSTEM: EXECUTIVE DIRECTIVE]\n${executivePlan}`);
            if (systemDirectives.length > 0) {
              // Injected via the non-triggering channel — the model absorbs
              // these without responding aloud. sendText here caused phantom
              // replies to AURA's own directives after every turn.
              injectContextRef.current?.(systemDirectives.join("\n\n"));
            }
          }
        } catch (e) {
          console.warn("[AURA] Cognitive turn processing failed:", e);
        }
      }
      if (modelText) {
        transcript_.addTurn(modelText, false, undefined, turnId, turnNonce);
        conversationState.reportSpeakingFinished();
      }

      // ── Memory Return Path (Bug A Rescue) ──
      const cleanUserText = userText?.trim() || "";
      const cleanModelText = modelText?.trim() || "";

      if (cleanUserText || cleanModelText) {
        const lastAnalysis = behavior.lastAnalysisRef.current;
        const currentEmotionalState: Record<string, number> = {
          frustration: lastAnalysis?.frustration || 0,
          playfulness: lastAnalysis?.playfulness || 0,
          vulnerability: lastAnalysis?.vulnerability || 0,
          trust: lastAnalysis?.trust || 0,
          anxiety: lastAnalysis?.anxiety || 0,
        };

        let turnContext = "";
        if (cleanUserText && cleanModelText) {
          turnContext = `User: ${cleanUserText}\nAURA: ${cleanModelText}`;
        } else if (cleanUserText) {
          turnContext = `User: ${cleanUserText}`;
        } else if (cleanModelText) {
          turnContext = `AURA: ${cleanModelText}`;
        }

        memoryGateway.storeMemory(
          turnContext,
          userIdRef.current,
          currentEmotionalState,
          undefined,
          sessionIdRef.current ?? undefined,
          RuntimeManager.getInstance().getLastExecutivePrompt() || undefined,
        );
      }

      musicService.onAuraSpeechEnd();
      languageManager.resetBuffer();
      auraTelemetry.endRequest(requestId, { status: "success" });
    },
    [transcript_, languageManager, behavior.lastAnalysisRef],
  );

  const handleInterruption = useCallback(
    (userText: string, modelText: string, turnId?: string, turnNonce?: number) => {
      console.log("🛑 NATIVE BARGE-IN DETECTED: Engine truncated output.");
      // Persist interrupted transcription with turn/nonce IDs for audit trail
      transcript_.addInterruptedTurn(userText, modelText, turnId, turnNonce);
      conversationState.handleUserInterruption();
    },
    [transcript_],
  );

  const adapter = useGeminiVoiceAdapter({
    onTurnComplete: handleTurnComplete,
    onToolCall: handleToolCall,
    onInterruption: handleInterruption,
    onInputTranscription: (text) => {
      // Collect conversation context to pass to the interpreter
      const lastFewTurns = transcript_.transcriptRef.current
        .slice(-3)
        .map((t) => t.text)
        .join(" ");
      const words = lastFewTurns.split(/\s+/).filter((w) => w.length > 2);

      languageManager.setRecentContext(words);

      languageManager.observe({
        text,
        source: "transcription",
        timestamp: Date.now(),
      });

      // Target 2: Buffer Asynchronous Transcript
      // If we receive late-arriving text, append it to the last active transcript_ buffer
      // to prevent losing STT that arrives after onTurnComplete.
      const currentRef = transcript_.transcriptRef.current;
      const lastMemory = currentRef.length > 0 ? currentRef[currentRef.length - 1] : null;

      if (lastMemory && lastMemory.user_initiated && Date.now() - lastMemory.timestamp < 3000) {
        // This mutates the ref without causing a React re-render, ensuring the
        // conversational context sees the late STT chunks without breaking hooks.
        if (!lastMemory.text.endsWith(text.trim())) {
          lastMemory.text += (lastMemory.text ? " " : "") + text.trim();
        }
      }
    },
    onAuraSpeechStart: () => {
      musicService.onAuraSpeechStart();
    },
    onUserSpeechDetected: () => {
      reportAutonomyUserActivity();
      musicService.onUserSpeechStart();
      // New turn starting - notify language manager of new turn nonce
      turnCounterRef.current += 1;
      languageManager.setTurnNonce(turnCounterRef.current);
    },
    onUsageMetadata: (meta) => {
      if (!geminiCallIdRef.current) return;
      const prompt = Number(meta?.promptTokenCount ?? 0);
      const candidate = Number(meta?.candidatesTokenCount ?? 0);
      const total = Number(meta?.totalTokenCount ?? prompt + candidate);
      const last = lastGeminiUsageRef.current;
      // Gemini reports cumulative token counts over the live session. We
      // surface the latest cumulative figures; the store tracks deltas so
      // the session total never double-counts.
      lastGeminiUsageRef.current = { prompt, candidate, total };
      auraTelemetry.updateProviderCallUsage(geminiCallIdRef.current, {
        inputTokens: prompt,
        outputTokens: candidate,
        inputSource: prompt > 0 ? "REPORTED" : "UNAVAILABLE",
        outputSource: candidate > 0 ? "REPORTED" : "UNAVAILABLE",
      });
      // Best-effort throttled sanity log.
      if (typeof window !== "undefined") {
        (window as unknown as { __auraLastGeminiUsage?: unknown }).__auraLastGeminiUsage = {
          prompt,
          candidate,
          total,
          ts: Date.now(),
        };
      }
    },
  });

  useEffect(() => {
    sendTextRef.current = adapter.sendText;
    injectContextRef.current = adapter.injectContext;
  }, [adapter.sendText, adapter.injectContext]);

  // Start Session
  const startSession = useCallback(async () => {
    if (adapter.status !== "idle" && adapter.status !== "error") return;
    if (isStartingRef.current) return;
    isStartingRef.current = true;

    console.log("[AURA] 🎙️ Starting session via GeminiVoiceEngine...");
    const userId = await resolveUserId(getCredential("supabase_user_email") || undefined);
    userIdRef.current = userId;
    storageManager.setUserId(userId);
    auraTelemetry.setUserId(userId);

    if (!hasRequiredCredentials()) {
      setShowSettingsModal(true);
      isStartingRef.current = false;
      return;
    }

    if (isLateNightHour() && modeRef.current === "adaptive") {
      modeRef.current = "latenight";
    }

    // transcript_.reset(); // Removed to preserve history across sessions
    sessionIdRef.current = crypto.randomUUID();

    // Build the full personality system instruction (same canonical source as OpenRouter/Sarvam).
    // This is the complete AURA persona + mode contract delivered once at connection.
    const systemInstructionBase = getSystemPromptForPersonality(
      modeRef.current,
      prompts.seedRef.current.content || undefined,
    );

    // Fetch the cognitive snapshot (memory + mode contract block) with a safe timeout.
    // voice availability > personalization, so we never block connection on this.
    let initialCognitiveSnapshot = "";
    try {
      initialCognitiveSnapshot = await Promise.race([
        RuntimeManager.getInstance().buildInitialCognitiveSnapshot(
          userId,
          modeRef.current,
          browserTemporalAtmosphere(),
        ),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("Cognitive snapshot timeout")), 1500),
        ),
      ]);
    } catch (e) {
      console.warn(
        "[AURA] Cognitive snapshot unavailable/timed out. Falling back to base instruction.",
      );
    }

    // Combine base persona with the dynamic cognitive snapshot and any active music context
    const musicCtx = buildMusicContext();
    let systemInstruction = initialCognitiveSnapshot
      ? `${systemInstructionBase}\n\n${initialCognitiveSnapshot}`
      : systemInstructionBase;

    // ── Day-wise context restoration: carry past conversations into the
    // fresh Gemini session (its live context resets per connection). The
    // block holds older-day summaries + a recent-turns digest. Fail-open. ──
    try {
      const restored = getDayWiseStore().restoreContext();
      if (restored.summaries.length > 0 || restored.recentTurns.length > 0) {
        systemInstruction += `\n\n${getDayWiseStore().buildContextBlock(restored)}`;
      }
    } catch {
      // fail-open: context restoration must never block the connection
    }

    if (musicCtx) {
      systemInstruction += `\n\n${musicCtx}`;
    }

    // Surface the music context block to the diagnostics panel as a token
    // estimate (clearly labeled ESTIMATED — not a provider-reported count).
    auraTelemetry.setMusicContext({
      musicAvailable: !!musicCtx,
      contextChars: musicCtx.length,
      estimatedTokens: Math.max(1, Math.round(musicCtx.length / 4)),
      tokenSource: "ESTIMATED",
      lastBuiltAt: Date.now(),
      nowPlaying: null,
      playbackState: "",
    });

    // Tools list can be dynamic based on capabilities
    const tools: any[] = [];
    // We would map actual tools here if required.

    // Begin a long-running provider call for the live session. Each turn
    // begins a new TelemetryRequest that attaches to this same call id.
    lastGeminiUsageRef.current = { prompt: 0, candidate: 0, total: 0 };
    geminiCallIdRef.current = auraTelemetry.beginProviderCall({
      provider: "gemini",
      model: "models/gemini-3.1-flash-live-preview",
      kind: "PRIMARY",
      audio: true,
    });

    try {
      await adapter.startSession(systemInstruction, tools, voiceRef.current);
    } catch (e) {
      if (geminiCallIdRef.current) {
        auraTelemetry.endProviderCall(geminiCallIdRef.current, {
          status: "error",
          failureCode: "engine_start_failed",
          failureDetail: String((e as Error)?.message || e),
        });
        geminiCallIdRef.current = null;
      }
      throw e;
    }

    musicService.onMicActive();

    if (adapter.engine && !skipGreetingRef.current) {
      // Let engine finish setup — only greet on the first session, not on config restarts
      setTimeout(() => {
        if (adapter.engine?.getState() === "CONNECTED") {
          adapter.sendText(prompts.getGreeting(modeRef.current));
        }
      }, 500);
    }
    skipGreetingRef.current = false;

    isStartingRef.current = false;
  }, [adapter, storageManager, prompts, transcript_]);

  // End Session
  const endSession = useCallback(async () => {
    await adapter.endSession();
    if (geminiCallIdRef.current) {
      const last = lastGeminiUsageRef.current;
      auraTelemetry.endProviderCall(geminiCallIdRef.current, {
        status: "success",
        usage: {
          inputTokens: last.prompt,
          outputTokens: last.candidate,
          inputSource: last.prompt > 0 ? "REPORTED" : "UNAVAILABLE",
          outputSource: last.candidate > 0 ? "REPORTED" : "UNAVAILABLE",
        },
      });
      geminiCallIdRef.current = null;
    }
    sessionIdRef.current = null;
    isStartingRef.current = false;
    musicService.onAuraSpeechEnd();
  }, [adapter]);

  useEffect(() => {
    if (isInactive && adapter.status !== "idle") {
      void endSession();
    }
  }, [isInactive, adapter.status, endSession]);

  return {
    getSessionId: () => sessionIdRef.current,
    deliverAutonomous: adapter.requestAutonomousResponse,
    cancelAutonomous: adapter.cancelAutonomousResponse,
    status: adapter.status as UIStatus,
    isSpeaking: adapter.isSpeaking,
    isThinking: adapter.isThinking,
    words: adapter.words,
    volume: 0, // Migrated to direct analyser
    isActiveVoice: adapter.status === "listening",
    auraState,
    memories,
    lastError: adapter.lastError,
    warning: null,
    showSettingsModal,
    setShowSettingsModal,
    showCloudSyncPrompt,
    setShowCloudSyncPrompt,
    getInputFrequencyData: adapter.getInputFrequencyData,
    getOutputFrequencyData: adapter.getOutputFrequencyData,
    startSession,
    endSession,
    updateConfig: useCallback(
      (newVoice?: string, newMode?: string) => {
        if (newVoice) {
          voiceRef.current = newVoice;
        }
        if (newMode) {
          modeRef.current = newMode;
        }
        if (adapter.status !== "idle" && (newVoice || newMode)) {
          skipGreetingRef.current = true;
          endSession().then(() => setTimeout(() => startSession(), 300));
        }
      },
      [adapter, endSession, startSession],
    ),
    backendAvailable,
    updateVoice: (newVoice: string) => {
      voiceRef.current = newVoice;
      if (adapter.status !== "idle") {
        skipGreetingRef.current = true;
        endSession().then(() => setTimeout(() => startSession(), 300));
      }
    },
    liveStats: { language: "Unknown" },
    languageState: languageState || undefined,
    readinessSnapshot: adapter.readinessSnapshot,
  };
}
