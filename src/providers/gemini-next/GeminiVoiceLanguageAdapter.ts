import { VoiceLanguageProviderAdapter, VoiceSpeechProfileAdapter, VoiceSpeechProfile } from "@/core/voice-language/VoiceLanguageTypes";

export class GeminiVoiceLanguageAdapter implements VoiceLanguageProviderAdapter, VoiceSpeechProfileAdapter {
  public capabilities = {
    nativeLanguageDetection: false, 
    nativeLanguageMetadata: false,
    dynamicResponseLanguage: true, // Natively supported by the multimodal model matching audio
    sessionResponseLanguageUpdate: false, // We do not want to force session restarts
    acceptsSpeechProfile: true,
    nativeAccentMetadata: false,
  };

  /**
   * Gemini 3.1 Flash natively handles responding in the spoken language.
   * Injecting text controls like `sendText("Respond in Hindi")` will contaminate the context
   * and cause verbal hallucination. Therefore, applying the response language for Gemini
   * is a no-op that relies on the model's native multimodal capabilities.
   */
  public applyResponseLanguage(language: string): void {
    // No-op for Gemini Live. The model natively adapts to the audio stream.
    // If a future version of the API supports a silent system context injection,
    // it would be implemented here.
    console.log(`[GeminiVoiceLanguageAdapter] AURA mapped response language to: ${language}. Deferring to Gemini's native audio adaptation.`);
  }

  public applySpeechProfile(profile: VoiceSpeechProfile): void {
    // We log it, but we do not inject conversational text to prevent audio-path pollution.
    console.debug(`[GeminiVoiceLanguageAdapter] Applied Speech Profile: ${profile.variant} (confidence: ${profile.confidence})`);
  }
}
