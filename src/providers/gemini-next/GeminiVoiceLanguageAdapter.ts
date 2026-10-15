import {
  VoiceLanguageProviderAdapter,
  VoiceSpeechProfileAdapter,
  VoiceSpeechProfile,
} from "@/core/voice-language/VoiceLanguageTypes";

export class GeminiVoiceLanguageAdapter
  implements VoiceLanguageProviderAdapter, VoiceSpeechProfileAdapter
{
  public capabilities = {
    nativeLanguageDetection: false,
    nativeLanguageMetadata: false,
    dynamicResponseLanguage: true, // Natively supported by the multimodal model matching audio
    sessionResponseLanguageUpdate: false, // We do not want to force session restarts
    acceptsSpeechProfile: true,
    nativeAccentMetadata: false,
  };

  private lastEnforcedLanguage: string | null = null;
  private lastTurnNonce: number = 0;
  private sendEnforcement: ((text: string) => void) | null = null;

  constructor(sendEnforcement?: (text: string) => void) {
    this.sendEnforcement = sendEnforcement ?? null;
  }

  private languageLabel(language: string): string {
    switch (language) {
      case "hindi":
        return "Hindi";
      case "english":
        return "English";
      case "hinglish":
        return "Hinglish";
      default:
        return language;
    }
  }

  /**
   * Gemini Live has no mid-session system-instruction update, so single-language
   * enforcement is sent through the same [SYSTEM:] directive channel already used
   * for memories/cognitive/executive directives. This prevents bilingual semantic
   * duplication (Hindi question → Hindi + English answers).
   * Enforcement fires when the language changes or on a new turn (nonce increment).
   */
  public applyResponseLanguage(language: string, turnNonce?: number): void {
    if (turnNonce !== undefined && turnNonce !== this.lastTurnNonce) {
      this.lastTurnNonce = turnNonce;
      this.lastEnforcedLanguage = null; // Reset on new turn to allow re-enforcement
    }

    if (language === this.lastEnforcedLanguage) {
      return; // Already enforced for this language
    }

    this.lastEnforcedLanguage = language;

    if (!this.sendEnforcement) {
      console.warn(
        `[GeminiVoiceLanguageAdapter] No enforcement channel — cannot enforce response language: ${language}`,
      );
      return;
    }

    const label = this.languageLabel(language);
    const directive = `[SYSTEM: RESPONSE LANGUAGE]\nRespond ONLY in ${label} for this answer. Do not translate or restate your answer in any other language. One language per answer.`;
    try {
      this.sendEnforcement(directive);
      console.log(
        `[GeminiVoiceLanguageAdapter] Enforcing single-language response: ${label} (turnNonce: ${turnNonce ?? "N/A"})`,
      );
    } catch (e) {
      console.error("[GeminiVoiceLanguageAdapter] Failed to send language enforcement:", e);
    }
  }

  public applySpeechProfile(profile: VoiceSpeechProfile): void {
    // We log it, but we do not inject conversational text to prevent audio-path pollution.
    console.debug(
      `[GeminiVoiceLanguageAdapter] Applied Speech Profile: ${profile.variant} (confidence: ${profile.confidence})`,
    );
  }
}
