// src/runtime/optimization/ExecutionBudgetEngine.ts
import { RuntimeTelemetry } from "../RuntimeTelemetry";
import { RuntimePolicy } from "../decision/DecisionContracts";

export interface ExecutionBudget {
  cpuMs: number;
  memoryMb: number;
  networkRequests: number;
  waitMs: number;
  streamingBufferMs: number;
}

export class ExecutionBudgetEngine {
  private static instance: ExecutionBudgetEngine;
  private telemetry = RuntimeTelemetry.getInstance();

  private constructor() {}

  public static getInstance(): ExecutionBudgetEngine {
    if (!ExecutionBudgetEngine.instance) {
      ExecutionBudgetEngine.instance = new ExecutionBudgetEngine();
    }
    return ExecutionBudgetEngine.instance;
  }

  public calculateBudget(
    policy: RuntimePolicy,
    isLowPower: boolean,
    deviceScore: number
  ): ExecutionBudget {
    // Base budget
    const budget: ExecutionBudget = {
      cpuMs: 16,
      memoryMb: 50,
      networkRequests: 1,
      waitMs: 500,
      streamingBufferMs: 200,
    };

    if (isLowPower || deviceScore < 50 || policy === "BatterySaver") {
      budget.cpuMs = 8;
      budget.memoryMb = 20;
      budget.waitMs = 1500;
      budget.streamingBufferMs = 100;
    } else if (policy === "Aggressive" && deviceScore > 80) {
      budget.cpuMs = 32;
      budget.memoryMb = 100;
      budget.waitMs = 200;
      budget.streamingBufferMs = 500;
    }

    return budget;
  }

  public reportViolation(subsystem: string, metric: keyof ExecutionBudget, actual: number, allowed: number) {
    this.telemetry.logEvent({
      subsystem,
      severity: "warning",
      data: { event: "BudgetViolation", metric, actual, allowed, turnId: "system", thread: "main" },
      timestamp: Date.now()
    });
  }
}
