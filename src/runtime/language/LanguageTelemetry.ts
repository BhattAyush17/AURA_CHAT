export interface LanguageTelemetryEvent {
  primary: string;
  secondary: string;
  ratio: string;
  script: string;
  style: string;
  drift: string;
  stability: string;
}

export class LanguageTelemetry {
  private static instance: LanguageTelemetry;
  public events: LanguageTelemetryEvent[] = [];
  
  private constructor() {}
  
  public static getInstance() {
    if (!LanguageTelemetry.instance) LanguageTelemetry.instance = new LanguageTelemetry();
    return LanguageTelemetry.instance;
  }
  
  public log(event: LanguageTelemetryEvent) {
    this.events.push(event);
    if (this.events.length > 100) this.events.shift();
    console.log("[AURA SSPL]", event);
  }
}
