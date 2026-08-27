import { SearchProvider, PlaybackProvider, Track } from "./types";
import { queueManager } from "./QueueManager";
import { playbackState } from "./PlaybackState";
import { YouTubeSearchProvider } from "./providers/YouTubeSearchProvider";
import { YtDlpProvider } from "./providers/YtDlpProvider";
import { HTMLAudioPlaybackProvider } from "./providers/HTMLAudioPlaybackProvider";
import { bufferMusicEvent } from "../lib/behavior-client";
import { musicEvents } from "./PlaybackEvents";

export class MusicService {
  private searchProvider: SearchProvider;
  private playbackProvider: PlaybackProvider;

  private previousVolume: number | null = null;
  private isDucked: boolean = false;
  private activeProviderId: string = "youtube";
  private lastObservedTrackId: string | null = null;

  constructor() {
    // Default to YouTube Providers
    this.searchProvider = new YouTubeSearchProvider();
    this.playbackProvider = new HTMLAudioPlaybackProvider();
  }

  async initialize() {
    // Read previous provider from local storage if available
    const savedProvider = localStorage.getItem('aura_music_connected_provider');
    if (savedProvider && (savedProvider === 'youtube' || savedProvider === 'youtube_music')) {
      this.activeProviderId = savedProvider;
    }
    
    // Initialization is silent, no Auth required up front.
    await this.searchProvider.initialize();
    await this.playbackProvider.initialize();
    playbackState.update({ providerId: this.activeProviderId });
    
    // Subscribe to state changes for context buffering
    musicEvents.on('stateChanged', (state) => {
      if (state.isPlaying && state.currentTrack && state.currentTrack.id !== this.lastObservedTrackId) {
        this.lastObservedTrackId = state.currentTrack.id;
        bufferMusicEvent('track_started', state.currentTrack.artist || 'Unknown', state.currentTrack.title);
      }
    });

    console.log(
      `[MusicService] Initialized with ${this.searchProvider.name} and ${this.playbackProvider.name}`,
    );
  }

  getAvailableProviders() {
    return [
      { id: "youtube", name: "YouTube", capabilities: ["oauth", "native_playback"] },
      { id: "youtube_music", name: "YouTube Music", capabilities: ["oauth", "native_playback"] },
      { id: "ytdlp", name: "Public Search (yt-dlp)", capabilities: ["raw_stream"] },
    ];
  }

  async switchProvider(providerId: string) {
    console.log(`[MusicService] Switching provider to ${providerId}`);
    this.activeProviderId = providerId;
    
    if (providerId === 'ytdlp') {
      this.searchProvider = new YtDlpProvider();
    } else {
      this.searchProvider = new YouTubeSearchProvider();
    }
    await this.searchProvider.initialize();
    
    playbackState.update({ providerId });
    localStorage.setItem('aura_music_connected_provider', providerId);
  }

  // --- Coordination: Aura Intelligence Entry Points ---
  async processIntent(intent: { type: string; query?: string; text?: string; level?: number }) {
    console.log(`[MusicService] Processing intent:`, intent);
    switch (intent.type) {
      case "play":
        if (intent.query) {
          const results = await this.search(intent.query);
          if (results.length > 0) {
            await this.playTrack(results[0]);
          }
        }
        break;
      case "pause":
        await this.pause();
        break;
      case "resume":
        await this.resume();
        break;
      case "stop":
        await this.pause();
        break;
      case "next":
        await this.next();
        break;
      case "previous":
        await this.previous();
        break;
    }
  }

  // --- Search Pipeline ---
  async search(query: string): Promise<Track[]> {
    const results = await this.searchProvider.search(query);
    return results.map(track => ({
      ...track,
      source: this.activeProviderId
    }));
  }

  // --- Playback Pipeline ---
  async playTrack(track: Track) {
    queueManager.addTrack(track, true);
    queueManager.getNext(); // advance

    playbackState.setTrack(track);
    await this.playbackProvider.play(track.id);
  }

  async playQueue(tracks: Track[], startIndex: number = 0) {
    queueManager.setQueue(tracks);
    for (let i = 0; i < startIndex; i++) queueManager.getNext();
    const track = queueManager.getCurrent();
    if (track) {
      playbackState.setTrack(track);
      await this.playbackProvider.play(track.id);
    }
  }

  async pause() {
    await this.playbackProvider.pause();
  }

  async resume() {
    const track = queueManager.getCurrent();
    if (track) {
      await this.playbackProvider.resume();
    }
  }

  async next() {
    const nextTrack = queueManager.getNext();
    if (nextTrack) {
      playbackState.setTrack(nextTrack);
      await this.playbackProvider.play(nextTrack.id);
    }
  }

  async previous() {
    const prevTrack = queueManager.getPrevious();
    if (prevTrack) {
      playbackState.setTrack(prevTrack);
      await this.playbackProvider.play(prevTrack.id);
    }
  }

  async seek(ms: number) {
    await this.playbackProvider.seek(ms);
  }

  async setVolume(volume: number) {
    playbackState.update({ volume });
    await this.playbackProvider.setVolume(volume);
  }

  // --- State & Modifiers ---
  toggleRepeat() {
    const current = playbackState.getState().repeatMode;
    const nextMode = current === "off" ? "queue" : current === "queue" ? "track" : "off";
    playbackState.update({ repeatMode: nextMode });
  }

  toggleShuffle() {
    const isShuffled = !playbackState.getState().isShuffled;
    if (isShuffled) {
      queueManager.shuffle();
    }
    playbackState.update({ isShuffled });
  }

  // --- Audio Ducking / Voice Overlay ---
  async onAuraSpeechStart() {
    if (this.isDucked) return;
    const state = playbackState.getState();
    if (!state.isPlaying) return;
    this.previousVolume = state.volume;
    this.isDucked = true;
    await this.playbackProvider.setVolume(Math.max(0, state.volume * 0.2));
  }

  async onAuraSpeechEnd() {
    if (!this.isDucked) return;
    this.isDucked = false;
    if (this.previousVolume !== null) {
      await this.playbackProvider.setVolume(this.previousVolume);
      this.previousVolume = null;
    }
  }

  async onUserSpeechStart() {
    await this.onAuraSpeechStart();
  }
}

export const musicService = new MusicService();
