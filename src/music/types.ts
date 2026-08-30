export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumArt?: string;
  durationMs: number;
  source: "youtube" | "spotify" | "local" | string;
  url?: string;
  releaseYear?: number;
  genre?: string;
  mood?: string;
  energy?: string;
  activity?: string;
  chapters?: { title: string; start_time: number; end_time: number }[];
}

export interface MusicalEvidence {
  type:
    | "energy_rise"
    | "energy_drop"
    | "instrumentation_change"
    | "onset_cluster"
    | "silence"
    | "structural_boundary"
    | "acoustic_transition"
    | "silence_break"
    | "unknown_transition";
  timestampMs: number;
  confidence: number;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface MusicalMoment {
  trackId: string;
  sessionId: string;
  startMs: number;
  endMs?: number;
  section?: string;
  previousSection?: string;
  nextSection?: string;
  trigger?:
    | "track_start"
    | "section_change"
    | "seek"
    | "resume"
    | "user_reference"
    | "acoustic_event"
    | "unknown";
  transition?: string;
  salience: number; // 0.0 to 1.0
  evidence: MusicalEvidence[];
  sources: string[];
  confidence: number;
  observedAt: number;
}

export interface MusicPerceptionSignal {
  type:
    | "section"
    | "transition"
    | "energy_change"
    | "silence"
    | "onset"
    | "tempo_change"
    | "vocal_presence"
    | "instrumental_presence"
    | "unknown";
  trackId: string;
  sessionId: string;
  timestampMs: number;
  confidence: number;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface MusicPerceptionContext {
  trackId: string;
  sessionId: string;
  positionMs: number;
  structure?: {
    section?: string;
    sectionStartMs?: number;
    sectionEndMs?: number;
    previousSection?: string;
    nextSection?: string;
  };
  audioHooks?: {
    energy?: number;
    tempo?: number;
    loudness?: number;
  };
  signals?: MusicPerceptionSignal[];
  sources?: string[];
  recentMoments?: MusicalMoment[];
  confidence: number;
  observedAt: number;
}

export interface MusicIntentPayload {
  query?: string;
  mood?: string;
  energy?: string;
  genre?: string;
  activity?: string;
  intent?: "explicit_song" | "mood_based" | "contextual" | "similar" | "preference_based";
}

export interface MusicTemporalEvent {
  id: string;
  sessionId: string;
  trackId?: string;
  type:
    | "track_started"
    | "track_paused"
    | "track_resumed"
    | "track_seeked"
    | "track_changed"
    | "track_ended"
    | "section_changed"
    | "user_utterance"
    | "aura_response";
  timestamp: number; // wall-clock timestamp (Date.now())
  mediaTime?: number; // seconds into current track
  metadata?: Record<string, any>;
}

export interface PlaybackStateData {
  currentTrack: Track | null;
  isPlaying: boolean;
  isPaused: boolean;
  isBuffering: boolean;
  isLoading: boolean;
  hasFailed: boolean;
  failureReason?: string;
  positionMs: number;
  durationMs: number;
  volume: number;
  isMuted: boolean;
  repeatMode: "off" | "track" | "queue";
  isShuffled: boolean;
  queue: Track[];
  history: Track[];
  providerId: string | null;
  audioUnlockState: "unknown" | "unlocked" | "blocked" | "failed";
  pendingTrack: Track | null;
  musicSessionId: string | null;
  temporalEvents: MusicTemporalEvent[];
  perception?: MusicPerceptionContext;
}

export function isValidMediaUrl(url?: string | null): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  if (
    !trimmed.startsWith("http://") &&
    !trimmed.startsWith("https://") &&
    !trimmed.startsWith("blob:")
  )
    return false;
  if (trimmed.includes("youtube.com/watch") || trimmed.includes("youtu.be/")) return false;
  return true;
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
  getAudioElement?(): HTMLMediaElement | null;
  unlockAudio(): Promise<void>;
  dispose(): Promise<void>;
}

export interface MusicProvider extends SearchProvider, PlaybackProvider {}

export interface MusicPerceptionProvider {
  id: string;
  initialize(track: Track, sessionId: string): void;
  setAudioSource?(audio: HTMLMediaElement): void;
  update(positionMs: number): MusicPerceptionSignal | null;
  getCurrentContext(): MusicPerceptionContext | null;
  deactivate(): void;
  dispose(): void;
}
