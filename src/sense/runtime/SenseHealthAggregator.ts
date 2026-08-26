import { SenseRuntimeMetrics, createDefaultMetrics } from './SenseRuntimeMetrics';
import type { AuraSense } from '../SenseManager/types';

export class SenseHealthAggregator {
  private metricsMap = new Map<string, SenseRuntimeMetrics>();
  private startTimeMap = new Map<string, number>();

  register(senseId: string) {
    if (!this.metricsMap.has(senseId)) {
      this.metricsMap.set(senseId, createDefaultMetrics());
      this.startTimeMap.set(senseId, Date.now());
    }
  }

  updateFromSense(sense: AuraSense, lifecycle: string) {
    const health = sense.health();
    const metrics = this.metricsMap.get(sense.manifest.id);
    if (!metrics) return;

    metrics.lifecycle = lifecycle;
    
    // Rolling latency (simple EWMA)
    metrics.rollingLatency = metrics.rollingLatency === 0 
      ? health.latency 
      : (metrics.rollingLatency * 0.8) + (health.latency * 0.2);
    
    metrics.provider = health.provider;
    
    // Normalize provider health (assuming if Sense is 'error' the provider might be degraded)
    metrics.providerHealth = health.status === 'error' ? 'degraded' : 
                             health.status === 'active' || health.status === 'connected' ? 'healthy' : 'disconnected';
    
    metrics.lastSuccessfulObservation = health.lastObservation;
    metrics.failureCount = health.errorCount;

    // Calculate Uptime
    const start = this.startTimeMap.get(sense.manifest.id) || Date.now();
    metrics.uptime = Date.now() - start;

    // Calculate Health Score (1.0 = perfect)
    let score = 1.0;
    if (health.status === 'error' || health.status === 'recovering') score -= 0.4;
    if (metrics.lifecycle === 'FAILED') score = 0.0;
    if (metrics.rollingLatency > 1000) score -= 0.2;
    if (Date.now() - metrics.lastSuccessfulObservation > 30000 && health.status === 'active') score -= 0.3;
    
    metrics.healthScore = Math.max(0, score);
  }

  incrementRestartCount(senseId: string) {
    const m = this.metricsMap.get(senseId);
    if (m) {
      m.restartCount++;
      m.recoveryAttempts = 0; // reset on full restart
    }
  }

  incrementRecoveryAttempt(senseId: string) {
    const m = this.metricsMap.get(senseId);
    if (m) m.recoveryAttempts++;
  }

  updateObservationFrequency(senseId: string, obsCount: number, windowMs: number) {
    const m = this.metricsMap.get(senseId);
    if (m) {
      m.observationFrequency = (obsCount / windowMs) * 1000; // Hz
    }
  }

  getMetrics(senseId: string): SenseRuntimeMetrics | undefined {
    return this.metricsMap.get(senseId);
  }
}

export const senseHealthAggregator = new SenseHealthAggregator();
