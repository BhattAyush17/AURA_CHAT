/**
 * Core types for the Provider-Agnostic Voice Language System.
 */

export interface VoiceLanguageObservation {
  text?: string;
  language?: string;
  secondaryLanguage?: string;
  confidence?: number;
  source: "provider" | "transcription" | "heuristic" | "unknown";
  isPartial?: boolean;
  timestamp: number;
}

export interface VoiceSpeechProfile {
  language: string;
  variant: "en-US" | "en-IN" | "en-GB" | "en-AU" | "unknown";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" | null;
  vocabularyHints?: string[];
  pronunciationHints?: string[];
  source: "user" | "provider" | "resolver" | "unknown";
}

export interface ResolvedVoiceLanguage {
  preferredLanguage: string;
  detectedLanguage: string | null;
  secondaryLanguage: string | null;
  dominantLanguage: string | null;
  classification: "SINGLE_LANGUAGE" | "MIXED_LANGUAGE" | "UNCERTAIN";
  confidence: number | null;
  responseLanguage: string;
  speechProfile?: VoiceSpeechProfile;
  interpretedTranscript?: string;
  source: "provider" | "resolver" | "preferred" | "unknown";
  stable: boolean;
  updatedAt: number;
}

export interface VoiceLanguageProviderAdapter {
  capabilities: {
    nativeLanguageDetection: boolean;
    nativeLanguageMetadata: boolean;
    dynamicResponseLanguage: boolean;
    sessionResponseLanguageUpdate: boolean;
  };

  /**
   * Applies the determined response language to the provider.
   * If the provider natively handles language mapping (like Gemini 3.1 Flash),
   * this may be a no-op or purely for tracking.
   */
  applyResponseLanguage(language: string): Promise<void> | void;

  /**
   * Optional: Exposes native metadata if the provider supports it.
   */
  getDetectedLanguage?(): string | null;
}

export interface VoiceSpeechProfileAdapter {
  capabilities: {
    acceptsSpeechProfile: boolean;
    nativeAccentMetadata: boolean;
    nativeLanguageMetadata: boolean;
  };

  applySpeechProfile?(profile: VoiceSpeechProfile): void | Promise<void>;
}
