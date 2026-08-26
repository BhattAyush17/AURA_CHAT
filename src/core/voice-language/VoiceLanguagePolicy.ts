import { ResolvedVoiceLanguage } from "./VoiceLanguageTypes";

export class VoiceLanguagePolicy {
  /**
   * Determines the final response language that AURA should use.
   * Priority:
   * 1. Stable dominant language for mixed speech
   * 2. Stable detected language
   * 3. Existing response language (if currently uncertain)
   * 4. Preferred language
   */
  public determineResponseLanguage(
    resolvedState: Omit<ResolvedVoiceLanguage, "responseLanguage">,
    previousResponseLanguage: string
  ): string {
    if (resolvedState.classification === "UNCERTAIN") {
      return previousResponseLanguage || resolvedState.preferredLanguage;
    }

    if (resolvedState.classification === "MIXED_LANGUAGE" && resolvedState.stable && resolvedState.dominantLanguage) {
      return resolvedState.dominantLanguage;
    }

    if (resolvedState.classification === "SINGLE_LANGUAGE" && resolvedState.stable && resolvedState.detectedLanguage) {
      return resolvedState.detectedLanguage;
    }

    return resolvedState.preferredLanguage;
  }
}
