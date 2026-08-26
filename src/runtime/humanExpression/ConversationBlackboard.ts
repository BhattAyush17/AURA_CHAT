export interface BlackboardState {
  presence: string;
  temperature: string;
  energy: string;
  initiative: string;
  curiosity: string;
  thinkingStyle: string;
  listeningStyle: string;
}

export class ConversationBlackboard {
  private state: BlackboardState = {
    presence: "Natural",
    temperature: "Neutral",
    energy: "Medium",
    initiative: "Listening",
    curiosity: "Surface",
    thinkingStyle: "Practical",
    listeningStyle: "Quietly Observant"
  };

  public update(newState: Partial<BlackboardState>) {
    this.state = { ...this.state, ...newState };
  }
  
  public getState() { return this.state; }
}
