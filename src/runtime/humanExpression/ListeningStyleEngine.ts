export class ListeningStyleEngine {
  // Quietly listens, Notices emotion, Notices inconsistency, Notices excitement, Notices opportunity
  public evaluate(userText: string, temperature: string): string {
    if (temperature === "Excited") return "Notices excitement";
    if (temperature === "Heavy") return "Notices emotion";
    if (userText.includes("but") && userText.includes("always")) return "Notices inconsistency";
    if (userText.includes("idea") || userText.includes("maybe we could")) return "Notices opportunity";
    return "Quietly listens";
  }
}
