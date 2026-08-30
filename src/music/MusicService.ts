import { SearchProvider, PlaybackProvider, Track, MusicIntentPayload } from "./types";
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
  private currentVolume: number = 100;
  private fadeInterval: any = null;

  constructor() {
    // Default to YouTube Providers
    this.searchProvider = new YouTubeSearchProvider();
    this.playbackProvider = new HTMLAudioPlaybackProvider();
  }

  async initialize() {
    // Read previous provider from local storage if available
    const savedProvider = localStorage.getItem("aura_music_connected_provider");
    if (savedProvider && (savedProvider === "youtube" || savedProvider === "youtube_music")) {
      this.activeProviderId = savedProvider;
    }

    // Initialization is silent, no Auth required up front.
    await this.searchProvider.initialize();
    await this.playbackProvider.initialize();

    if (this.playbackProvider.getAudioElement) {
      const audioEl = this.playbackProvider.getAudioElement();
      if (audioEl) {
        playbackState.setAudioSource(audioEl);
      }
    }

    this.currentVolume = playbackState.getState().volume || 100;
    playbackState.update({ providerId: this.activeProviderId });

    // Subscribe to state changes for context buffering and queue advancement
    musicEvents.on("stateChanged", (state) => {
      if (
        state.isPlaying &&
        state.currentTrack &&
        state.currentTrack.id !== this.lastObservedTrackId
      ) {
        this.lastObservedTrackId = state.currentTrack.id;
        bufferMusicEvent(
          "track_started",
          state.currentTrack.artist || "Unknown",
          state.currentTrack.title,
        );
      }

      // Auto-advance queue when a track legitimately finishes
      if (
        !state.isPlaying &&
        this.lastObservedTrackId &&
        !state.isPaused &&
        !state.isLoading &&
        !state.isBuffering
      ) {
        // If it stopped playing but wasn't manually paused, it likely ended naturally.
        // Wait, a better way is to listen for an explicit 'ended' event, but we can do it here:
        // However, HTMLAudioPlaybackProvider just sets isPlaying to false. Let's make it robust by letting HTMLAudioPlaybackProvider call next().
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

    if (providerId === "ytdlp") {
      this.searchProvider = new YtDlpProvider();
    } else {
      this.searchProvider = new YouTubeSearchProvider();
    }
    await this.searchProvider.initialize();

    playbackState.update({ providerId });
    localStorage.setItem("aura_music_connected_provider", providerId);
  }

  private currentIntentId: number = 0;

  // --- Coordination: Aura Intelligence Entry Points ---
  async processIntent(
    intent:
      | ({ type: string; text?: string; level?: number } & Partial<MusicIntentPayload>)
      | { type: "pause" | "resume" | "stop" | "next" | "previous" },
  ) {
    console.log(`[MusicService] Processing intent:`, intent);
    const intentId = ++this.currentIntentId;

    switch (intent.type) {
      case "play":
        const playIntent = intent as { type: "play" } & Partial<MusicIntentPayload>;
        let finalQuery = playIntent.query || "";

        // Formulate a semantic search query if none was provided
        if (!finalQuery) {
          const parts = [];
          if (playIntent.mood) parts.push(playIntent.mood);
          if (playIntent.activity) parts.push(playIntent.activity);
          if (playIntent.genre) parts.push(playIntent.genre);
          if (parts.length > 0) {
            finalQuery = parts.join(" ") + " music";
          }
        }

        if (finalQuery) {
          const results = await this.search(finalQuery);
          if (this.currentIntentId !== intentId) {
            console.log(`[MusicService] Stale play intent ignored for query: ${finalQuery}`);
            return;
          }
          if (results.length > 0) {
            const bestTrack = this.rankTracks(results, playIntent);
            if (playIntent.mood) bestTrack.mood = playIntent.mood;
            if (playIntent.energy) bestTrack.energy = playIntent.energy;
            if (playIntent.genre) bestTrack.genre = playIntent.genre;
            if (playIntent.activity) bestTrack.activity = playIntent.activity;
            await this.playTrack(bestTrack);
          } else {
            throw new Error(`No music found for search: ${finalQuery}`);
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

  // --- Ranking Pipeline ---
  private rankTracks(tracks: Track[], intent: Partial<MusicIntentPayload>): Track {
    if (tracks.length === 0) throw new Error("No tracks to rank");

    const history = playbackState.getState().history.map((t) => t.id);

    const scoredTracks = tracks.map((track) => {
      let score = 100;
      let reasons: string[] = [];

      // Keyword match heuristic against title
      const title = track.title.toLowerCase();

      if (intent.intent === "explicit_song") {
        score += 50;
        reasons.push("Explicit intent bonus");
      }

      if (intent.mood && title.includes(intent.mood.toLowerCase())) {
        score += 20;
        reasons.push(`Mood match: ${intent.mood}`);
      }
      if (intent.activity && title.includes(intent.activity.toLowerCase())) {
        score += 20;
        reasons.push(`Activity match: ${intent.activity}`);
      }
      if (intent.genre && title.includes(intent.genre.toLowerCase())) {
        score += 20;
        reasons.push(`Genre match: ${intent.genre}`);
      }

      // Penalize recent repeats
      if (history.includes(track.id)) {
        score -= 50;
        reasons.push("Recent repeat penalty");
      }

      return { track, score, reasons };
    });

    // Sort descending by score
    scoredTracks.sort((a, b) => b.score - a.score);

    const best = scoredTracks[0];
    console.log(
      `[MusicService] Ranked tracks. Selected '${best.track.title}' with score ${best.score}. Reasons: ${best.reasons.join(", ")}`,
    );

    return best.track;
  }

  // --- Search Pipeline ---
  async search(query: string): Promise<Track[]> {
    const results = await this.searchProvider.search(query);
    return results.map((track) => ({
      ...track,
      source: this.activeProviderId,
    }));
  }

  // --- Playback Pipeline ---
  async playTrack(track: Track) {
    console.log(
      `[MusicService] playTrack initiated for trackId=${track.id} title="${track.title}"`,
    );
    queueManager.addTrack(track, true);
    queueManager.getNext(); // advance

    playbackState.setTrack(track);
    const volume = playbackState.getState().volume;
    this.currentVolume = this.isDucked ? Math.max(0, Math.round(volume * 0.2)) : volume;
    try {
      await this.playbackProvider.setVolume(this.currentVolume);
      await this.playbackProvider.play(track.id);
    } catch (err: any) {
      console.error(`[MusicService] playTrack failed for trackId=${track.id}:`, err);
      playbackState.update({
        isPlaying: false,
        isLoading: false,
        hasFailed: true,
        failureReason: err.message || "Playback failed",
      });
      throw err;
    }
  }

  async playQueue(tracks: Track[], startIndex: number = 0) {
    queueManager.setQueue(tracks);
    for (let i = 0; i < startIndex; i++) queueManager.getNext();
    const track = queueManager.getCurrent();
    if (track) {
      playbackState.setTrack(track);
      const volume = playbackState.getState().volume;
      this.currentVolume = this.isDucked ? Math.max(0, Math.round(volume * 0.2)) : volume;
      await this.playbackProvider.setVolume(this.currentVolume);
      await this.playbackProvider.play(track.id);
    }
  }

  async pause() {
    await this.playbackProvider.pause();
  }

  async resume() {
    const track = queueManager.getCurrent();
    if (track) {
      const volume = playbackState.getState().volume;
      this.currentVolume = this.isDucked ? Math.max(0, Math.round(volume * 0.2)) : volume;
      await this.playbackProvider.setVolume(this.currentVolume);
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
    if (this.isDucked) {
      this.previousVolume = volume;
      this.currentVolume = Math.max(0, Math.round(volume * 0.2));
      await this.playbackProvider.setVolume(this.currentVolume);
    } else {
      this.currentVolume = volume;
      await this.playbackProvider.setVolume(volume);
    }
  }

  async unlockAudio() {
    if (this.playbackProvider.unlockAudio) {
      await this.playbackProvider.unlockAudio();
    }
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

  private async fadeVolume(targetVolume: number, durationMs: number = 250) {
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }

    const steps = 10;
    const intervalMs = durationMs / steps;
    const volumeDelta = (targetVolume - this.currentVolume) / steps;
    let stepCount = 0;

    return new Promise<void>((resolve) => {
      this.fadeInterval = setInterval(async () => {
        stepCount++;
        this.currentVolume = Math.max(0, Math.min(100, this.currentVolume + volumeDelta));
        await this.playbackProvider.setVolume(this.currentVolume);

        if (stepCount >= steps) {
          clearInterval(this.fadeInterval);
          this.fadeInterval = null;
          this.currentVolume = targetVolume;
          await this.playbackProvider.setVolume(this.currentVolume);
          resolve();
        }
      }, intervalMs);
    });
  }

  // --- Audio Ducking / Voice Overlay ---
  async onMicActive() {
    console.log("[MusicService] Microphone active/armed. Volume maintained.");
    if (this.isDucked) {
      await this.onAuraSpeechEnd();
    }
  }

  async onAuraSpeechStart() {
    if (this.isDucked) return;
    const state = playbackState.getState();
    this.previousVolume = state.volume;
    this.isDucked = true;
    if (state.isPlaying) {
      const targetVal = Math.max(0, Math.round(state.volume * 0.2));
      await this.fadeVolume(targetVal, 200);
    }
  }

  async onAuraSpeechEnd() {
    if (!this.isDucked) return;
    this.isDucked = false;
    const targetVol =
      this.previousVolume !== null ? this.previousVolume : playbackState.getState().volume;
    await this.fadeVolume(targetVol, 250);
    this.previousVolume = null;
  }

  async onUserSpeechStart() {
    await this.onAuraSpeechStart();
  }
}

export const musicService = new MusicService();
