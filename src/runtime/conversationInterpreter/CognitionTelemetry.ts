export class CognitionTelemetry {
  private static instance: CognitionTelemetry;
  public events: any[] = [];
  
  private constructor() {}
  
  public static getInstance() {
    if (!CognitionTelemetry.instance) CognitionTelemetry.instance = new CognitionTelemetry();
    return CognitionTelemetry.instance;
  }
  
  public log(event: any) {
    this.events.push({ ...event, timestamp: Date.now() });
    if (this.events.length > 100) this.events.shift();
    console.log("[AURA Cognition]", event);
  }
}
