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
    if (rhythm === "TECHNICAL") return ["That's an interesting question.", "Let me analyze this.", "Let me look into that."];
    if (emotion === "excited") return ["Wow!", "Oh, interesting!", "That's great!"];
    if (intent === "agreement") return ["I understand.", "Right.", "I see."];
    if (rhythm === "EMOTIONAL") return ["I hear you.", "I understand.", "That's deep."];
    
    return []; // Silence is preferred over artificial fillers
  }
}
