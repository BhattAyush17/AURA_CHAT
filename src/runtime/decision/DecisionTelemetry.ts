import { RuntimeDecision } from "./DecisionContracts";

export class DecisionTelemetry {
  private static instance: DecisionTelemetry;
  public decisions: Readonly<RuntimeDecision>[] = [];

  private constructor() {}

  public static getInstance(): DecisionTelemetry {
    if (!DecisionTelemetry.instance) {
      DecisionTelemetry.instance = new DecisionTelemetry();
    }
    return DecisionTelemetry.instance;
  }

  public record(decision: Readonly<RuntimeDecision>) {
    this.decisions.push(decision);
    if (this.decisions.length > 100) {
      this.decisions.shift();
    }
  }
}
