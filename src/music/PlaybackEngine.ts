import { MusicProvider, Track } from './types';
import { playbackState } from './PlaybackState';
import { queueManager } from './QueueManager';
import { playerStateMachine } from './PlayerStateMachine';

export class PlaybackEngine {
  private provider: MusicProvider | null = null;

  setProvider(provider: MusicProvider) {
    this.provider = provider;
    playerStateMachine.transition('Ready');
  }

  async play(track: Track) {
    if (!this.provider) return;
    
    playerStateMachine.transition('Buffering', track.id);
    playbackState.setTrack(track);
    
    try {
      await this.provider.play(track.id);
      playerStateMachine.transition('Playing');
      playbackState.setPlaying(true);
    } catch (err) {
      playerStateMachine.transition('Failed', err);
    }
  }

  async pause() {
    if (!this.provider) return;
    await this.provider.pause();
    playerStateMachine.transition('Paused');
    playbackState.setPlaying(false);
  }

  async resume() {
    if (!this.provider) return;
    await this.provider.resume();
    playerStateMachine.transition('Playing');
    playbackState.setPlaying(true);
  }

  async next() {
    const nextTrack = queueManager.getNext();
    if (nextTrack) {
      await this.play(nextTrack);
    } else {
      await this.pause();
    }
  }

  async previous() {
    if (playbackState.getState().positionMs > 3000) {
      await this.seek(0);
      return;
    }
    
    const prevTrack = queueManager.getPrevious();
    if (prevTrack) {
      await this.play(prevTrack);
    }
  }

  async seek(ms: number) {
    if (!this.provider) return;
    playerStateMachine.transition('Buffering');
    await this.provider.seek(ms);
    playbackState.setPosition(ms);
    playerStateMachine.transition('Playing');
  }

  async setVolume(volume: number) {
    if (!this.provider) return;
    await this.provider.setVolume(volume);
    playbackState.update({ volume });
  }

  handleTrackEnded() {
    const state = playbackState.getState();
    if (state.repeatMode === 'track') {
      if (state.currentTrack) this.play(state.currentTrack);
    } else {
      this.next();
    }
  }
}

export const playbackEngine = new PlaybackEngine();
