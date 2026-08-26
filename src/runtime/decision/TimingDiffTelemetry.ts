export interface TimingDiffEvent {
  turnId: string;
  legacyPauseMs: number;
  hrtePauseMs: number;
  deltaMs: number;
  legacyDecision: string;
  hrteDecision: string;
  timestamp: number;
}

export class TimingDiffTelemetry {
  private static instance: TimingDiffTelemetry;
  public events: TimingDiffEvent[] = [];

  private constructor() {}

  public static getInstance(): TimingDiffTelemetry {
    if (!TimingDiffTelemetry.instance) {
      TimingDiffTelemetry.instance = new TimingDiffTelemetry();
    }
    return TimingDiffTelemetry.instance;
  }

  public recordDiff(
    turnId: string,
    legacyPauseMs: number,
    hrtePauseMs: number,
    legacyDecision: string,
    hrteDecision: string
  ) {
    this.events.push({
      turnId,
      legacyPauseMs,
      hrtePauseMs,
      deltaMs: hrtePauseMs - legacyPauseMs,
      legacyDecision,
      hrteDecision,
      timestamp: performance.now(),
    });

    if (this.events.length > 100) {
      this.events.shift();
    }
    
    // Log for shadow mode visibility
    console.log(`[SHADOW TIMING] ⏱ Turn ${turnId} | Legacy: ${legacyPauseMs}ms | HRTE: ${hrtePauseMs}ms | Delta: ${hrtePauseMs - legacyPauseMs}ms`);
  }
}
