import { SearchProvider, PlaybackProvider, Track } from "./types";
import { queueManager } from "./QueueManager";
import { playbackState } from "./PlaybackState";
import { YouTubeSearchProvider } from "./providers/YouTubeSearchProvider";
import { YouTubePlaybackProvider } from "./providers/YouTubePlaybackProvider";

export class MusicService {
  private searchProvider: SearchProvider;
  private playbackProvider: PlaybackProvider;

  private previousVolume: number | null = null;
  private isDucked: boolean = false;

  constructor() {
    // Default to YouTube Providers
    this.searchProvider = new YouTubeSearchProvider();
    this.playbackProvider = new YouTubePlaybackProvider();
  }

  async initialize() {
    // Initialization is silent, no Auth required up front.
    await this.searchProvider.initialize();
    await this.playbackProvider.initialize();
    playbackState.update({ providerId: this.playbackProvider.id });
    console.log(
      `[MusicService] Initialized with ${this.searchProvider.name} and ${this.playbackProvider.name}`,
    );
  }

  getAvailableProviders() {
    return [
      { id: "youtube", name: "YouTube Music", capabilities: ["oauth", "native_playback"] },
      { id: "ytdlp", name: "yt-dlp Extraction", capabilities: ["raw_stream"] },
    ];
  }

  async switchProvider(providerId: string) {
    console.log(
      `[MusicService] Provider switching to ${providerId} is currently stubbed in new architecture.`,
    );
    // Future: implement dynamic swapping of search/playback providers based on ID
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
    return this.searchProvider.search(query);
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
