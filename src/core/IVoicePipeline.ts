import type { ReadinessSnapshot } from "@/providers/gemini-next/SessionReadinessManager";

export type UIStatus =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error"
  | "connecting"
  | "connected"
  | "disconnecting";

export interface IVoicePipeline {
  providerName: "gemini" | "openrouter" | "sarvam";
  status: UIStatus | string;
  isThinking: boolean;
  isSpeaking?: boolean;
  isActiveVoice?: boolean;
  lastError: string | null;
  warning?: string | null;
  words?: string;

  // Session Controls
  startSession: (isUserInitiated?: boolean) => Promise<void> | void;
  endSession: () => Promise<void> | void;
  updateConfig?: (newVoice?: string, newMode?: string) => void;

  // Real-time Audio Visuals
  getInputFrequencyData: () => Uint8Array;
  getOutputFrequencyData: () => Uint8Array;

  // Global Modals/State (primarily passed through by Gemini)
  backendAvailable?: React.MutableRefObject<boolean>;
  showSettingsModal?: boolean;
  setShowSettingsModal?: (val: boolean) => void;
  showCloudSyncPrompt?: boolean;
  setShowCloudSyncPrompt?: (val: boolean) => void;

  // Provider-specific extended UI state
  activeModel?: string;
  auraState?: any;
  liveStats?: { tone: string; intent: string };
  languageState?: {
    preferredLanguage: string;
    detectedLanguage: string | null;
    secondaryLanguage: string | null;
    classification: "SINGLE_LANGUAGE" | "MIXED_LANGUAGE" | "UNCERTAIN";
    responseLanguage: string;
    speechProfile?: {
      language: string;
      variant: string;
      confidence: number | null;
      source: string;
    };
    interpretedTranscript?: string;
  };

  // Gemini readiness tracking
  readinessSnapshot?: ReadinessSnapshot | null;
}

