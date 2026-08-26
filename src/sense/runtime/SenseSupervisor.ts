import type { AuraSense } from '../SenseManager/types';
import { SenseLifecycleState } from './SenseLifecycleState';
import { senseHealthAggregator } from './SenseHealthAggregator';
import { senseRecoveryPolicy } from './SenseRecoveryPolicy';
import { SenseRuntimeTelemetry } from './SenseRuntimeTelemetry';
import { perceptionFusionLayer } from '../PerceptionFusionLayer';

export class SenseSupervisor {
  private senses = new Map<string, AuraSense>();
  private lifecycles = new Map<string, SenseLifecycleState>();
  private supervisionInterval: number | null = null;
  private recoveryTasks = new Map<string, NodeJS.Timeout>();

  register(sense: AuraSense) {
    const id = sense.manifest.id;
    this.senses.set(id, sense);
    this.lifecycles.set(id, 'CREATED');
    senseHealthAggregator.register(id);
    SenseRuntimeTelemetry.log('LIFECYCLE_TRANSITION', id, { state: 'CREATED' });
  }

  async initializeAll() {
    for (const [id, sense] of this.senses.entries()) {
      await this.transition(id, 'INITIALIZING');
      try {
        await sense.initialize();
        await sense.start();
        await this.transition(id, 'READY');
      } catch (err) {
        console.error(`[SenseSupervisor] Failed to init ${id}:`, err);
        await this.transition(id, 'FAILED');
      }
    }
    this.startSupervision();
  }

  private async transition(id: string, newState: SenseLifecycleState) {
    if (this.lifecycles.get(id) === newState) return;
    this.lifecycles.set(id, newState);
    SenseRuntimeTelemetry.log('LIFECYCLE_TRANSITION', id, { state: newState });
    
    const sense = this.senses.get(id);
    if (sense) {
      senseHealthAggregator.updateFromSense(sense, newState);
    }
  }

  private startSupervision() {
    if (this.supervisionInterval) clearInterval(this.supervisionInterval);
    
    // Core Supervision Tick (every 1 second)
    this.supervisionInterval = window.setInterval(async () => {
      for (const [id, sense] of this.senses.entries()) {
        const state = this.lifecycles.get(id)!;
        senseHealthAggregator.updateFromSense(sense, state);
        
        // Context collection occurs strictly here
        if (state === 'READY') {
          try {
            const obs = await sense.collectContext();
            if (obs) {
              perceptionFusionLayer.ingest(obs);
            }
          } catch (err: any) {
            SenseRuntimeTelemetry.log('HEALTH_DEGRADED', id, { error: err.message });
            await this.transition(id, 'DEGRADED');
            this.triggerRecovery(id);
          }
        }
      }
    }, 1000);
  }

  private triggerRecovery(id: string) {
    if (this.recoveryTasks.has(id)) return; // Already recovering
    
    const attemptRecovery = async (attempts: number) => {
      const delay = senseRecoveryPolicy.getDelay(attempts);
      if (delay === -1) {
        await this.transition(id, 'FAILED');
        this.recoveryTasks.delete(id);
        return;
      }

      const timeout = setTimeout(async () => {
        await this.transition(id, 'RECOVERING');
        SenseRuntimeTelemetry.log('RECOVERY_ATTEMPT', id, { attempt: attempts + 1 });
        senseHealthAggregator.incrementRecoveryAttempt(id);
        
        const sense = this.senses.get(id)!;
        try {
          // Attempt full restart of the Sense
          await sense.stop();
          await sense.start();
          await this.transition(id, 'READY');
          senseHealthAggregator.incrementRestartCount(id);
          this.recoveryTasks.delete(id);
        } catch (err) {
          await this.transition(id, 'DEGRADED');
          attemptRecovery(attempts + 1);
        }
      }, delay);
      
      this.recoveryTasks.set(id, timeout);
    };

    attemptRecovery(0);
  }
}

export const senseSupervisor = new SenseSupervisor();
