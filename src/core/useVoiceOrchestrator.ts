import { useMemo, useEffect, useRef } from "react";
import { useLive } from "@/providers/gemini/useLiveNext";
import { useOpenRouter } from "@/providers/openrouter/useProvider";
import { useSarvam } from "@/providers/sarvam/useSarvam";
import { IVoicePipeline } from "./IVoicePipeline";

export type ActiveProvider = "gemini" | "openrouter" | "sarvam";

/**
 * Null-safe pipeline stub — returned by inactive hooks when they are not
 * supposed to run. Prevents resource allocation (AudioContext, mic, WS).
 */
const EMPTY_FREQ = new Uint8Array(32);
const noopPipeline: IVoicePipeline = {
  providerName: "gemini",
  status: "idle",
  isThinking: false,
  isSpeaking: false,
  isActiveVoice: false,
  lastError: null,
  words: "",
  startSession: async () => {},
  endSession: () => {},
  getInputFrequencyData: () => EMPTY_FREQ,
  getOutputFrequencyData: () => EMPTY_FREQ,
};

export function useVoiceOrchestrator(
  provider: ActiveProvider,
  mode: string = "adaptive",
  voice: string = "Zephyr",
): IVoicePipeline {
  // Initialize the unified Adaptive Runtime precisely once when the Orchestrator mounts.
  useEffect(() => {
    import("@/runtime/RuntimeManager").then(({ RuntimeManager }) => {
      RuntimeManager.getInstance().initialize();
    });
  }, []);

  // ── Only the ACTIVE provider's hook runs with real arguments. ──
  // Inactive hooks receive a sentinel that tells them to skip all
  // resource-heavy initialization (mic, AudioContext, brain sub-hooks).
  // React's rules-of-hooks are satisfied because we always call all 3.
  const geminiActive = provider === "gemini";
  const openrouterActive = provider === "openrouter";
  const sarvamActive = provider === "sarvam";

  const gemini = useLive(geminiActive ? mode : "__inactive__", geminiActive ? voice : "Zephyr");
  const openrouter = useOpenRouter(openrouterActive ? mode : "__inactive__");
  const sarvam = useSarvam(sarvamActive ? mode : "__inactive__", sarvamActive ? voice : "Puck");

  const activePipeline: IVoicePipeline = useMemo(() => {
    if (sarvamActive) {
      return {
        providerName: "sarvam",
        status: sarvam.status,
        isThinking: sarvam.isThinking,
        isSpeaking: sarvam.status === "speaking",
        isActiveVoice: sarvam.status === "listening",
        lastError: sarvam.lastError,
        words: sarvam.words,
        startSession: sarvam.startSession,
        endSession: sarvam.endSession,
        getInputFrequencyData: sarvam.getInputFrequencyData,
        getOutputFrequencyData: sarvam.getOutputFrequencyData,
        updateConfig: () => {},
        activeModel: sarvam.activeModel,
        liveStats: sarvam.liveStats,
      };
    }

    if (openrouterActive) {
      return {
        providerName: "openrouter",
        status: openrouter.status,
        isThinking: openrouter.isThinking,
        isSpeaking: openrouter.status === "speaking",
        isActiveVoice: openrouter.status === "listening",
        lastError: openrouter.lastError,
        words: openrouter.words,
        startSession: openrouter.startSession,
        endSession: openrouter.endSession,
        getInputFrequencyData: openrouter.getInputFrequencyData,
        getOutputFrequencyData: openrouter.getOutputFrequencyData,
        updateConfig: () => {},
        activeModel: openrouter.activeModel,
        liveStats: openrouter.liveStats,
      };
    }

    // Default: Gemini
    return {
      providerName: "gemini",
      status: gemini.status,
      isThinking: gemini.isThinking,
      isSpeaking: gemini.isSpeaking,
      isActiveVoice: gemini.isActiveVoice,
      lastError: gemini.lastError,
      words: gemini.words,
      warning: gemini.warning,
      showSettingsModal: gemini.showSettingsModal,
      setShowSettingsModal: gemini.setShowSettingsModal,
      showCloudSyncPrompt: gemini.showCloudSyncPrompt,
      setShowCloudSyncPrompt: gemini.setShowCloudSyncPrompt,
      backendAvailable: gemini.backendAvailable,
      startSession: gemini.startSession,
      endSession: gemini.endSession,
      updateConfig: gemini.updateConfig,
      getInputFrequencyData: gemini.getInputFrequencyData,
      getOutputFrequencyData: gemini.getOutputFrequencyData,
      auraState: gemini.auraState,
      readinessSnapshot: gemini.readinessSnapshot,
    };
  }, [provider, gemini, openrouter, sarvam, geminiActive, openrouterActive, sarvamActive]);

  const pipelineRef = useRef<IVoicePipeline>(activePipeline);
  useEffect(() => {
    pipelineRef.current = activePipeline;
  }, [activePipeline]);

  const wrappedPipeline: IVoicePipeline = useMemo(() => {
    return {
      ...activePipeline,
      startSession: async () => {
        await activePipeline.startSession();
        import("@/runtime/RuntimeManager").then(({ RuntimeManager }) => {
          RuntimeManager.getInstance().getLifecycleManager().startSession(
            (text) => console.log("[AURA Idle Warning]", text),
            () => pipelineRef.current.endSession(),
            () => ({
              isSpeaking: pipelineRef.current.isSpeaking,
              isThinking: pipelineRef.current.isThinking,
              isActiveVoice: pipelineRef.current.isActiveVoice,
              status: pipelineRef.current.status
            })
          );
        });
      },
      endSession: () => {
        activePipeline.endSession();
        import("@/runtime/RuntimeManager").then(({ RuntimeManager }) => {
          RuntimeManager.getInstance().getLifecycleManager().dispose();
        });
      }
    };
  }, [activePipeline.startSession, activePipeline.endSession]);

  const previousProviderRef = useRef(provider);
  const previousVoiceRef = useRef(voice);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    const isActive = activePipeline.status !== "idle" && activePipeline.status !== "error";
    const providerChanged = previousProviderRef.current !== provider;
    const voiceChanged = previousVoiceRef.current !== voice;

    if (providerChanged || voiceChanged) {
      if (wasActiveRef.current) {
        console.log(`[AURA] Seamless handoff: ${providerChanged ? 'provider' : 'voice'} changed while active`);
        wrappedPipeline.endSession();
        
        // Wait briefly for teardown, then automatically start the new session
        setTimeout(() => {
          wrappedPipeline.startSession();
        }, 500);
      }
      previousProviderRef.current = provider;
      previousVoiceRef.current = voice;
    }
    
    if (isActive) {
      wasActiveRef.current = true;
    } else if (!providerChanged && !voiceChanged) {
      wasActiveRef.current = false;
    }
  }, [provider, voice, activePipeline.status, wrappedPipeline]);

  return wrappedPipeline;
}
