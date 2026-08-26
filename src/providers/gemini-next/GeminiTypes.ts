import type { MilestoneId } from "./SessionReadinessManager";

export type GeminiSessionState =
  | "IDLE"
  | "CONNECTING"
  | "CONNECTED"
  | "DISCONNECTING"
  | "CLOSED"
  | "ERROR";

export interface VoiceEngineConfig {
  apiKey: string;
  model: string;
  voice: string;
  language?: string;
  systemInstruction?: string;
}

export interface VoiceEngineEvents {
  onStateChange?: (state: GeminiSessionState) => void;
  onModelText?: (text: string) => void;
  onInputTranscription?: (text: string) => void;
  onAudioChunkReceived?: (base64Data: string) => void;
  onTurnComplete?: () => void;
  onInterrupted?: () => void;
  onToolCall?: (functionCalls: any[]) => Promise<any[]>;
  onError?: (error: Error | string) => void;
  onUsageMetadata?: (meta: any) => void;
  onMilestone?: (id: MilestoneId, status: "in_progress" | "complete" | "failed", error?: string) => void;
  onGoAway?: () => void;
}

export interface VoiceTelemetry {
  lastInputSendAt: number;
  lastServerMessageAt: number;
  lastResponseAudioAt: number;
  lastTurnCompleteAt: number;
  lastErrorAt: number;
  isCapturing: boolean;
  isPlaying: boolean;
}
