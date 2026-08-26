// src/runtime/optimization/RuntimeBackpressureController.ts
import { RuntimeTelemetry } from "../RuntimeTelemetry";

export type SubsystemLoad = "normal" | "saturated" | "critical";

export class RuntimeBackpressureController {
  private static instance: RuntimeBackpressureController;
  private telemetry = RuntimeTelemetry.getInstance();

  private pressureState: Record<string, SubsystemLoad> = {
    speech: "normal",
    provider: "normal",
    memory: "normal",
    expression: "normal",
    telemetry: "normal"
  };

  private constructor() {}

  public static getInstance(): RuntimeBackpressureController {
    if (!RuntimeBackpressureController.instance) {
      RuntimeBackpressureController.instance = new RuntimeBackpressureController();
    }
    return RuntimeBackpressureController.instance;
  }

  public reportLoad(subsystem: keyof typeof this.pressureState, load: SubsystemLoad) {
    if (this.pressureState[subsystem] !== load) {
      this.pressureState[subsystem] = load;
      this.evaluatePressure();
    }
  }

  private evaluatePressure() {
    let pressureLevel = 0;
    if (this.pressureState.speech !== "normal") pressureLevel += 10;
    if (this.pressureState.provider !== "normal") pressureLevel += 8;
    if (this.pressureState.memory !== "normal") pressureLevel += 5;

    if (pressureLevel > 0) {
      this.telemetry.logEvent({
        subsystem: "BackpressureController",
        severity: "warning",
        data: { event: "PressureSpike", currentPressure: pressureLevel, state: this.pressureState, turnId: "system", thread: "main" },
        timestamp: Date.now()
      });
    }
  }

  public shouldThrottle(subsystem: string): boolean {
    // 1 Speech, 2 Provider, 3 Memory, 4 Expression, 5 Telemetry
    if (this.pressureState.provider === "critical" || this.pressureState.speech === "critical") {
      if (subsystem === "telemetry" || subsystem === "expression" || subsystem === "memory") {
        return true;
      }
    }
    if (this.pressureState.memory === "critical") {
      if (subsystem === "telemetry" || subsystem === "expression") {
        return true;
      }
    }
    return false;
  }
}
