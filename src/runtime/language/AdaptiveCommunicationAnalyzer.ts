import {
  AdaptiveCommunicationProfile,
  INITIAL_ADAPTIVE_PROFILE,
  AdaptiveLanguageProfile,
  AdaptiveToneProfile,
  AdaptiveStyleProfile,
  EpistemicBelief,
  createInitialBelief
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
  private history: AdaptiveObservation[] = []; // Short-term context only
  private languageAnalyzer = new LanguageDistributionAnalyzer();
  private subscribers: Set<(profile: AdaptiveCommunicationProfile) => void> = new Set();
  
  // Current-turn signal exposed for immediate overrides
  private currentTurnSignal: {
    language: AdaptiveLanguageProfile;
    context: "technical" | "casual" | "unknown";
  } | null = null;

  // Session tracking to resist conversation clustering bias
  private sessionId: string;
  private sessionTurnsAnalyzed: number = 0;
  
  private sessionAccumulator: {
    language: AdaptiveLanguageProfile[];
    casualLanguage: AdaptiveLanguageProfile[];
    technicalLanguage: AdaptiveLanguageProfile[];
    tone: AdaptiveToneProfile[];
    style: AdaptiveStyleProfile[];
    explicitPreferences: { action: string; pref: string; statement: string }[];
  } = {
    language: [],
    casualLanguage: [],
    technicalLanguage: [],
    tone: [],
    style: [],
    explicitPreferences: []
  };

  private constructor() {
    this.sessionId = crypto.randomUUID();
    this.profile = JSON.parse(JSON.stringify(INITIAL_ADAPTIVE_PROFILE));
    this.loadProfile();
  }


  private loadProfile() {
    try {
      const saved = localStorage.getItem("aura_communication_profile");
      if (saved) {
        const parsed = JSON.parse(saved);
        // Schema migration check: ensure new fields exist
        if (parsed.schemaVersion === 2) {
          this.profile = parsed;
        } else if (parsed.totalTurnsAnalyzed !== undefined && parsed.contextualLanguage) {
          // Migrate v1 to v2
          this.profile = { 
            ...INITIAL_ADAPTIVE_PROFILE, 
            ...parsed, 
            schemaVersion: 2,
            totalConversationsAnalyzed: 1, // Assume at least 1 conversation
            explicitFacts: [],
            explicitPreferences: [],
            tendencies: {},
            goals: [],
            interests: [],
          };
        } else {
          console.warn("[AdaptiveCommunicationAnalyzer] Old schema detected. Resetting to initial.");
        }

      }
    } catch (e) {
      console.warn("[AdaptiveCommunicationAnalyzer] Failed to load profile. Falling back to INITIAL_ADAPTIVE_PROFILE.", e);
    }
  }

  private saveProfile() {
    try {
      // Only save if the profile has meaningful maturity (turns > 0)
      if (this.profile.totalTurnsAnalyzed > 0) {
        localStorage.setItem("aura_communication_profile", JSON.stringify(this.profile));
      }
    } catch (e) {
      console.warn("[AdaptiveCommunicationAnalyzer] Failed to save profile", e);
    }
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
  
  public getCurrentTurnSignal() {
    return this.currentTurnSignal;
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
    if (this.history.length > 10) {
      this.history.shift();
    }

    // 1. Evaluate current turn immediately
    const text = observation.userText;
    const currentLanguage = this.analyzeLanguage(text);
    const context = this.determineContext(text, observation.backendBehavior);

    this.currentTurnSignal = {
      language: currentLanguage,
      context,
    };

    // 2. Accumulate in session if meaningful
    const isMeaningful = text.split(/\s+/).length >= 2 || currentLanguage.confidence > 0.2;
    if (isMeaningful) {
      this.profile.totalTurnsAnalyzed += 1;
      this.sessionTurnsAnalyzed += 1;
      
      this.sessionAccumulator.language.push(currentLanguage);
      if (context === "casual") this.sessionAccumulator.casualLanguage.push(currentLanguage);
      if (context === "technical") this.sessionAccumulator.technicalLanguage.push(currentLanguage);
      this.sessionAccumulator.tone.push(this.analyzeTone(observation));
      this.sessionAccumulator.style.push(this.analyzeStyle(observation));

      // Extract explicit preferences
      if (text.toLowerCase().includes("i prefer") || text.toLowerCase().includes("i like") || text.toLowerCase().includes("i want") || text.toLowerCase().includes("i don't want")) {
         const match = text.match(/i (prefer|like|want|don't want|do not want) (.*?)(?=\.|$)/i);
         if (match) {
           const action = match[1].trim().toLowerCase();
           const pref = match[2].trim().toLowerCase();
           const statement = `user ${action} ${pref}`;
           this.sessionAccumulator.explicitPreferences.push({ action, pref, statement });
         }
      }
    }
    
    // We only notify subscribers of the immediate turn signal changes.
    // The longitudinal profile is unchanged until finalizeConversation.
    this.notify();
  }

  /**
   * Finalizes the current conversation, aggregating all session observations into ONE
   * longitudinal update, applying the EMA exactly once.
   */
  public finalizeConversation() {
    if (this.sessionAccumulator.language.length === 0) {
      // Nothing to aggregate
      this.sessionId = crypto.randomUUID();
      this.sessionTurnsAnalyzed = 0;
      return;
    }

    this.profile.totalConversationsAnalyzed += 1;
    this.profile.lastConversationId = this.sessionId;

    const EMA_HALF_LIFE_CONVERSATIONS = 20;
    const alpha = 1 - Math.pow(0.5, 1 / EMA_HALF_LIFE_CONVERSATIONS); // ≈ 0.03406
    
    const effectiveEvidence = this.profile.totalConversationsAnalyzed * 3;
    this.profile.profileMaturity = this.calculateMaturity(effectiveEvidence);

    // Aggregate explicitly extracted preferences
    for (const { pref, statement } of this.sessionAccumulator.explicitPreferences) {
      const opposites: Record<string, string[]> = {
        "short answers": ["long answers", "detailed explanations", "elaborate"],
        "detailed explanations": ["short answers", "concise"],
        "hinglish": ["only english", "only hindi"],
        "english": ["hinglish"]
      };
      
      const toRemove = opposites[pref] || [];
      this.profile.explicitPreferences = this.profile.explicitPreferences.filter(b => {
        const conflict = toRemove.some(r => b.value.includes(r)) || b.value.includes(pref);
        return !conflict;
      });
      
      const belief = createInitialBelief(statement, "explicit");
      belief.confidence = 1.0;
      belief.state = "KNOWN";
      belief.evidenceCount = 1;
      belief.lastObserved = Date.now();
      this.profile.explicitPreferences.push(belief);
    }

    // Process aggregated traits
    this.profile.language = this.updateBelief(
      this.profile.language, 
      this.aggregateLanguage(this.sessionAccumulator.language), 
      alpha,
      this.blendLanguage.bind(this)
    );
    
    if (this.sessionAccumulator.technicalLanguage.length > 0) {
      this.profile.contextualLanguage.technical = this.updateBelief(
        this.profile.contextualLanguage.technical,
        this.aggregateLanguage(this.sessionAccumulator.technicalLanguage),
        alpha,
        this.blendLanguage.bind(this)
      );
    }
    
    if (this.sessionAccumulator.casualLanguage.length > 0) {
      this.profile.contextualLanguage.casual = this.updateBelief(
        this.profile.contextualLanguage.casual,
        this.aggregateLanguage(this.sessionAccumulator.casualLanguage),
        alpha,
        this.blendLanguage.bind(this)
      );
    }

    this.profile.tone = this.updateBelief(
      this.profile.tone,
      this.aggregateTone(this.sessionAccumulator.tone),
      alpha,
      this.blendTone.bind(this)
    );
    
    const currentStyle = this.aggregateStyle(this.sessionAccumulator.style);
    const prevStyle = this.profile.style.value;
    const newTech = prevStyle.technicality * (1 - alpha) + currentStyle.technicality * alpha;
    
    let newVerbosity = prevStyle.verbosity;
    let newRegister = prevStyle.register;
    if (this.profile.totalConversationsAnalyzed <= 3 || alpha > 0.15) {
      newVerbosity = currentStyle.verbosity;
      newRegister = currentStyle.register;
    }
    
    this.profile.style = this.updateBelief(
      this.profile.style,
      { ...prevStyle, technicality: newTech, verbosity: newVerbosity, register: newRegister },
      alpha,
      (hist, cur) => cur 
    );

    this.profile.preferences = this.updateBelief(
      this.profile.preferences,
      this.determinePreferences(this.profile.language.value),
      alpha,
      (hist, cur) => cur
    );

    this.saveProfile();
    this.notify();

    // Reset session
    this.sessionId = crypto.randomUUID();
    this.sessionTurnsAnalyzed = 0;
    this.sessionAccumulator = {
      language: [], casualLanguage: [], technicalLanguage: [],
      tone: [], style: [], explicitPreferences: []
    };
  }


  /**
   * Universal EpistemicBelief updater applying EMA and Change Detection.
   */
  private updateBelief<T>(
    belief: EpistemicBelief<T>,
    currentValue: T,
    currentWeight: number,
    blender: (hist: T, cur: T, wHist: number, wCur: number) => T
  ): EpistemicBelief<T> {
    const historicalWeight = 1.0 - currentWeight;
    const newValue = blender(belief.value, currentValue, historicalWeight, currentWeight);
    
    belief.evidenceCount += 1;
    belief.lastObserved = Date.now();
    if (belief.firstObserved === 0) belief.firstObserved = Date.now();
    
    // Variance: measure divergence between raw current observation and old baseline
    const varianceAlpha = 1 - Math.pow(0.5, 1 / 6); // fast EMA for variance tracking
    let divergence = 0;
    if (typeof currentValue === "object" && currentValue !== null && typeof belief.value === "object" && belief.value !== null) {
       let sum = 0, count = 0;
       for (const k of Object.keys(currentValue as object)) {
         if (typeof (currentValue as any)[k] === "number" && typeof (belief.value as any)[k] === "number") {
            sum += Math.abs((currentValue as any)[k] - (belief.value as any)[k]);
            count++;
         }
       }
       if (count > 0) divergence = sum / count;
    }
    
    // Accumulate running variance via fast EMA
    belief.variance = (belief.variance || 0) * (1 - varianceAlpha) + divergence * varianceAlpha;
    
    const isConflict = belief.variance > 0.15;
    
    // Heuristic Change Detection & State Transitions (on CONVERSATION boundary)
    if (belief.evidenceCount >= 2) {
      if (isConflict) {
        belief.state = "RECENTLY_CHANGED";
      } else if (belief.confidence > 0.8) {
        belief.state = "KNOWN";
      } else {
        belief.state = "INFERRED";
      }
    } else {
      belief.state = "UNCERTAIN";
    }
    
    belief.value = newValue;
    // Asymptotic confidence based on independent conversation evidence quantity
    const quantityConfidence = 1 - Math.exp(-belief.evidenceCount / 10);
    const consistencyConfidence = isConflict ? 0.3 : 1.0;
    
    belief.confidence = Math.min(1.0, Math.max(0.0, quantityConfidence * consistencyConfidence));
    
    // Let's refine the state based on confidence and contradictions
    if (belief.evidenceCount >= 5) {
      if (belief.confidence < 0.5 && quantityConfidence > 0.6) {
        belief.state = "CONFLICTING";
      }
    }
    
    return belief;
  }

  private aggregateLanguage(observations: AdaptiveLanguageProfile[]): AdaptiveLanguageProfile {
    if (observations.length === 0) return { ...INITIAL_ADAPTIVE_PROFILE.language.value };
    const avg = { englishRatio: 0, hindiRatio: 0, codeSwitching: 0, confidence: 0 };
    for (const obs of observations) {
      avg.englishRatio += obs.englishRatio;
      avg.hindiRatio += obs.hindiRatio;
      avg.codeSwitching += obs.codeSwitching;
      avg.confidence += obs.confidence;
    }
    const len = observations.length;
    const res = {
      primary: "unknown",
      englishRatio: avg.englishRatio / len,
      hindiRatio: avg.hindiRatio / len,
      codeSwitching: avg.codeSwitching / len,
      confidence: avg.confidence / len,
    };
    if (res.hindiRatio > 0.7) res.primary = "hindi";
    else if (res.englishRatio > 0.7) res.primary = "english";
    else res.primary = "hinglish";
    return res;
  }

  private aggregateTone(observations: AdaptiveToneProfile[]): AdaptiveToneProfile {
    if (observations.length === 0) return { ...INITIAL_ADAPTIVE_PROFILE.tone.value };
    const avg = { casual: 0, formal: 0, playful: 0, serious: 0, direct: 0, expressive: 0 };
    for (const obs of observations) {
      avg.casual += obs.casual;
      avg.formal += obs.formal;
      avg.playful += obs.playful;
      avg.serious += obs.serious;
      avg.direct += obs.direct;
      avg.expressive += obs.expressive;
    }
    const len = observations.length;
    return {
      casual: avg.casual / len,
      formal: avg.formal / len,
      playful: avg.playful / len,
      serious: avg.serious / len,
      direct: avg.direct / len,
      expressive: avg.expressive / len,
    };
  }

  private aggregateStyle(observations: AdaptiveStyleProfile[]): AdaptiveStyleProfile {
    if (observations.length === 0) return { ...INITIAL_ADAPTIVE_PROFILE.style.value };
    let techAvg = 0;
    const counts = { verbosity: {} as Record<string, number>, register: {} as Record<string, number> };
    
    for (const obs of observations) {
      techAvg += obs.technicality;
      counts.verbosity[obs.verbosity] = (counts.verbosity[obs.verbosity] || 0) + 1;
      counts.register[obs.register] = (counts.register[obs.register] || 0) + 1;
    }
    
    const len = observations.length;
    techAvg /= len;
    
    let topVerb = "moderate"; let maxV = 0;
    for (const [k, v] of Object.entries(counts.verbosity)) { if (v > maxV) { maxV = v; topVerb = k; } }
    
    let topReg = "casual"; let maxR = 0;
    for (const [k, v] of Object.entries(counts.register)) { if (v > maxR) { maxR = v; topReg = k; } }
    
    return {
      verbosity: topVerb as any,
      complexity: techAvg > 0.6 ? "complex" : "moderate",
      register: topReg as any,
      technicality: techAvg,
    };
  }

  private calculateMaturity(effectiveEvidence: number): number {
    if (effectiveEvidence === 0) return 0.0;
    // Sigmoid-like smooth curve. 
    // Uses effectiveEvidence (conversations * 3 + bounded turns)
    const maturity = 1 - Math.exp(-effectiveEvidence / 10);
    return Math.min(1.0, Math.max(0.0, maturity));
  }


  private determineContext(text: string, behavior: BehaviorAnalysis | null): "technical" | "casual" | "unknown" {
    let techScore = 0;
    if (text.match(/(function|api|code|server|database|query|react|architecture|system|deploy|error|bug|test)/i)) {
      techScore += 0.6;
    }
    if (behavior?.act?.includes("explain") || behavior?.act?.includes("troubleshoot")) {
      techScore += 0.4;
    }
    
    if (techScore >= 0.5) return "technical";
    
    if (behavior?.emotional_state?.includes("casual") || behavior?.act?.includes("chat") || text.length < 15) {
      return "casual";
    }
    
    return "unknown";
  }

  private analyzeLanguage(text: string): AdaptiveLanguageProfile {
    const { hindiTokens, englishTokens, devanagariTokens } = this.languageAnalyzer.analyze(text);
    const total = hindiTokens + englishTokens;

    if (total === 0) return { ...INITIAL_ADAPTIVE_PROFILE.language.value };

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
      codeSwitching = Math.min(1.0, (minTokens / total) * 2.5); // Boosted slightly to capture realistic switching
    }

    return {
      primary,
      englishRatio,
      hindiRatio,
      codeSwitching,
      confidence: Math.min(1.0, total * 0.1), // more words = higher confidence
    };
  }

  private blendLanguage(
    hist: AdaptiveLanguageProfile,
    cur: AdaptiveLanguageProfile,
    wHist: number,
    wCur: number
  ): AdaptiveLanguageProfile {
    // If the current utterance is very short, its confidence is low, so we reduce its weight in the blend
    const effectiveCurWeight = wCur * cur.confidence;
    const effectiveHistWeight = 1.0 - effectiveCurWeight;

    const englishRatio = hist.englishRatio * effectiveHistWeight + cur.englishRatio * effectiveCurWeight;
    const hindiRatio = hist.hindiRatio * effectiveHistWeight + cur.hindiRatio * effectiveCurWeight;
    const codeSwitching = hist.codeSwitching * effectiveHistWeight + cur.codeSwitching * effectiveCurWeight;

    let primary = "unknown";
    if (hindiRatio > 0.7) primary = "hindi";
    else if (englishRatio > 0.7) primary = "english";
    else primary = "hinglish";

    return {
      primary,
      englishRatio,
      hindiRatio,
      codeSwitching,
      confidence: Math.min(1.0, hist.confidence * effectiveHistWeight + cur.confidence * effectiveCurWeight),
    };
  }

  private analyzeTone(obs: AdaptiveObservation): AdaptiveToneProfile {
    const baseTone = { ...INITIAL_ADAPTIVE_PROFILE.tone.value };
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
    const words = text.split(/\s+/).length;
    
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
    this.finalizeConversation();
    this.history = [];
    // notify after clear
    this.notify();
  }

}
