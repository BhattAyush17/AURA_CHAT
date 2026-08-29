import { UserModel, INITIAL_USER_MODEL, Tendency } from "./UserModel";
import { AdaptiveCommunicationProfile } from "../language/AdaptiveCommunicationProfile";
import { BehaviorAnalysis } from "@/lib/behavior-client";

export class UserModelManager {
  private static instance: UserModelManager;
  private model: UserModel;
  private sessionId: string;
  private sessionTurns = 0;

  private constructor() {
    this.model = JSON.parse(JSON.stringify(INITIAL_USER_MODEL));
    this.sessionId = crypto.randomUUID();
    this.loadModel();
  }

  public static getInstance(): UserModelManager {
    if (!UserModelManager.instance) {
      UserModelManager.instance = new UserModelManager();
    }
    return UserModelManager.instance;
  }

  private loadModel() {
    try {
      const saved = localStorage.getItem("aura_user_model");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.schemaVersion === 1) {
          this.model = { ...INITIAL_USER_MODEL, ...parsed };
        } else {
          // Migration logic would go here
          this.model = { ...INITIAL_USER_MODEL, ...parsed, schemaVersion: 1 };
        }
      }
    } catch (e) {
      console.warn("[UserModelManager] Failed to load model. Falling back to INITIAL_USER_MODEL.", e);
    }
  }

  private saveModel() {
    try {
      localStorage.setItem("aura_user_model", JSON.stringify(this.model));
    } catch (e) {
      console.warn("[UserModelManager] Failed to save model", e);
    }
  }

  public getModel(): UserModel {
    return this.model;
  }

  public clearSession() {
    this.sessionId = crypto.randomUUID();
    this.sessionTurns = 0;
  }

  public updateCommunicationProfile(profile: AdaptiveCommunicationProfile, isNewConversation: boolean) {
    this.model.communicationProfile = profile;
    if (isNewConversation) {
      this.model.totalConversations++;
    }
    this.saveModel();
  }

  /**
   * Extends the model with new observations from behavior/text.
   */
  public observeTurn(text: string, behavior: BehaviorAnalysis | null, context: string, isMeaningful: boolean) {
    if (!isMeaningful) return;

    this.model.totalObservations++;
    this.sessionTurns++;
    
    if (this.model.lastConversationId !== this.sessionId) {
      this.model.lastConversationId = this.sessionId;
      this.model.totalConversations++;
    }

    // Extract explicit facts, preferences (simplistic regex for now, or based on backend tags)
    // The memoryGateway already extracts stableFacts, but we can capture explicit preferences if flagged by behavior
    if (text.toLowerCase().includes("i prefer") || text.toLowerCase().includes("i like")) {
       // Just a simple heuristic for demonstration. Real implementation might use LLM extraction
       const match = text.match(/i (prefer|like) (.*?)(?=\.|$)/i);
       if (match) {
         const pref = match[2].trim();
         if (!this.model.explicitPreferences.includes(pref)) {
           this.model.explicitPreferences.push(pref);
         }
       }
    }

    this.saveModel();
  }

  public calculateStability(tendency: Tendency, currentSessionId: string): number {
    // Stability increases with evidenceCount and distinct conversations
    // We assume if it's observed across multiple conversations, stability is higher.
    const conversationsSpan = this.model.totalConversations > 0 ? this.model.totalConversations : 1;
    // ... complex logic based on contexts and timestamps
    return Math.min(1.0, tendency.evidenceCount / 20.0);
  }
}
