export class ExpressionTelemetry {
  private static instance: ExpressionTelemetry;
  public events: any[] = [];
  
  private constructor() {}
  
  public static getInstance() {
    if (!ExpressionTelemetry.instance) ExpressionTelemetry.instance = new ExpressionTelemetry();
    return ExpressionTelemetry.instance;
  }
  
  public log(state: any) {
    this.events.push({ ...state, timestamp: Date.now() });
    console.log("[AURA Expression]", state);
  }
}
