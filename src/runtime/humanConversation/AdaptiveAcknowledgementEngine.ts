export class AdaptiveAcknowledgementEngine {
  private lastAcknowledgement: string | null = null;

  public selectAcknowledgement(intent: string, emotion: string, rhythm: string): string | null {
    const options = this.getOptions(intent, emotion, rhythm);
    
    // Prevent repetitive fillers
    const filteredOptions = options.filter(opt => opt !== this.lastAcknowledgement);
    const selection = filteredOptions.length > 0 
      ? filteredOptions[Math.floor(Math.random() * filteredOptions.length)] 
      : options[0];

    this.lastAcknowledgement = selection;
    return selection;
  }

  private getOptions(intent: string, emotion: string, rhythm: string): string[] {
    if (rhythm === "TECHNICAL") return ["Let me think about that...", "Analyzing...", "Hmm..."];
    if (emotion === "excited") return ["Wow...", "Oh...", "Interesting!"];
    if (intent === "agreement") return ["Yeah...", "Right...", "I see..."];
    if (rhythm === "EMOTIONAL") return ["[sigh]", "Mm...", "I hear you..."];
    
    return ["Hmm...", "Let's see...", "Okay..."]; // Default casual
  }
}
