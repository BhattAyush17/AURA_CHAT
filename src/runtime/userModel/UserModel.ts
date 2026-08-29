import { AdaptiveCommunicationProfile, EpistemicBelief } from "../language/AdaptiveCommunicationProfile";

export interface EvidenceObservation {
  value: any;
  confidence: number;
  timestamp: number;
  context: string;
}


export interface UserModel {
  schemaVersion: number;
  totalObservations: number;
  totalConversations: number;
  lastConversationId: string | null;

  explicitFacts: EpistemicBelief<string>[];
  explicitPreferences: EpistemicBelief<string>[];
  
  tendencies: Record<string, EpistemicBelief<any>>; // keyed by trait
  
  contextualPatterns: Record<string, any>;
  
  communicationProfile: AdaptiveCommunicationProfile | null;
  
  goals: EpistemicBelief<string>[];
  interests: EpistemicBelief<string>[];
}

export const INITIAL_USER_MODEL: UserModel = {
  schemaVersion: 1,
  totalObservations: 0,
  totalConversations: 0,
  lastConversationId: null,
  explicitFacts: [],
  explicitPreferences: [],
  tendencies: {},
  contextualPatterns: {},
  communicationProfile: null,
  goals: [],
  interests: [],
};
