export class ResponseEndingPlanner {
  private previousEnding: string = "Question";
  
  public plan(intent: string, momentum: string): string {
    let ending = "Observation";
    
    if (intent === "Looking for facts") {
      ending = "Nothing further (let the facts stand)";
    } else if (intent === "Thinking aloud") {
      ending = "A reflective thought (no questions)";
    } else if (momentum === "High") {
      // In high momentum, questions or challenges keep the ball moving
      ending = Math.random() > 0.5 ? "A specific, curious question" : "A gentle challenge";
    } else {
      // Natural mix
      const rand = Math.random();
      if (rand < 0.3) ending = "An observation";
      else if (rand < 0.6) ending = "A thought";
      else if (rand < 0.8) ending = "Nothing further";
      else ending = "A natural question";
    }
    
    // Prevent repetitive question loops
    if (ending.includes("question") && this.previousEnding.includes("question")) {
      ending = "An observation";
    }
    
    this.previousEnding = ending;
    return ending;
  }
}
