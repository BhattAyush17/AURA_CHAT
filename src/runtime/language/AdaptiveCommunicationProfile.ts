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

export interface AdaptiveCommunicationProfile {
  language: AdaptiveLanguageProfile;
  tone: AdaptiveToneProfile;
  style: AdaptiveStyleProfile;
  speech: AdaptiveSpeechProfile;
  preferences: AdaptivePreferences;
  profileMaturity: number; // 0 to 1
}

export const INITIAL_ADAPTIVE_PROFILE: AdaptiveCommunicationProfile = {
  language: {
    primary: "unknown",
    englishRatio: 0.5,
    hindiRatio: 0.5,
    codeSwitching: 0.5,
    confidence: 0,
  },
  tone: {
    casual: 0.5,
    formal: 0.5,
    playful: 0.5,
    serious: 0.5,
    direct: 0.5,
    expressive: 0.5,
  },
  style: {
    verbosity: "moderate",
    complexity: "moderate",
    register: "casual",
    technicality: 0.5,
  },
  speech: {
    pace: 0.5,
    pausePattern: 0.5,
    turnTaking: 0.5,
  },
  preferences: {
    preferredResponseLanguage: "adaptive",
    mirrorCodeSwitching: true,
    mirrorTone: true,
    mirrorRegister: true,
  },
  profileMaturity: 0,
};
