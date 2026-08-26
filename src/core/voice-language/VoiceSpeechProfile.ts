import { VoiceSpeechProfile, VoiceSpeechProfileAdapter, VoiceLanguageObservation, ResolvedVoiceLanguage } from "./VoiceLanguageTypes";

export class VoiceSpeechProfileManager {
  private currentProfile: VoiceSpeechProfile = {
    language: "en",
    variant: "unknown",
    confidence: null,
    source: "unknown",
  };
  
  private userPreference: "Automatic" | "en-US" | "en-IN" | "en-GB" | "en-AU" = "Automatic";

  public setPreference(pref: "Automatic" | "en-US" | "en-IN" | "en-GB" | "en-AU") {
    this.userPreference = pref;
  }

  public resolveProfile(state: ResolvedVoiceLanguage): VoiceSpeechProfile {
    // If the language is not English, variant falls back to unknown (or can be extended later).
    if (state.detectedLanguage !== "English" && state.dominantLanguage !== "English") {
      return {
        ...this.currentProfile,
        language: state.detectedLanguage || "unknown",
        variant: "unknown",
        confidence: "UNKNOWN",
        source: "resolver"
      };
    }

    if (this.userPreference !== "Automatic") {
      return {
        language: "English",
        variant: this.userPreference,
        confidence: "HIGH",
        source: "user"
      };
    }

    // Default automatic detection (conservative)
    return {
      ...this.currentProfile,
      confidence: "UNKNOWN"
    };
  }
}
