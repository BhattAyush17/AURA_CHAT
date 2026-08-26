export class EndpointConfidenceEngine {
  private stabilityScore: number = 0;
  private lastTranscriptTime: number = 0;
  private confidence: number = 0;

  /**
   * Replaces rigid VAD wait. Evaluates confidence [0-100] that the user has finished speaking.
   * Based on time since last transcript change, and basic semantic completeness.
   */
  public evaluate(
    currentTranscript: string, 
    lastTranscript: string, 
    timeSinceLastAudioMs: number
  ): number {
    if (!currentTranscript) return 0;
    
    // If transcript changed, reset stability
    if (currentTranscript !== lastTranscript) {
      this.stabilityScore = 0;
      this.lastTranscriptTime = performance.now();
    } else {
      // Transcript is stable, increase stability score based on time passed
      const msStable = performance.now() - this.lastTranscriptTime;
      this.stabilityScore = Math.min(100, (msStable / 500) * 100); 
    }

    let semanticScore = 0;
    const t = currentTranscript.trim();
    // Does it end with punctuation indicating completeness?
    if (t.endsWith(".") || t.endsWith("?") || t.endsWith("!")) {
      semanticScore = 40;
    }
    
    // Is it a known short complete phrase?
    if (t.match(/^(yes|no|yeah|nope|okay|sure|thanks|thank you)$/i)) {
      semanticScore = 80;
    }

    // Blend time-based stability (60%) with semantic completeness (40%)
    this.confidence = (this.stabilityScore * 0.6) + (semanticScore);
    
    // VAD absolute silence boost
    if (timeSinceLastAudioMs > 300) {
      this.confidence += 20;
    }

    return Math.min(100, this.confidence);
  }
}
