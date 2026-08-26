export type FlightStage =
  | "idle"
  | "listening"
  | "vad_wait"
  | "stt_finalizing"
  | "cognition"
  | "memory_warmup"
  | "prompt_build"
  | "llm_ttft"
  | "streaming"
  | "chunking"
  | "tts_generation"
  | "audio_decode"
  | "playback";

export interface FlightEvent {
  turnId: string;
  module: string;
  event: string;
  startTime: number;
  endTime: number;
  duration: number;
  thread: "main" | "worker" | "audio_worklet" | "network";
  blocking: boolean;
  metadata?: any;
}

type FlightListener = (events: FlightEvent[], currentStage: FlightStage) => void;

export class FlightRecorder {
  private static instance: FlightRecorder;
  private events: FlightEvent[] = [];
  private listeners: Set<FlightListener> = new Set();
  
  private currentStage: FlightStage = "idle";
  private activeMeasurements: Map<string, Partial<FlightEvent>> = new Map();
  private turnCount = 0;
  private currentTurnId = "t_0";

  public static getInstance(): FlightRecorder {
    if (!FlightRecorder.instance) {
      FlightRecorder.instance = new FlightRecorder();
    }
    return FlightRecorder.instance;
  }

  public subscribe(listener: FlightListener): () => void {
    this.listeners.add(listener);
    // Send immediate state
    listener([...this.events], this.currentStage);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener([...this.events], this.currentStage);
    }
  }

  public setStage(stage: FlightStage) {
    this.currentStage = stage;
    this.notify();
  }

  public startTurn() {
    this.turnCount++;
    this.currentTurnId = `t_${this.turnCount}`;
    this.setStage("listening");
  }

  public getCurrentTurnId() {
    return this.currentTurnId;
  }

  public startMeasurement(key: string, module: string, event: string, thread: FlightEvent["thread"], blocking: boolean) {
    this.activeMeasurements.set(key, {
      turnId: this.currentTurnId,
      module,
      event,
      startTime: performance.now(),
      thread,
      blocking
    });
  }

  public endMeasurement(key: string, metadata?: any) {
    const measure = this.activeMeasurements.get(key);
    if (!measure || !measure.startTime) return;

    const endTime = performance.now();
    const duration = endTime - measure.startTime;

    const completedEvent: FlightEvent = {
      turnId: measure.turnId!,
      module: measure.module!,
      event: measure.event!,
      startTime: measure.startTime,
      endTime,
      duration,
      thread: measure.thread!,
      blocking: measure.blocking!,
      metadata
    };

    this.events.push(completedEvent);
    
    // Memory limit: keep last 200 events to prevent leak
    if (this.events.length > 200) {
      this.events = this.events.slice(-200);
    }

    this.activeMeasurements.delete(key);
    this.notify();
  }
}
