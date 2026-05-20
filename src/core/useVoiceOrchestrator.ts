import { useMemo } from "react";
import { useGeminiLive as useLive } from "@/providers/gemini/useLive";
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
    };
  }, [provider, gemini, openrouter, sarvam, geminiActive, openrouterActive, sarvamActive]);

  return activePipeline;
}
