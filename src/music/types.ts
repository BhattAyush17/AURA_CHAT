export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumArt?: string;
  durationMs: number;
  source: 'youtube' | 'spotify' | 'local' | string;
  url?: string;
  releaseYear?: number;
  genre?: string;
  mood?: string;
  energy?: string;
  activity?: string;
}

export interface MusicIntentPayload {
  query?: string;
  mood?: string;
  energy?: string;
  genre?: string;
  activity?: string;
  intent?: 'explicit_song' | 'mood_based' | 'contextual' | 'similar' | 'preference_based';
}

export interface PlaybackStateData {
  currentTrack: Track | null;
  isPlaying: boolean;
  isPaused: boolean;
  isBuffering: boolean;
  isLoading: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  isMuted: boolean;
  repeatMode: 'off' | 'track' | 'queue';
  isShuffled: boolean;
  queue: Track[];
  history: Track[];
  providerId: string | null;
  audioUnlockState: "unknown" | "unlocked" | "blocked" | "failed";
  pendingTrack: Track | null;
}

export interface SearchProvider {
  id: string;
  name: string;
  
  initialize(): Promise<void>;
  search(query: string): Promise<Track[]>;
  getMetadata(trackId: string): Promise<Partial<Track>>;
  getLyrics(trackId: string): Promise<string | null>;
  recommend(context?: any): Promise<Track[]>;
}

export interface PlaybackProvider {
  id: string;
  name: string;
  
  initialize(): Promise<void>;
  play(trackId: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getAudioStream?(trackId: string): Promise<string | null>;
  unlockAudio(): Promise<void>;
  dispose(): Promise<void>;
}

export interface MusicProvider extends SearchProvider, PlaybackProvider {}
