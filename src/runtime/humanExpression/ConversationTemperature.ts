export class ConversationTemperature {
  // Cold, Neutral, Warm, Excited, Heavy, Playful, Quiet
  public evaluate(userText: string, intent: string): string {
    const ltext = userText.toLowerCase();
    if (intent === "Processing emotions") return "Heavy";
    if (ltext.includes("haha") || ltext.includes("lol") || ltext.includes("joke")) return "Playful";
    if (ltext.includes("angry") || ltext.includes("mad")) return "Neutral"; // Don't match anger, stay grounded
    if (ltext.includes("love") || ltext.includes("happy")) return "Warm";
    if (ltext.includes("amazing") || ltext.includes("wow")) return "Excited";
    if (intent === "Thinking aloud") return "Quiet";
    return "Neutral";
  }
}
