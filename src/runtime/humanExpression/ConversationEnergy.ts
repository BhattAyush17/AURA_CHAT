export class ConversationEnergy {
  // Low, Calm, Medium, High, Passionate
  public evaluate(userText: string, state: string): string {
    if (state === "Debate") return "High";
    if (state === "Emotional support") return "Low";
    if (state === "Teaching") return "Calm";
    if (userText.includes("!") && userText.length < 30) return "Passionate";
    if (userText.length > 80) return "Medium";
    return "Calm";
  }
}
