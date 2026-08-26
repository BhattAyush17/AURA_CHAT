import { PlaybackStateData, Track } from './types';
import { musicEvents } from './PlaybackEvents';

export class PlaybackState {
  private state: PlaybackStateData = {
    currentTrack: null,
    isPlaying: false,
    isPaused: false,
    isBuffering: false,
    isLoading: false,
    positionMs: 0,
    durationMs: 0,
    volume: 100,
    isMuted: false,
    repeatMode: 'off',
    isShuffled: false,
    queue: [],
    history: [],
    providerId: null,
  };

  getState(): PlaybackStateData {
    return { ...this.state };
  }

  update(partial: Partial<PlaybackStateData>) {
    this.state = { ...this.state, ...partial };
    musicEvents.emit('stateChanged', this.state);
  }

  setTrack(track: Track) {
    if (this.state.currentTrack) {
      this.state.history.push(this.state.currentTrack);
    }
    this.update({
      currentTrack: track,
      positionMs: 0,
      durationMs: track.durationMs,
      isPlaying: false,
      isPaused: false,
      isLoading: true
    });
    musicEvents.emit('trackChanged', track);
  }

  setPosition(ms: number) {
    this.update({ positionMs: ms });
  }

  setPlaying(isPlaying: boolean) {
    this.update({ 
      isPlaying, 
      isPaused: !isPlaying,
      isLoading: false,
      isBuffering: false
    });
    if (isPlaying) musicEvents.emit('playing');
    else musicEvents.emit('paused');
  }
}

export const playbackState = new PlaybackState();
