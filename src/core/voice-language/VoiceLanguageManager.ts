import { VoiceLanguageObservation, ResolvedVoiceLanguage, VoiceLanguageProviderAdapter } from "./VoiceLanguageTypes";
import { VoiceLanguageResolver } from "./VoiceLanguageResolver";
import { VoiceLanguagePolicy } from "./VoiceLanguagePolicy";
import { VoiceSpeechProfileManager } from "./VoiceSpeechProfile";
import { VoiceSpeechInterpreter } from "./VoiceSpeechInterpreter";
import { AdaptiveCommunicationAnalyzer } from "../../runtime/language/AdaptiveCommunicationAnalyzer";

export class VoiceLanguageManager {
  private resolver: VoiceLanguageResolver;
  private policy: VoiceLanguagePolicy;
  private profileManager: VoiceSpeechProfileManager;
  private interpreter: VoiceSpeechInterpreter;
  private state: ResolvedVoiceLanguage;
  private adapter: VoiceLanguageProviderAdapter | null = null;
  private listeners: Set<(state: ResolvedVoiceLanguage) => void> = new Set();
  private recentContext: string[] = [];
  private unsubscribeAdaptive: (() => void) | null = null;

  constructor(preferredLanguage: string) {
    this.resolver = new VoiceLanguageResolver();
    this.policy = new VoiceLanguagePolicy();
    this.profileManager = new VoiceSpeechProfileManager();
    this.interpreter = new VoiceSpeechInterpreter();
    this.state = {
      preferredLanguage,
      detectedLanguage: null,
      secondaryLanguage: null,
      dominantLanguage: null,
      classification: "UNCERTAIN",
      confidence: null,
      responseLanguage: preferredLanguage,
      source: "unknown",
      stable: false,
      updatedAt: Date.now(),
    };

    // Subscribe to global adaptive communication profile
    this.unsubscribeAdaptive = AdaptiveCommunicationAnalyzer.getInstance().subscribe((adaptiveProfile) => {
      // Only react if confidence is high (meaning stable preference)
      if (adaptiveProfile.overallConfidence > 0.6) {
        if (adaptiveProfile.language.primary === "hindi" && adaptiveProfile.language.hindiRatio > 0.8) {
          // Soft-shift response hint if user is solidly in Hindi
          if (this.state.responseLanguage !== "hindi") {
            const newResponseLanguage = this.policy.determineResponseLanguage({
              ...this.state,
              detectedLanguage: "hindi",
            }, this.state.responseLanguage);
            this.updateState({ responseLanguage: newResponseLanguage });
          }
        }
      }
    });
  }

  public setAdapter(adapter: VoiceLanguageProviderAdapter) {
    this.adapter = adapter;
    this.applyCurrentResponseLanguage();
  }

  public setPreferredLanguage(preferredLanguage: string) {
    this.state.preferredLanguage = preferredLanguage;
    // Re-evaluate response language with new preferred language
    const newResponseLanguage = this.policy.determineResponseLanguage(this.state, this.state.responseLanguage);
    this.updateState({ responseLanguage: newResponseLanguage });
  }

  public setSpeechPreference(pref: "Automatic" | "en-US" | "en-IN" | "en-GB" | "en-AU") {
    this.profileManager.setPreference(pref);
    this.updateState({ speechProfile: this.profileManager.resolveProfile(this.state) });
  }

  public setRecentContext(context: string[]) {
    this.recentContext = context;
  }

  public observe(observation: VoiceLanguageObservation) {
    const resolvedPartial = this.resolver.resolve(observation, this.state.preferredLanguage, this.state);
    
    // Combine to get new base state
    const newStateBase = {
      ...this.state,
      ...resolvedPartial
    };

    // Determine speech profile
    const profile = this.profileManager.resolveProfile(newStateBase);
    
    // Interpret the transcript if text exists
    let interpreted = undefined;
    if (observation.text) {
      interpreted = this.interpreter.interpret(observation.text, profile, this.recentContext);
    }

    // Determine final response language
    const newResponseLanguage = this.policy.determineResponseLanguage(newStateBase, this.state.responseLanguage);

    this.updateState({
      ...resolvedPartial,
      responseLanguage: newResponseLanguage,
      speechProfile: profile,
      interpretedTranscript: interpreted,
    });
  }

  public resetBuffer() {
    this.resolver.reset();
  }

  public reset() {
    this.resolver.reset();
    this.updateState({
      detectedLanguage: null,
      secondaryLanguage: null,
      dominantLanguage: null,
      classification: "UNCERTAIN",
      confidence: null,
      responseLanguage: this.state.preferredLanguage,
      speechProfile: this.profileManager.resolveProfile(this.state),
      interpretedTranscript: undefined,
      source: "unknown",
      stable: false,
    });
  }

  public getState(): ResolvedVoiceLanguage {
    return this.state;
  }

  public subscribe(listener: (state: ResolvedVoiceLanguage) => void): () => void {
    this.listeners.add(listener);
    // Emit current state immediately
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
      // Clean up adaptive subscription if this is the last UI listener (optional lifecycle management)
      if (this.listeners.size === 0 && this.unsubscribeAdaptive) {
         // Keep adaptive sub alive globally since VoiceLanguageManager is a singleton/long-lived
      }
    };
  }

  private updateState(updates: Partial<ResolvedVoiceLanguage>) {
    let hasChanged = false;
    for (const key of Object.keys(updates) as Array<keyof ResolvedVoiceLanguage>) {
      if (this.state[key] !== updates[key]) {
        hasChanged = true;
        break;
      }
    }

    if (!hasChanged) return;

    const previousResponseLanguage = this.state.responseLanguage;

    this.state = {
      ...this.state,
      ...updates,
      updatedAt: Date.now(),
    };

    if (this.state.responseLanguage !== previousResponseLanguage) {
      this.applyCurrentResponseLanguage();
    }

    this.notifyListeners();
  }

  private applyCurrentResponseLanguage() {
    if (this.adapter) {
      try {
        void this.adapter.applyResponseLanguage(this.state.responseLanguage);
      } catch (e) {
        console.error("[VoiceLanguageManager] Error applying response language to adapter:", e);
      }
    }
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.state));
  }
}
