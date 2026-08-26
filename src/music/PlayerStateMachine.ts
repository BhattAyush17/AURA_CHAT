import { musicEvents } from './PlaybackEvents';

export type PlayerState = 
  | 'Disconnected'
  | 'Authenticating'
  | 'Ready'
  | 'Searching'
  | 'Buffering'
  | 'Playing'
  | 'Paused'
  | 'Recovering'
  | 'Failed';

export class PlayerStateMachine {
  private currentState: PlayerState = 'Disconnected';
  
  transition(newState: PlayerState, context?: any) {
    if (this.currentState === newState) return;
    
    const previous = this.currentState;
    this.currentState = newState;
    
    // Emit strict state transition events
    musicEvents.emit('stateTransition', { previous, current: newState, context });
    
    // Legacy mapping to keep PlaybackState reactive model working
    if (newState === 'Playing') musicEvents.emit('playing');
    if (newState === 'Paused') musicEvents.emit('paused');
  }

  get state(): PlayerState {
    return this.currentState;
  }
}

export const playerStateMachine = new PlayerStateMachine();
