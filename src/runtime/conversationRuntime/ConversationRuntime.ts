export type ConversationInteractionPolicy = "Observe" | "Interact" | "Wait" | "Clarify";

export interface ConversationState {
  turnCount: number;
  momentum: "Fast" | "Normal" | "Reflective" | "Deep";
  confidence: number;
  lastInteractionMs: number;
  policy: ConversationInteractionPolicy;
}

export class ConversationRuntime {
  private static instance: ConversationRuntime;
  
  private state: ConversationState = {
    turnCount: 0,
    momentum: "Normal",
    confidence: 1.0,
    lastInteractionMs: performance.now(),
    policy: "Interact"
  };

  private constructor() {}

  public static getInstance(): ConversationRuntime {
    if (!ConversationRuntime.instance) {
      ConversationRuntime.instance = new ConversationRuntime();
    }
    return ConversationRuntime.instance;
  }

  public registerUserTurn(text: string) {
    this.state.turnCount++;
    this.state.lastInteractionMs = performance.now();
    
    // Simple momentum tracking for now
    if (text.length < 10) {
      this.state.momentum = "Fast";
    } else if (text.length > 100) {
      this.state.momentum = "Deep";
    } else {
      this.state.momentum = "Normal";
    }
  }

  public reset() {
    this.state = {
      turnCount: 0,
      momentum: "Normal",
      confidence: 1.0,
      lastInteractionMs: performance.now(),
      policy: "Interact"
    };
  }

  public getState(): Readonly<ConversationState> {
    return Object.freeze({ ...this.state });
  }
}
