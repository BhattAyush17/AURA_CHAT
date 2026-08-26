/**
 * AURA Music System — React Hook
 * 
 * Exposes the MusicManager singleton to React components with
 * automatic state synchronization via useSyncExternalStore pattern.
 */

import { useState, useEffect, useCallback } from "react";
import type { PlaybackStateData, Track } from "./types";
import { playbackState } from "./PlaybackState";
import { playbackEngine } from "./PlaybackEngine";
import { musicEvents } from "./PlaybackEvents";
import { musicService } from "./MusicService";

export function useMusicPlayer() {
  const [state, setState] = useState<PlaybackStateData>(playbackState.getState());

  useEffect(() => {
    // Subscribe to state changes
    const handleStateChange = (newState: PlaybackStateData) => {
      setState({ ...newState });
    };

    musicEvents.on('stateChanged', handleStateChange);
    
    // Set initial state
    setState(playbackState.getState());

    return () => {
      musicEvents.off('stateChanged', handleStateChange);
    };
  }, []);

  // ── Actions ───────────────────────────────────────────────────────

  const playQuery = useCallback(async (query: string) => {
    // Note: playbackEngine doesn't directly expose playQuery. 
    // The ATF or IntentResolver should handle searching and queueing.
    // We'll leave this as a no-op or pass it to the engine if we implement it.
    console.warn("playQuery called from UI, should be handled by ATF");
    return false;
  }, []);

  const pause = useCallback(async () => {
    await playbackEngine.pause();
  }, []);

  const resume = useCallback(async () => {
    await playbackEngine.resume();
  }, []);

  const stop = useCallback(async () => {
    await playbackEngine.pause();
  }, []);

  const seek = useCallback(async (seconds: number) => {
    await playbackEngine.seek(seconds * 1000);
  }, []);

  const setVolume = useCallback(async (level: number) => {
    await playbackEngine.setVolume(level);
  }, []);

  const volumeUp = useCallback(async () => {
    const nextVol = Math.min(100, state.volume + 10);
    await playbackEngine.setVolume(nextVol);
  }, [state.volume]);

  const volumeDown = useCallback(async () => {
    const nextVol = Math.max(0, state.volume - 10);
    await playbackEngine.setVolume(nextVol);
  }, [state.volume]);

  const next = useCallback(async () => {
    await playbackEngine.next();
    return true;
  }, []);

  const previous = useCallback(async () => {
    await playbackEngine.previous();
    return true;
  }, []);

  const processIntent = useCallback(async (intent: any) => {
    console.warn("processIntent from UI is deprecated. Handled by ATF.");
  }, []);

  const togglePlayPause = useCallback(() => {
    if (state.isPlaying) {
      pause();
    } else {
      resume();
    }
  }, [state.isPlaying, pause, resume]);

  return {
    // State
    state,
    isActive: state.isPlaying || state.isPaused,
    isPlaying: state.isPlaying,
    isPaused: state.isPaused,
    currentTrack: state.currentTrack,
    position: state.positionMs / 1000,
    duration: state.durationMs / 1000,
    volume: state.volume,
    queue: state.queue,

    // Actions
    playQuery,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    volumeUp,
    volumeDown,
    next,
    previous,
    togglePlayPause,
    processIntent,
    switchProvider: (id: string) => musicService.switchProvider(id),
    availableProviders: musicService.getAvailableProviders(),
    
    // Engine access
    engine: playbackEngine
  };
}
