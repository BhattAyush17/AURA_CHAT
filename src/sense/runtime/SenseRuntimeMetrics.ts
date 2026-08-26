export interface SenseRuntimeMetrics {
  lifecycle: string;
  rollingLatency: number;
  observationFrequency: number;
  provider: string | null;
  providerHealth: 'healthy' | 'degraded' | 'failed' | 'disconnected';
  replayBufferSize: number;
  failureCount: number;
  restartCount: number;
  recoveryAttempts: number;
  uptime: number; // In milliseconds
  healthScore: number; // 0.0 - 1.0
  lastSuccessfulObservation: number;
}

export function createDefaultMetrics(): SenseRuntimeMetrics {
  return {
    lifecycle: 'CREATED',
    rollingLatency: 0,
    observationFrequency: 0,
    provider: null,
    providerHealth: 'disconnected',
    replayBufferSize: 0,
    failureCount: 0,
    restartCount: 0,
    recoveryAttempts: 0,
    uptime: 0,
    healthScore: 1.0,
    lastSuccessfulObservation: 0
  };
}
