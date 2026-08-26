import { ConversationTimingClassifier, ConversationIntent } from "./TimingClassifiers";
import { EndpointConfidenceEngine } from "./EndpointConfidenceEngine";
import { ResponseMomentumPlanner, NaturalPausePlanner } from "./TimingPlanners";

export interface TimingEvent {
  stage: string;
  intent: string;
  momentum: string;
  confidence: number;
  expectedPause: number;
  actualPause: number;
  timestamp: number;
}

export class TimingTelemetry {
  private static instance: TimingTelemetry;
  public events: TimingEvent[] = [];
  
  private constructor() {}
  
  public static getInstance(): TimingTelemetry {
    if (!TimingTelemetry.instance) TimingTelemetry.instance = new TimingTelemetry();
    return TimingTelemetry.instance;
  }
  
  public log(event: Omit<TimingEvent, "timestamp">) {
    this.events.push({ ...event, timestamp: performance.now() });
    if (this.events.length > 100) this.events.shift();
  }
}

export class HumanResponseTimingEngine {
  private static instance: HumanResponseTimingEngine;
  
  public classifier = new ConversationTimingClassifier();
  public endpointEngine = new EndpointConfidenceEngine();
  public momentumPlanner = new ResponseMomentumPlanner();
  public pausePlanner = new NaturalPausePlanner();
  
  private currentIntent: ConversationIntent = "Unknown";
  private currentConfidence: number = 0;
  
  private constructor() {}
  
  public static getInstance(): HumanResponseTimingEngine {
    if (!HumanResponseTimingEngine.instance) {
      HumanResponseTimingEngine.instance = new HumanResponseTimingEngine();
    }
    return HumanResponseTimingEngine.instance;
  }
  
  /**
   * Called continuously as partial transcripts arrive.
   * Updates endpoint confidence and predicts intent before speech ends.
   */
  public evaluateStream(currentTranscript: string, lastTranscript: string, msSinceAudio: number) {
    this.currentConfidence = this.endpointEngine.evaluate(currentTranscript, lastTranscript, msSinceAudio);
    
    // We only classify if we have a reasonable amount of text
    if (currentTranscript.length > 5) {
      this.currentIntent = this.classifier.classify(currentTranscript);
    }
    
    // EARLY DISPATCH: If confidence > 90%, we can start pre-warming Memory / Prompt in the orchestrator
    return {
      confidence: this.currentConfidence,
      intent: this.currentIntent,
      shouldPreWarm: this.currentConfidence > 90
    };
  }
  
  /**
   * Called when TTFT (Time To First Token) arrives.
   * Determines if we should play the audio immediately, or wait a few ms to make it feel human.
   */
  public calculateFinalPause(ttftDurationMs: number): number {
    const momentum = this.momentumPlanner.getMomentum();
    const pauseMs = this.pausePlanner.calculatePause(this.currentIntent, momentum, ttftDurationMs);
    
    TimingTelemetry.getInstance().log({
      stage: "FINAL_PAUSE",
      intent: this.currentIntent,
      momentum,
      confidence: this.currentConfidence,
      expectedPause: pauseMs,
      actualPause: ttftDurationMs + pauseMs
    });
    
    return pauseMs;
  }
}
