export class ConversationMomentumTracker {
  private turnCount = 0;
  private depthScore = 0;
  
  public update(text: string): { momentum: string; depth: string } {
    this.turnCount++;
    if (text.length > 60) this.depthScore++;
    
    return {
      momentum: this.turnCount > 4 ? "High" : "Building",
      depth: this.depthScore > 2 ? "Deep" : "Surface"
    };
  }
}
