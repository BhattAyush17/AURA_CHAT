export class ConversationPresence {
  public evaluate(state: string, energy: string, temperature: string): string {
    // Relaxed, Focused, Reflective, Curious, Warm, Reserved, Professional, Playful, Grounded, Expressive, Quietly Observant, Energetic
    if (energy === "Low" && temperature === "Heavy") return "Quietly Observant";
    if (energy === "High" && temperature === "Playful") return "Playful";
    if (energy === "Passionate" && temperature === "Excited") return "Energetic";
    if (state === "Debate") return "Focused";
    if (state === "Emotional support") return "Warm";
    if (temperature === "Quiet") return "Reflective";
    if (state === "Coding") return "Professional";
    return "Relaxed";
  }
}
