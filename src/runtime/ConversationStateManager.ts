export type ConversationState =
  | "IDLE"
  | "LISTENING"
  | "USER_SPEAKING"
  | "USER_FINISHED"
  | "THINKING"
  | "AURA_SPEAKING"
  | "POST_SPEECH_GRACE"
  | "ERROR";

type StateListener = (state: ConversationState) => void;

export class ConversationStateManager {
  private static instance: ConversationStateManager;
  private state: ConversationState = "IDLE";
  private listeners: Set<StateListener> = new Set();

  // Guard against duplicate/overlapping sessions
  private sttActive = false;
  private ttsActive = false;

  private constructor() {}

  public static getInstance(): ConversationStateManager {
    if (!ConversationStateManager.instance) {
      ConversationStateManager.instance = new ConversationStateManager();
    }
    return ConversationStateManager.instance;
  }

  public getState(): ConversationState {
    return this.state;
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    // Send immediate initial state
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private transitionTo(newState: ConversationState, context?: string) {
    if (this.state === newState) return;

    console.log(`[${new Date().toISOString()}] ${newState}${context ? ` (${context})` : ""}`);
    this.state = newState;
    this.listeners.forEach((l) => l(this.state));
  }

  // --- External Transition Requests ---

  public requestStartListening(): boolean {
    if (this.state === "AURA_SPEAKING" || this.ttsActive) {
      console.warn("[ConversationStateManager] Blocked STT start: AURA is currently speaking.");
      return false;
    }
    if (this.state === "POST_SPEECH_GRACE") {
      console.warn("[ConversationStateManager] Blocked STT start: In post-speech grace period.");
      return false;
    }
    if (this.sttActive) {
      console.warn("[ConversationStateManager] Blocked STT start: STT is already active.");
      return false;
    }

    this.sttActive = true;
    this.transitionTo("LISTENING");
    return true;
  }

  public reportUserSpeaking() {
    if (this.state === "LISTENING") {
      this.transitionTo("USER_SPEAKING");
    }
  }

  public reportUserFinished() {
    if (this.state === "USER_SPEAKING" || this.state === "LISTENING") {
      this.sttActive = false;
      this.transitionTo("USER_FINISHED");
      this.transitionTo("THINKING");
    }
  }

  public requestStartSpeaking(): boolean {
    if (this.state === "AURA_SPEAKING" && this.ttsActive) {
      return true; // Already speaking
    }

    // Stop STT if it's running (Interruption)
    this.sttActive = false;
    this.ttsActive = true;
    this.transitionTo("AURA_SPEAKING");
    return true;
  }

  public reportSpeakingFinished() {
    // Total function: also accepts THINKING so a turn that produced no
    // audible output (e.g. audio modality dropped) can never leave the
    // conversation permanently stuck in THINKING.
    if (this.state === "AURA_SPEAKING" || this.state === "THINKING") {
      this.ttsActive = false;
      this.transitionTo("POST_SPEECH_GRACE");

      // Post-speech grace period 250ms
      setTimeout(() => {
        if (this.state === "POST_SPEECH_GRACE") {
          this.transitionTo("IDLE");
        }
      }, 250);
    }
  }

  public handleUserInterruption() {
    if (this.state === "AURA_SPEAKING" || this.state === "POST_SPEECH_GRACE") {
      console.log(`[${new Date().toISOString()}] USER_INTERRUPTION`);
      this.ttsActive = false;
      this.sttActive = true;
      this.transitionTo("LISTENING", "Interruption");
    }
  }

  public forceIdle() {
    this.sttActive = false;
    this.ttsActive = false;
    this.transitionTo("IDLE");
  }

  public reportError() {
    this.sttActive = false;
    this.ttsActive = false;
    this.transitionTo("ERROR");
  }
}

export const conversationState = ConversationStateManager.getInstance();
