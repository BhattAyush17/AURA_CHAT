export interface TelemetryEvent {
  timestamp?: number;
  subsystem: string;
  severity: "info" | "warning" | "error";
  duration?: number;
  runtimePolicy?: string;
  deviceCapability?: string;
  networkScore?: number;
  data: any;
}

export class RuntimeTelemetry {
  private static instance: RuntimeTelemetry;
  private events: TelemetryEvent[] = [];

  private constructor() {}

  public static getInstance(): RuntimeTelemetry {
    if (!RuntimeTelemetry.instance) {
      RuntimeTelemetry.instance = new RuntimeTelemetry();
    }
    return RuntimeTelemetry.instance;
  }

  public logEvent(event: TelemetryEvent) {
    const e = { ...event, timestamp: event.timestamp || performance.now() };
    this.events.push(e);
    if (this.events.length > 100) this.events.shift();
    if (e.severity === "error") console.error(`[Telemetry] ${e.subsystem}:`, e.data);
    else if (e.severity === "warning") console.warn(`[Telemetry] ${e.subsystem}:`, e.data);
    else console.log(`[Telemetry] ${e.subsystem}:`, e.data);
  }

  public generateDashboard() {
    console.groupCollapsed("[Unified Runtime Dashboard]");
    console.table(this.events);
    console.groupEnd();
  }
}
