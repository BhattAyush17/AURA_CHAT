export type ConversationRhythm = 
  | "FAST" 
  | "CALM" 
  | "TECHNICAL" 
  | "CASUAL" 
  | "PLAYFUL" 
  | "EMOTIONAL" 
  | "INTERVIEW" 
  | "TEACHING";

export class ConversationRhythmEngine {
  private currentRhythm: ConversationRhythm = "CASUAL";

  public updateRhythm(intent: string, emotion: string): void {
    if (emotion === "sad" || emotion === "distressed") {
      this.currentRhythm = "CALM";
    } else if (emotion === "excited") {
      this.currentRhythm = "FAST";
    } else if (intent.includes("code") || intent.includes("analyze")) {
      this.currentRhythm = "TECHNICAL";
    }
  }

  public getRhythm(): ConversationRhythm {
    return this.currentRhythm;
  }

  public getPacingConfig() {
    switch (this.currentRhythm) {
      case "FAST": return { pauseTimingMs: 150, speechPacing: 1.1, fillerProbability: 0.1 };
      case "CALM": return { pauseTimingMs: 600, speechPacing: 0.9, fillerProbability: 0.3 };
      case "TECHNICAL": return { pauseTimingMs: 400, speechPacing: 1.0, fillerProbability: 0.2 };
      default: return { pauseTimingMs: 300, speechPacing: 1.0, fillerProbability: 0.2 };
    }
  }
}
