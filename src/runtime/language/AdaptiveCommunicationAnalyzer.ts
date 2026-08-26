import {
  AdaptiveCommunicationProfile,
  INITIAL_ADAPTIVE_PROFILE,
  AdaptiveLanguageProfile,
  AdaptiveToneProfile,
  AdaptiveStyleProfile,
} from "./AdaptiveCommunicationProfile";
import { LanguageDistributionAnalyzer } from "./LanguageDistributionAnalyzer";
import { BehaviorAnalysis } from "@/lib/behavior-client";

export interface AdaptiveObservation {
  userText: string;
  backendBehavior: BehaviorAnalysis | null;
  audioMetrics?: {
    rms?: number;
    pauseMs?: number;
    turnDuration?: number;
  };
}

export class AdaptiveCommunicationAnalyzer {
  private static instance: AdaptiveCommunicationAnalyzer;

  private profile: AdaptiveCommunicationProfile;
  private history: AdaptiveObservation[] = [];
  private languageAnalyzer = new LanguageDistributionAnalyzer();
  private subscribers: Set<(profile: AdaptiveCommunicationProfile) => void> = new Set();

  private constructor() {
    this.profile = JSON.parse(JSON.stringify(INITIAL_ADAPTIVE_PROFILE));
  }

  public static getInstance(): AdaptiveCommunicationAnalyzer {
    if (!AdaptiveCommunicationAnalyzer.instance) {
      AdaptiveCommunicationAnalyzer.instance = new AdaptiveCommunicationAnalyzer();
    }
    return AdaptiveCommunicationAnalyzer.instance;
  }

  public getProfile(): AdaptiveCommunicationProfile {
    return this.profile;
  }

  public subscribe(listener: (profile: AdaptiveCommunicationProfile) => void): () => void {
    this.subscribers.add(listener);
    listener(this.profile); // Emit immediately
    return () => this.subscribers.delete(listener);
  }

  private notify() {
    this.subscribers.forEach((l) => l(this.profile));
  }

  /**
   * Main entry point for observations.
   * MUST be run asynchronously by the caller to avoid blocking TTFB.
   */
  public observe(observation: AdaptiveObservation) {
    if (!observation.userText.trim()) return;

    this.history.push(observation);
    // Keep a rolling history of the last 10 exchanges for stability vs recency
    if (this.history.length > 10) {
      this.history.shift();
    }

    this.recalculateProfile();
  }

  private recalculateProfile() {
    if (this.history.length === 0) return;

    // Weight: Recent turn matters more, but historical builds stability.
    // E.g., Exchange 1: 100% recent
    // Exchange 3: 40% recent, 60% historical
    const recencyWeight = Math.max(0.3, 1.0 - this.history.length * 0.1);
    const historicalWeight = 1.0 - recencyWeight;

    // Analyze current (last) observation
    const currentObs = this.history[this.history.length - 1];
    const currentLanguage = this.analyzeLanguage(currentObs.userText);
    const currentTone = this.analyzeTone(currentObs);
    const currentStyle = this.analyzeStyle(currentObs);

    if (this.history.length === 1) {
      this.profile.language = currentLanguage;
      this.profile.tone = currentTone;
      this.profile.style = currentStyle;
    } else {
      // Calculate Historical Averages (excluding the current one)
      const historicalLanguage = this.calculateHistoricalLanguage();
      const historicalTone = this.calculateHistoricalTone();

      this.profile.language = this.blendLanguage(
        historicalLanguage,
        currentLanguage,
        historicalWeight,
        recencyWeight
      );
      this.profile.tone = this.blendTone(historicalTone, currentTone, historicalWeight, recencyWeight);
      
      // Style is more categorical, prefer recent if strong, else historical
      this.profile.style = this.history.length > 3 && currentObs.userText.length < 15 
        ? this.profile.style // Don't shift style aggressively on short utterances
        : currentStyle; 
    }

    // Maturity: Scales linearly for first 3 exchanges (e.g. 0.33 -> 0.66 -> 0.99)
    this.profile.profileMaturity = Math.min(1.0, this.history.length * 0.33);

    // Determine preferences
    this.profile.preferences = this.determinePreferences(this.profile.language);

    this.notify();
  }

  private analyzeLanguage(text: string): AdaptiveLanguageProfile {
    const { hindiTokens, englishTokens, devanagariTokens } = this.languageAnalyzer.analyze(text);
    const total = hindiTokens + englishTokens;

    if (total === 0) return { ...INITIAL_ADAPTIVE_PROFILE.language };

    const englishRatio = englishTokens / total;
    const hindiRatio = hindiTokens / total;

    let primary = "unknown";
    if (hindiRatio > 0.8) primary = "hindi";
    else if (englishRatio > 0.8) primary = "english";
    else primary = "hinglish";

    // Code switching happens when both languages are used meaningfully in a single utterance
    let codeSwitching = 0;
    if (hindiTokens > 0 && englishTokens > 0) {
      const minTokens = Math.min(hindiTokens, englishTokens);
      codeSwitching = Math.min(1.0, (minTokens / total) * 2); 
    }

    return {
      primary,
      englishRatio,
      hindiRatio,
      codeSwitching,
      confidence: Math.min(1.0, total * 0.1), // more words = higher confidence
    };
  }

