import { MusicProvider } from '../types';
import { SenseRuntimeTelemetry } from '../../sense/runtime/SenseRuntimeTelemetry';

export interface RegistryEntry {
  provider: MusicProvider;
  priority: number; // Lower is higher priority
  capabilities: string[];
  
  // Reliability Tracking
  successfulInitializations: number;
  successfulObservations: number;
  rollingLatency: number;
  uptimeMs: number;
  failureCount: number;
  restartCount: number;
}

export class ProviderRegistry {
  private entries: Map<string, RegistryEntry> = new Map();

  register(provider: MusicProvider, priority: number, capabilities: string[] = []) {
    this.entries.set(provider.id, { 
      provider, 
      priority, 
      capabilities,
      successfulInitializations: 0,
      successfulObservations: 0,
      rollingLatency: 0,
      uptimeMs: 0,
      failureCount: 0,
      restartCount: 0
    });
  }

  // Calculate Weighted Provider Score
  private getProviderScore(entry: RegistryEntry): number {
    let score = 100;
    
    // Priority Penalty (lower priority number = better)
    score -= (entry.priority * 10);
    
    // Reliability Bonuses
    if (entry.successfulInitializations > 0) score += 5;
    if (entry.successfulObservations > 100) score += 10;
    
    // Latency Penalty (subtract points for high latency)
    if (entry.rollingLatency > 500) score -= Math.floor(entry.rollingLatency / 100);
    
    // Failure Penalties
    score -= (entry.failureCount * 15);
    score -= (entry.restartCount * 5);
    
    return score;
  }

  getSortedEntries(): RegistryEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => this.getProviderScore(b) - this.getProviderScore(a));
  }

  // Returns highest scoring provider that initializes successfully
  async getBestAvailableProvider(): Promise<MusicProvider | null> {
    const sorted = this.getSortedEntries();
    
    for (const entry of sorted) {
      try {
        await entry.provider.initialize();
        entry.successfulInitializations++;
        SenseRuntimeTelemetry.log('PROVIDER_CHANGE', entry.provider.id, { 
          score: this.getProviderScore(entry),
          action: 'initialized'
        });
        return entry.provider;
      } catch (err: any) {
        entry.failureCount++;
        SenseRuntimeTelemetry.log('PROVIDER_CHANGE', entry.provider.id, { 
          score: this.getProviderScore(entry),
          action: 'failed_initialization',
          error: err.message
        });
      }
    }
    
    return null;
  }
}

export const providerRegistry = new ProviderRegistry();
