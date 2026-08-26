export type SenseLifecycleState = 
  | 'CREATED'
  | 'INITIALIZING'
  | 'READY'
  | 'DEGRADED'
  | 'RECOVERING'
  | 'FAILED'
  | 'SHUTDOWN';

/**
 * Universal Sense Lifecycle.
 * Individual senses do NOT transition themselves; Runtime Supervisor manages this.
 */
export interface SenseLifecycle {
  state: SenseLifecycleState;
  lastTransition: number;
}
