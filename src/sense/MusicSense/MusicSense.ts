import { BaseSense } from "../SenseManager/BaseSense";
import type { RawSenseObservation, SenseManifest } from "../SenseManager/types";
import { playbackState } from "../../music/PlaybackState";

export class MusicSense extends BaseSense {
  readonly manifest: SenseManifest = {
    id: "music",
    version: "1.0.0",
    displayName: "Music Intelligence",
    description: "Understand what you're listening to.",
    icon: "🎵",
    dependencies: [],
    capabilities: ["audio_playback", "metadata_extraction"],
    providerRequirements: ["youtube_oauth", "ytdlp"],
    requiredPermissions: ["youtube_readonly"]
  };

  private unsubscribeState: (() => void) | null = null;
  private unsubscribeTransitions: (() => void) | null = null;

  async initialize(): Promise<void> {
    this.setStatus("connected", "provider_registry_managed");
    this._initialized = true;
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  
  async start(): Promise<void> {
    this.setStatus("active");
  }

  async stop(): Promise<void> {
    this.setStatus("connected");
  }

  async dispose(): Promise<void> {
    this.unsubscribeState?.();
    this.unsubscribeTransitions?.();
    this.setStatus("disconnected");
  }

  async collectContext(): Promise<RawSenseObservation | null> {
    const state = playbackState.getState();
    // Do not infer emotion. Do not infer memory. Only construct evidence payload.
    const payload = {
      playback: {
        isPlaying: state.isPlaying,
        trackTitle: state.currentTrack?.title,
        trackArtist: state.currentTrack?.artist,
        trackId: state.currentTrack?.id,
        positionSeconds: state.positionMs / 1000,
        durationSeconds: state.durationMs / 1000,
      },
      playerState: state.isPlaying ? "Playing" : (state.isPaused ? "Paused" : "Stopped"),
      volume: state.volume,
    };

    this._health.lastObservation = Date.now();

    return {
      source: "music",
      timestamp: Date.now(),
      estimatedConfidence: state.currentTrack ? 0.95 : 0.2, // Rough estimate, fusion layer finalizes
      payload
    };
  }
}
