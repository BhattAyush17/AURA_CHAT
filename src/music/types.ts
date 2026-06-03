/**
 * AURA Music System — Core Types
 * 
 * Provider-agnostic type definitions for the music companion system.
 */

// ─── Track Model ────────────────────────────────────────────────────
export interface TrackInfo {
  id: string;
  title: string;
  artist: string;
  source: string;         // Provider source identifier (e.g. "youtube", "local")
  thumbnail: string;
  duration: number;       // Duration in seconds
  streamUrl?: string;     // Resolved audio stream URL
}

// ─── Music State ────────────────────────────────────────────────────
export interface MusicState {
  isPlaying: boolean;
  isPaused: boolean;
  currentTrack: TrackInfo | null;
  position: number;       // Current playback position in seconds
  duration: number;       // Total duration in seconds
  volume: number;         // 0.0 – 1.0
  queue: TrackInfo[];
  queueIndex: number;     // Current position in queue (-1 if no queue active)
  source: string | null;
  lastPausedReason: PauseReason | null;
  repeat: RepeatMode;
  shuffle: boolean;
}

export type PauseReason = 
  | "user_speaking"       // VAD detected user speech
  | "aura_speaking"       // AURA TTS is active — duck or pause
  | "user_requested"      // Explicit pause command
  | "track_ended"         // Track finished naturally
  | null;

export type RepeatMode = "none" | "one" | "all";

// ─── Music Context (for LLM injection) ─────────────────────────────
export interface MusicContext {
  currentSong: string;
  currentArtist: string;
  playbackState: "playing" | "paused" | "stopped";
  startTime: string;
  userAssociations: string[];
  emotionsDetected: string[];
}

// ─── Music Intent Tags (parsed from LLM output) ────────────────────
export type MusicIntentTag =
  | { type: "play"; query: string }
  | { type: "stop" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "next" }
  | { type: "previous" }
  | { type: "volume"; level: number }
  | { type: "volume_up" }
  | { type: "volume_down" }
  | { type: "association"; text: string }
  | { type: "emotion"; text: string };

// ─── Audio Provider Interface ───────────────────────────────────────
export interface IAudioProvider {
  readonly name: string;
  search(query: string): Promise<TrackInfo[]>;
  getStreamUrl(track: TrackInfo): Promise<string | null>;
}

// ─── Playback Event Callbacks ───────────────────────────────────────
export interface PlaybackCallbacks {
  onStateChange?: (state: MusicState) => void;
  onTrackEnd?: () => void;
  onError?: (error: string) => void;
  onTimeUpdate?: (position: number, duration: number) => void;
}

// ─── Default State Factory ──────────────────────────────────────────
export function createDefaultMusicState(): MusicState {
  return {
    isPlaying: false,
    isPaused: false,
    currentTrack: null,
    position: 0,
    duration: 0,
    volume: 0.8,
    queue: [],
    queueIndex: -1,
    source: null,
    lastPausedReason: null,
    repeat: "none",
    shuffle: false,
  };
}
