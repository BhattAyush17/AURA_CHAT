// src/runtime/humanTiming/ConversationTimingClassifier.ts

export type ConversationIntent = 
  | "Greeting"
  | "QuickFact"
  | "FollowUp"
  | "Teaching"
  | "Coding"
  | "Reasoning"
  | "Brainstorming"
  | "Emotional"
  | "Personal"
  | "Debate"
  | "Storytelling"
  | "Interview"
  | "CreativeWriting"
  | "DecisionMaking"
  | "DeepReflection"
  | "Unknown";

export class ConversationTimingClassifier {
  /**
   * Fast, regex-based classification of the user's intent based on partial/final transcript.
   * This is not a deep LLM call, it's a heuristic engine designed for <1ms latency.
   */
  public classify(text: string): ConversationIntent {
    const t = text.toLowerCase().trim();
    if (!t) return "Unknown";

    if (t.match(/^(hi|hello|hey|good morning|good evening|how are you|what's up)/)) return "Greeting";
    if (t.match(/^(what is|who is|where is|when did|how many|what's the capital)/)) return "QuickFact";
    if (t.match(/^(write|code|function|debug|error|compile|react|typescript|python|html)/)) return "Coding";
    if (t.match(/^(why did|how does|can you explain|reason|logic|because)/)) return "Reasoning";
    if (t.match(/^(feel|sad|happy|lonely|hurt|love|angry|upset|worried)/)) return "Emotional";
    if (t.match(/^(should i|decide|choose|better option|compare)/)) return "DecisionMaking";
    if (t.match(/^(tell me a story|once upon a time|write a poem|imagine)/)) return "Storytelling";
    if (t.match(/^(what do you think about life|meaning of|philosophy)/)) return "DeepReflection";
    if (t.match(/^(what else|and then|tell me more|keep going)/)) return "FollowUp";
    if (t.match(/^(let's brainstorm|ideas for|how can we|think of)/)) return "Brainstorming";

    // Length-based fallback heuristics
    if (t.split(" ").length < 4) return "FollowUp"; // Short bursts are often follow-ups
    
    return "Unknown";
  }
}

// src/runtime/humanTiming/ThinkingWindowPlanner.ts
export class ThinkingWindowPlanner {
  /**
   * Returns [minMs, maxMs] for expected human thinking window based on classification.
   * This is NOT enforced latency; it's a planning signal to help the NaturalPausePlanner.
   */
  public estimateWindow(intent: ConversationIntent): [number, number] {
    switch (intent) {
      case "Greeting": return [0, 150];
      case "QuickFact": return [0, 250];
      case "FollowUp": return [100, 300];
      case "Interview": return [150, 400];
      case "Coding": return [250, 600];
      case "Reasoning": return [300, 700];
      case "Emotional": return [300, 800];
      case "DecisionMaking": return [400, 900];
      case "DeepReflection": return [500, 1200];
      default: return [200, 500];
    }
  }
}
