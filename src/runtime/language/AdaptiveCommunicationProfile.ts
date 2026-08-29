export interface AdaptiveLanguageProfile {
  primary: string;
  englishRatio: number;
  hindiRatio: number;
  codeSwitching: number; // 0 (pure) to 1 (heavy switching)
  confidence: number;
}


export interface AdaptiveToneProfile {
  casual: number;
  formal: number;
  playful: number;
  serious: number;
  direct: number;
  expressive: number;
}

export interface AdaptiveStyleProfile {
  verbosity: "concise" | "moderate" | "elaborate";
  complexity: "simple" | "moderate" | "complex";
  register: "casual" | "professional" | "academic" | "intimate";
  technicality: number; // 0 to 1
}

export interface AdaptiveSpeechProfile {
  pace: number; // 0 (slow) to 1 (fast)
  pausePattern: number;
  turnTaking: number;
}

export interface AdaptivePreferences {
  preferredResponseLanguage: "adaptive" | "english" | "hindi" | "hinglish";
  mirrorCodeSwitching: boolean;
  mirrorTone: boolean;
  mirrorRegister: boolean;
}

export interface EpistemicBelief<T> {
  value: T;
  confidence: number; // 0 to 1
  stability: number; // 0 to 1, indicates variance
  evidenceCount: number;
  recentEvidenceCount: number; // Tracked via short-term EMA
  contradictoryEvidenceCount: number;
  lastObserved: number;
  firstObserved: number;
  state: "KNOWN" | "INFERRED" | "UNCERTAIN" | "RECENTLY_CHANGED" | "CONFLICTING";
  source?: "explicit" | "inferred";
  variance?: number;
}

export interface AdaptiveCommunicationProfile {
  schemaVersion: number;
  totalTurnsAnalyzed: number;
  totalConversationsAnalyzed: number;
  lastConversationId: string | null;

  // Longitudinal Epistemic Beliefs
  explicitFacts: EpistemicBelief<string>[];
  explicitPreferences: EpistemicBelief<string>[];
  tendencies: Record<string, EpistemicBelief<any>>; // generic tendencies
  goals: EpistemicBelief<string>[];
  interests: EpistemicBelief<string>[];

  // Communication-specific longitudinal profile (Adaptive Traits)
  language: EpistemicBelief<AdaptiveLanguageProfile>;
  contextualLanguage: {
    technical: EpistemicBelief<AdaptiveLanguageProfile>;
    casual: EpistemicBelief<AdaptiveLanguageProfile>;
  };
  tone: EpistemicBelief<AdaptiveToneProfile>;
  style: EpistemicBelief<AdaptiveStyleProfile>;
  speech: EpistemicBelief<AdaptiveSpeechProfile>;
  preferences: EpistemicBelief<AdaptivePreferences>;
  
  profileMaturity: number; // 0 to 1
}

const DEFAULT_LANGUAGE_PROFILE: AdaptiveLanguageProfile = {
  primary: "unknown",
  englishRatio: 0.5,
  hindiRatio: 0.5,
  codeSwitching: 0.5,
  confidence: 0,
};

export function createInitialBelief<T>(value: T, source: "explicit" | "inferred" = "inferred"): EpistemicBelief<T> {
  return {
    value,
    confidence: 0,
    stability: 0,
    evidenceCount: 0,
    recentEvidenceCount: 0,
    contradictoryEvidenceCount: 0,
    lastObserved: 0,
    firstObserved: 0,
    state: "UNCERTAIN",
    source
  };
}

export const INITIAL_ADAPTIVE_PROFILE: AdaptiveCommunicationProfile = {
  schemaVersion: 3,
  totalTurnsAnalyzed: 0,
  totalConversationsAnalyzed: 0,
  lastConversationId: null,
  explicitFacts: [],
  explicitPreferences: [],
  tendencies: {},
  goals: [],
  interests: [],
  language: createInitialBelief({ ...DEFAULT_LANGUAGE_PROFILE }),
  contextualLanguage: {
    technical: createInitialBelief({ ...DEFAULT_LANGUAGE_PROFILE }),
    casual: createInitialBelief({ ...DEFAULT_LANGUAGE_PROFILE }),
  },
  tone: createInitialBelief({
    casual: 0.5,
    formal: 0.5,
    playful: 0.5,
    serious: 0.5,
    direct: 0.5,
    expressive: 0.5,
  }),
  style: createInitialBelief({
    verbosity: "moderate",
    complexity: "moderate",
    register: "casual",
    technicality: 0.5,
  }),
  speech: createInitialBelief({
    pace: 0.5,
    pausePattern: 0.5,
    turnTaking: 0.5,
  }),
  preferences: createInitialBelief({
    preferredResponseLanguage: "adaptive",
    mirrorCodeSwitching: true,
    mirrorTone: true,
    mirrorRegister: true,
  }),
  profileMaturity: 0,
};
