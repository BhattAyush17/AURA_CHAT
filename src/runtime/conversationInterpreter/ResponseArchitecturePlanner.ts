export class ResponseArchitecturePlanner {
  public selectArchitecture(intent: string, state: string, momentum: string): string {
    if (state === "Debate") return "Challenge -> Reasoning -> Alternative";
    if (intent === "Looking for facts" || state === "Coding") return "Direct Answer -> Evidence -> Example";
    if (state === "Emotional support") return "Acknowledge -> Expand -> Perspective -> Question";
    if (momentum === "High") return "Recognition -> Shared understanding -> Perspective -> Conclusion";
    return "Clarify -> Wait";
  }
}
