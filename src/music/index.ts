/**
 * AURA Music System — Barrel Exports
 */

export { MusicManager } from "./MusicManager";
export { PlaybackController } from "./PlaybackController";
export { QueueManager } from "./QueueManager";
export { MusicContextEngine } from "./MusicContextEngine";
export { useMusicPlayer } from "./useMusicPlayer";

export type {
  TrackInfo,
  MusicState,
  MusicContext,
  MusicIntentTag,
  IAudioProvider,
  PauseReason,
  RepeatMode,
  PlaybackCallbacks,
} from "./types";
export { createDefaultMusicState } from "./types";