  private calculateHistoricalLanguage(): AdaptiveLanguageProfile {
    let totalEng = 0, totalHin = 0, totalCS = 0;
    const historyToConsider = this.history.slice(0, -1);
    
    if (historyToConsider.length === 0) return INITIAL_ADAPTIVE_PROFILE.language;

    historyToConsider.forEach(obs => {
      const lang = this.analyzeLanguage(obs.userText);
      totalEng += lang.englishRatio;
      totalHin += lang.hindiRatio;
      totalCS += lang.codeSwitching;
    });

    const len = historyToConsider.length;
    return {
      primary: totalEng > totalHin ? "english" : "hindi", // Rough guess, will be overridden by blend
      englishRatio: totalEng / len,
      hindiRatio: totalHin / len,
      codeSwitching: totalCS / len,
      confidence: 1.0, // Used internally
    };
  }

  private blendLanguage(
    hist: AdaptiveLanguageProfile,
    cur: AdaptiveLanguageProfile,
    wHist: number,
    wCur: number
  ): AdaptiveLanguageProfile {
    const englishRatio = hist.englishRatio * wHist + cur.englishRatio * wCur;
    const hindiRatio = hist.hindiRatio * wHist + cur.hindiRatio * wCur;
    const codeSwitching = hist.codeSwitching * wHist + cur.codeSwitching * wCur;

    let primary = "unknown";
    if (hindiRatio > 0.7) primary = "hindi";
    else if (englishRatio > 0.7) primary = "english";
    else primary = "hinglish";

    return {
      primary,
      englishRatio,
      hindiRatio,
      codeSwitching,
      confidence: Math.min(1.0, hist.confidence * wHist + cur.confidence * wCur),
    };
  }

  private analyzeTone(obs: AdaptiveObservation): AdaptiveToneProfile {
    // Map backend intelligence (if available) to tone
    const baseTone = { ...INITIAL_ADAPTIVE_PROFILE.tone };
    if (!obs.backendBehavior) return baseTone;

    const state = (obs.backendBehavior.emotional_state || "").toLowerCase();
    const act = (obs.backendBehavior.act || "").toLowerCase();

    if (state.includes("casual") || act.includes("chat")) baseTone.casual = 0.8;
    if (state.includes("formal") || act.includes("explain")) baseTone.formal = 0.8;
    if (state.includes("playful") || state.includes("fun")) baseTone.playful = 0.8;
    if (state.includes("serious") || state.includes("frustrat")) baseTone.serious = 0.8;
    if (act.includes("direct") || act.includes("answer")) baseTone.direct = 0.8;

    return baseTone;
  }

  private calculateHistoricalTone(): AdaptiveToneProfile {
    let t = { casual: 0, formal: 0, playful: 0, serious: 0, direct: 0, expressive: 0 };
    const hist = this.history.slice(0, -1);
    if (hist.length === 0) return { ...INITIAL_ADAPTIVE_PROFILE.tone };

    hist.forEach(obs => {
      const tone = this.analyzeTone(obs);
      t.casual += tone.casual;
      t.formal += tone.formal;
      t.playful += tone.playful;
      t.serious += tone.serious;
      t.direct += tone.direct;
      t.expressive += tone.expressive;
    });

    const len = hist.length;
    return {
      casual: t.casual / len,
      formal: t.formal / len,
      playful: t.playful / len,
      serious: t.serious / len,
      direct: t.direct / len,
      expressive: t.expressive / len,
    };
  }

  private blendTone(hist: AdaptiveToneProfile, cur: AdaptiveToneProfile, wHist: number, wCur: number): AdaptiveToneProfile {
    return {
      casual: hist.casual * wHist + cur.casual * wCur,
      formal: hist.formal * wHist + cur.formal * wCur,
      playful: hist.playful * wHist + cur.playful * wCur,
      serious: hist.serious * wHist + cur.serious * wCur,
      direct: hist.direct * wHist + cur.direct * wCur,
      expressive: hist.expressive * wHist + cur.expressive * wCur,
    };
  }

  private analyzeStyle(obs: AdaptiveObservation): AdaptiveStyleProfile {
    const text = obs.userText.trim();
    const words = text.split(/\\s+/).length;
    
    let verbosity: "concise" | "moderate" | "elaborate" = "moderate";
    if (words <= 3) verbosity = "concise";
    else if (words > 20) verbosity = "elaborate";

    let technicality = 0.2;
    if (text.match(/(function|api|code|server|database|query|react|architecture)/i)) {
      technicality = 0.8;
    }

    return {
      verbosity,
      complexity: technicality > 0.6 ? "complex" : "moderate",
      register: technicality > 0.6 ? "professional" : "casual",
      technicality,
    };
  }

  private determinePreferences(language: AdaptiveLanguageProfile) {
    let prefResponse = "adaptive";
    if (language.primary === "hindi" && language.codeSwitching < 0.2) prefResponse = "hindi";
    else if (language.primary === "english" && language.codeSwitching < 0.2) prefResponse = "english";
    else if (language.primary === "hinglish" || language.codeSwitching >= 0.2) prefResponse = "hinglish";

    return {
      preferredResponseLanguage: prefResponse as "adaptive" | "english" | "hindi" | "hinglish",
      mirrorCodeSwitching: true,
      mirrorTone: true,
      mirrorRegister: true,
    };
  }

  public clearSession() {
    this.history = [];
    this.profile = JSON.parse(JSON.stringify(INITIAL_ADAPTIVE_PROFILE));
    this.notify();
  }
}
