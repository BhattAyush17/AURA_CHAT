export class CuriosityEngine {
  // Surface, Investigative, Reflective, Analytical, Philosophical
  public evaluate(userText: string, intent: string): string {
    if (userText.includes("why do you think")) return "Philosophical";
    if (intent === "Looking for facts") return "Analytical";
    if (userText.includes("hate") || userText.includes("quit")) return "Investigative"; // Looking beneath literal words
    if (intent === "Processing emotions") return "Reflective";
    return "Surface";
  }
}
