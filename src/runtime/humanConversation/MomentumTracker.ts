export interface ConversationMomentum {
  pacing: number; // 0.0 to 2.0
  responseDepth: "shallow" | "normal" | "deep";
  acknowledgementFrequency: "low" | "normal" | "high";
}

export class MomentumTracker {
  private interruptions: number = 0;
  private avgLatency: number = 200;
  private emotionalIntensity: number = 1.0;

  public trackInteraction(wasInterrupted: boolean, latencyMs: number, intensity: number) {
    if (wasInterrupted) this.interruptions++;
    this.avgLatency = (this.avgLatency * 0.8) + (latencyMs * 0.2);
    this.emotionalIntensity = intensity;
  }

  public getMomentum(): ConversationMomentum {
    // Momentum evolves gradually. Adapt response depth, pacing, and acknowledgement freq.
    let depth: "shallow" | "normal" | "deep" = "normal";
    let freq: "low" | "normal" | "high" = "normal";
    let pacing = 1.0;

    if (this.interruptions > 2) {
      // User is interrupting a lot; keep responses shallow and fast
      depth = "shallow";
      pacing = 1.2;
      freq = "high";
    } else if (this.avgLatency < 100 && this.emotionalIntensity > 1.5) {
      depth = "deep";
      pacing = 0.9;
      freq = "low";
    }

    return { pacing, responseDepth: depth, acknowledgementFrequency: freq };
  }
}
