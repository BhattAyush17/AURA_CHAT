export interface PerformanceBudget {
  maxFrameTimeMs: number;
  maxMemoryMb: number;
  maxCpuUsagePercent: number;
}

export interface RuntimeSubsystem {
  owner: string;
  purpose: string;
  publicApi: string[];
  dependencies: string[];
  failureGuarantees: string;
  performanceBudget: PerformanceBudget;
  recoveryStrategy: string;
}
