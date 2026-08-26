export class InitiativeEngine {
  // Listening, Responding, Sharing, Leading, Teaching
  public evaluate(intent: string, state: string): string {
    if (state === "Teaching") return "Teaching";
    if (intent === "Thinking aloud") return "Listening";
    if (intent === "Seeking advice") return "Leading";
    if (state === "Casual chatting" && Math.random() > 0.7) return "Sharing"; // Spontaneous initiative
    return "Responding";
  }
}
