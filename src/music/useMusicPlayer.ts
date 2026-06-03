/**
 * AURA Music System — React Hook
 * 
 * Exposes the MusicManager singleton to React components with
 * automatic state synchronization via useSyncExternalStore pattern.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { MusicState, MusicIntentTag } from "./types";
import { createDefaultMusicState } from "./types";
import { MusicManager } from "./MusicManager";

export function useMusicPlayer() {
  const managerRef = useRef<MusicManager | null>(null);
  const [state, setState] = useState<MusicState>(createDefaultMusicState());

  // Initialize manager once
  useEffect(() => {
    const manager = MusicManager.getInstance();
    managerRef.current = manager;

    // Subscribe to state changes
    const unsubscribe = manager.subscribe((newState) => {
      setState({ ...newState });
    });

    // Set initial state
    setState(manager.getState());

    return unsubscribe;
  }, []);

  // ── Actions ───────────────────────────────────────────────────────

  const playQuery = useCallback(async (query: string) => {
    return managerRef.current?.playQuery(query) ?? false;
  }, []);

  const pause = useCallback(() => {
    managerRef.current?.pause("user_requested");
  }, []);

  const resume = useCallback(() => {
    managerRef.current?.resume();
  }, []);

  const stop = useCallback(() => {
    managerRef.current?.stop();
  }, []);

  const seek = useCallback((seconds: number) => {
    managerRef.current?.seek(seconds);
  }, []);

  const setVolume = useCallback((level: number) => {
    managerRef.current?.setVolume(level);
  }, []);

  const volumeUp = useCallback(() => {
    managerRef.current?.volumeUp();
  }, []);

  const volumeDown = useCallback(() => {
    managerRef.current?.volumeDown();
  }, []);

  const next = useCallback(async () => {
    return managerRef.current?.next() ?? false;
  }, []);

  const previous = useCallback(async () => {
    return managerRef.current?.previous() ?? false;
  }, []);

  const processIntent = useCallback(async (intent: MusicIntentTag) => {
    await managerRef.current?.processIntent(intent);
  }, []);

  const togglePlayPause = useCallback(() => {
    if (state.isPlaying) {
      pause();
    } else if (state.isPaused) {
      resume();
    }
  }, [state.isPlaying, state.isPaused, pause, resume]);

  return {
    // State
    state,
    isActive: state.isPlaying || state.isPaused,
    isPlaying: state.isPlaying,
    isPaused: state.isPaused,
    currentTrack: state.currentTrack,
    position: state.position,
    duration: state.duration,
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

    // Manager access (for advanced use)
    manager: managerRef.current,
  };
}
