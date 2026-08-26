export interface TelemetryEvent {
  timestamp: number;
  type: 'LIFECYCLE_TRANSITION' | 'SUPERVISOR_EVENT' | 'RECOVERY_ATTEMPT' | 'HEALTH_DEGRADED' | 'PROVIDER_CHANGE';
  senseId: string;
  details: Record<string, any>;
}

export class SenseRuntimeTelemetry {
  private static events: TelemetryEvent[] = [];
  private static readonly MAX_EVENTS = 200;

  static log(
    type: TelemetryEvent['type'], 
    senseId: string, 
    details: Record<string, any> = {}
  ) {
    this.events.push({
      timestamp: Date.now(),
      type,
      senseId,
      details
    });

    if (this.events.length > this.MAX_EVENTS) {
      this.events.shift();
    }
    
    // In production, this would also push to a dev console or backend metrics endpoint.
    console.debug(`[Telemetry] ${type} | ${senseId}`, details);
  }

  static getHistory(): TelemetryEvent[] {
    return [...this.events];
  }
}
