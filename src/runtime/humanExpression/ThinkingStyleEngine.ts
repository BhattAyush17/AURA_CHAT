export class ThinkingStyleEngine {
  // Practical, Analytical, Creative, Strategic, Reflective, Systems Thinking, Emotional, Minimal
  public evaluate(state: string, userText: string): string {
    if (state === "Coding") return "Systems Thinking";
    if (state === "Planning") return "Strategic";
    if (state === "Emotional support") return "Emotional";
    if (userText.length < 15) return "Minimal";
    if (state === "Casual chatting") return "Creative";
    return "Practical";
  }
}
