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
import { getCredential, clearAllCredentials, hasRequiredCredentials, hasSupabaseCredentials } from "@/lib/credentials";
import { isLateNightHour } from "@/lib/gemini-prompt";
import { generateSeed } from "@/lib/utils/seed-generator";
import { saveSyncMeta } from "@/lib/sync-meta";
import { claimPrimaryTab, isPrimaryTab, HEARTBEAT_KEY, HEARTBEAT_INTERVAL } from "./types";
import { executeAuraAction } from "@/lib/aura-actions";
import { assembleCognitiveContext } from "@/lib/aura-context";

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
  const backendAvailable = useRef(true);
  
  // Voice Language System
  const [languageState, setLanguageState] = useState<ResolvedVoiceLanguage | null>(null);
  const languageManager = globalLanguageManager;

  useEffect(() => {
    // Register the Gemini adapter so the manager can push configuration updates
    const adapter = new GeminiVoiceLanguageAdapter();
    languageManager.setAdapter(adapter);
  }, [languageManager]);

  useEffect(() => {
    return languageManager.subscribe((state) => {
      setLanguageState(state);
    });
  }, [languageManager]);

  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const voiceRef = useRef(voice);
  useEffect(() => { voiceRef.current = voice; }, [voice]);

  const transcript_ = useTranscriptManager();
  const prompts = usePromptOrchestrator();
  const behavior = useBehaviorInjection();

  const handleToolCall = useCallback(async (toolCall: any) => {
    try {
      console.log(`[AURA] 🛠️ Executing Action: ${toolCall.name}`, toolCall.args);
      const result = await executeAuraAction(toolCall.name, toolCall.args || {}, {
        userId: userIdRef.current,
        emotionalTags: {}
      });
      return { result };
    } catch (e: any) {
      console.error(`[AURA] Tool ${toolCall.name} failed:`, e);
      return { error: e.message };
    }
  }, []);

  const handleTurnComplete = useCallback((userText: string, modelText: string) => {
    if (userText) {
      const interpreted = languageManager.getState().interpretedTranscript;
      const finalInterpreted = interpreted && interpreted !== userText ? interpreted : undefined;
      const finalUserText = finalInterpreted || userText;
      
      transcript_.addTurn(userText, true, finalInterpreted);
      ConversationRuntime.getInstance().registerUserTurn(finalUserText);
      conversationState.reportUserFinished();
      
      // Async Cognitive Sync: Let RuntimeManager process the turn in the background
      // This saves memories and updates the AdaptiveCommunicationProfile without blocking TTFB
      setTimeout(() => {
        RuntimeManager.getInstance().processCognitiveTurn(finalUserText, behavior.lastAnalysisRef.current).catch(e => {
          console.warn("[AURA] Async cognitive turn processing failed:", e);
        });
      }, 0);
    }
    if (modelText) {
      transcript_.addTurn(modelText, false);
      conversationState.reportSpeakingFinished();
    }
    languageManager.resetBuffer();
  }, [transcript_, languageManager]);

  const handleInterruption = useCallback(() => {
    console.log("🛑 NATIVE BARGE-IN DETECTED: Engine truncated output.");
    conversationState.handleUserInterruption();
  }, []);

  const adapter = useGeminiVoiceAdapter({
    onTurnComplete: handleTurnComplete,
    onToolCall: handleToolCall,
    onInterruption: handleInterruption,
    onInputTranscription: (text) => {
      // Collect conversation context to pass to the interpreter
      const lastFewTurns = transcript_.transcriptRef.current.slice(-3).map(t => t.text).join(" ");
      const words = lastFewTurns.split(/\s+/).filter(w => w.length > 2);
      
      languageManager.setRecentContext(words);
      
      languageManager.observe({
        text,
        source: "transcription",
        timestamp: Date.now()
      });
    }
  });

  // Start Session
  const startSession = useCallback(async () => {
    if (adapter.status !== "idle" && adapter.status !== "error") return;
    if (isStartingRef.current) return;
    isStartingRef.current = true;

    console.log("[AURA] 🎙️ Starting session via GeminiVoiceEngine...");
    const userId = await resolveUserId(getCredential("supabase_user_email") || undefined);
    userIdRef.current = userId;
    storageManager.setUserId(userId);
    
    if (!hasRequiredCredentials()) {
      setShowSettingsModal(true);
      isStartingRef.current = false;
      return;
    }

    if (isLateNightHour() && modeRef.current === "adaptive") {
      modeRef.current = "latenight";
    }

    transcript_.reset();
    sessionIdRef.current = crypto.randomUUID();

    const systemInstructionBase = prompts.getGreeting(modeRef.current);
    
    // Fetch snapshot with a safe timeout (voice availability > personalization)
    let initialCognitiveSnapshot = "";
    try {
      initialCognitiveSnapshot = await Promise.race([
        RuntimeManager.getInstance().buildInitialCognitiveSnapshot(userId),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Cognitive snapshot timeout")), 1500))
      ]);
    } catch (e) {
      console.warn("[AURA] Cognitive snapshot unavailable/timed out. Falling back to base instruction.");
    }
    
    // Combine base persona with the dynamic cognitive snapshot
    const systemInstruction = initialCognitiveSnapshot 
      ? `${systemInstructionBase}\n\n${initialCognitiveSnapshot}`
      : systemInstructionBase;
    
    // Tools list can be dynamic based on capabilities
    const tools: any[] = []; 
    // We would map actual tools here if required.

    await adapter.startSession(systemInstruction, tools, voiceRef.current);
    
    if (adapter.engine) {
      // Let engine finish setup
      setTimeout(() => {
        if (adapter.engine?.getState() === "CONNECTED") {
          adapter.sendText(prompts.getGreeting(modeRef.current));
        }
      }, 500);
    }
    
    isStartingRef.current = false;
  }, [adapter, storageManager, prompts, transcript_]);

  // End Session
  const endSession = useCallback(async () => {
    await adapter.endSession();
    sessionIdRef.current = null;
    isStartingRef.current = false;
  }, [adapter]);

  useEffect(() => {
    if (isInactive && adapter.status !== "idle") {
      void endSession();
    }
  }, [isInactive, adapter.status, endSession]);

  return {
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
    updateConfig: useCallback((newVoice?: string, newMode?: string) => {
      if (newVoice) {
        voiceRef.current = newVoice;
      }
      if (newMode) {
        modeRef.current = newMode;
      }
      if (adapter.status !== "idle" && (newVoice || newMode)) {
        endSession().then(() => setTimeout(() => startSession(), 300));
      }
    }, [adapter, endSession, startSession]),
    backendAvailable,
    updateVoice: (newVoice: string) => {
      voiceRef.current = newVoice;
      if (adapter.status !== "idle") {
        endSession().then(() => setTimeout(() => startSession(), 300));
      }
    },
    liveStats: { language: "Unknown" },
    languageState: languageState || undefined,
    readinessSnapshot: adapter.readinessSnapshot,
  };
}
