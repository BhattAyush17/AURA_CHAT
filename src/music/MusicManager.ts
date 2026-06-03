/**
 * AURA Music System — MusicManager
 * 
 * Central state machine that orchestrates the entire music experience.
 * Coordinates between AudioProvider, PlaybackController, QueueManager,
 * and MusicContextEngine.
 * 
 * Singleton — accessed via MusicManager.getInstance()
 */

import type { MusicState, TrackInfo, PauseReason, IAudioProvider, MusicIntentTag } from "./types";
import { createDefaultMusicState } from "./types";
import { PlaybackController } from "./PlaybackController";
import { QueueManager } from "./QueueManager";
import { MusicContextEngine } from "./MusicContextEngine";
import { YouTubeAudioProvider } from "./providers/YouTubeAudioProvider";

type StateListener = (state: MusicState) => void;

export class MusicManager {
  private static instance: MusicManager | null = null;

  private playback: PlaybackController;
  private queue: QueueManager;
  private context: MusicContextEngine;
  private provider: IAudioProvider;
  private listeners: Set<StateListener> = new Set();

  // YouTube IFrame Player reference (for YouTube-based playback)
  private ytPlayer: any = null;
  private ytPlayerReady: boolean = false;
  private ytPlayerContainer: HTMLDivElement | null = null;
  private ytPendingVideoId: string | null = null;
  private savedYTPosition: number = 0;
  private ytVolume: number = 80; // 0-100 for YT API
  private _state: MusicState;

  private constructor() {
    this.playback = new PlaybackController();
    this.queue = new QueueManager();
    this.context = new MusicContextEngine();
    this.provider = new YouTubeAudioProvider();
    this._state = createDefaultMusicState();

    // Wire playback events
    this.playback.setCallbacks({
      onStateChange: (state) => {
        this._state = { ...state, queue: [...this.queue.queue], queueIndex: this.queue.currentIndex };
        this.notifyListeners();
      },
      onTrackEnd: () => this.handleTrackEnd(),
      onError: (err) => console.error("[MusicManager]", err),
      onTimeUpdate: (pos, dur) => {
        this._state.position = pos;
        this._state.duration = dur;
      },
    });

    // Initialize YouTube IFrame API
    this.initYouTubeAPI();
  }

  static getInstance(): MusicManager {
    if (!MusicManager.instance) {
      MusicManager.instance = new MusicManager();
    }
    return MusicManager.instance;
  }

  // ── State Management ──────────────────────────────────────────────

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  getState(): MusicState {
    if (this.isYouTubeMode()) {
      return {
        ...this._state,
        isPlaying: this.ytPlayerReady && this.ytPlayer?.getPlayerState?.() === 1,
        isPaused: this.ytPlayerReady && this.ytPlayer?.getPlayerState?.() === 2,
        position: this.ytPlayer?.getCurrentTime?.() || 0,
        duration: this.ytPlayer?.getDuration?.() || 0,
        volume: this.ytVolume / 100,
        queue: [...this.queue.queue],
        queueIndex: this.queue.currentIndex,
        repeat: this.queue.repeat,
        shuffle: this.queue.shuffle,
      };
    }
    return {
      ...this.playback.getState(),
      queue: [...this.queue.queue],
      queueIndex: this.queue.currentIndex,
      repeat: this.queue.repeat,
      shuffle: this.queue.shuffle,
    };
  }

  getContextEngine(): MusicContextEngine {
    return this.context;
  }

  // ── Core Playback ─────────────────────────────────────────────────

  async playQuery(query: string): Promise<boolean> {
    console.log(`[MusicManager] 🎵 Searching: "${query}"`);
    const results = await this.provider.search(query);

    if (results.length === 0) {
      console.warn("[MusicManager] No results found for query:", query);
      return false;
    }

    const track = results[0];
    return this.playTrack(track);
  }

  async playTrack(track: TrackInfo): Promise<boolean> {
    console.log(`[MusicManager] ▶️ Playing: ${track.title} — ${track.artist}`);
    
    // Update queue
    this.queue.clear();
    this.queue.add(track);
    this.queue.setIndex(0);

    // Update context
    this.context.onTrackStart(track);

    if (track.source === "youtube") {
      return this.playYouTube(track.id);
    }

    // For non-YouTube providers
    const streamUrl = await this.provider.getStreamUrl(track);
    if (!streamUrl) {
      console.error("[MusicManager] Failed to get stream URL");
      return false;
    }

    this._state.currentTrack = track;
    await this.playback.play(streamUrl, track);
    this.notifyListeners();
    return true;
  }

  pause(reason: PauseReason = "user_requested"): void {
    if (this.isYouTubeMode()) {
      this.savedYTPosition = this.ytPlayer?.getCurrentTime?.() || 0;
      this.ytPlayer?.pauseVideo?.();
      this._state.isPaused = true;
      this._state.isPlaying = false;
      this._state.lastPausedReason = reason;
      this.context.onTrackPause();
      this.notifyListeners();
      return;
    }
    this.playback.pause(reason);
    this.context.onTrackPause();
  }

  resume(): void {
    if (this.isYouTubeMode()) {
      // Seek to saved position if paused by speech
      if (this.savedYTPosition > 0) {
        this.ytPlayer?.seekTo?.(this.savedYTPosition, true);
      }
      this.ytPlayer?.playVideo?.();
      this._state.isPaused = false;
      this._state.isPlaying = true;
      this._state.lastPausedReason = null;
      this.context.onTrackResume();
      this.notifyListeners();
      return;
    }
    this.playback.resume();
    this.context.onTrackResume();
  }

  stop(): void {
    if (this.isYouTubeMode()) {
      this.ytPlayer?.stopVideo?.();
      this.savedYTPosition = 0;
      this._state = createDefaultMusicState();
      this.context.onTrackStop();
      this.notifyListeners();
      return;
    }
    this.playback.stop();
    this.queue.clear();
    this.context.onTrackStop();
  }

  seek(seconds: number): void {
    if (this.isYouTubeMode()) {
      this.ytPlayer?.seekTo?.(seconds, true);
      this.savedYTPosition = seconds;
      this.notifyListeners();
      return;
    }
    this.playback.seek(seconds);
  }

  setVolume(level: number): void {
    const clamped = Math.max(0, Math.min(1, level));
    if (this.isYouTubeMode()) {
      this.ytVolume = Math.round(clamped * 100);
      this.ytPlayer?.setVolume?.(this.ytVolume);
      this._state.volume = clamped;
      this.notifyListeners();
      return;
    }
    this.playback.setVolume(clamped);
  }

  volumeUp(): void {
    const current = this.isYouTubeMode() ? this.ytVolume / 100 : this.playback.getVolume();
    this.setVolume(Math.min(1, current + 0.2));
  }

  volumeDown(): void {
    const current = this.isYouTubeMode() ? this.ytVolume / 100 : this.playback.getVolume();
    this.setVolume(Math.max(0, current - 0.2));
  }

  // ── Queue Navigation ──────────────────────────────────────────────

  async next(): Promise<boolean> {
    const track = this.queue.next();
    if (!track) return false;
    return this.playTrack(track);
  }

  async previous(): Promise<boolean> {
    // If more than 3 seconds into the track, restart instead
    const pos = this.isYouTubeMode()
      ? (this.ytPlayer?.getCurrentTime?.() || 0)
      : this.playback.getPosition();

    if (pos > 3) {
      this.seek(0);
      return true;
    }

    const track = this.queue.previous();
    if (!track) return false;
    return this.playTrack(track);
  }

  // ── VAD Integration ───────────────────────────────────────────────

  /**
   * Called when VAD detects user speech starting.
   * Immediately pauses music with "user_speaking" reason.
   */
  onUserSpeechStart(): void {
    const state = this.getState();
    if (state.isPlaying) {
      console.log("[MusicManager] 🎤 User speaking — pausing music");
      this.pause("user_speaking");
    }
  }

  /**
   * Called when AURA starts speaking. Duck music volume to 15%.
   */
  onAuraSpeechStart(): void {
    const state = this.getState();
    if (state.isPlaying) {
      if (this.isYouTubeMode()) {
        this.ytPlayer?.setVolume?.(15);
      } else {
        this.playback.duckVolume(0.15);
      }
    }
  }

  /**
   * Called when AURA stops speaking. Restore music volume.
   */
  onAuraSpeechEnd(): void {
    const state = this.getState();
    if (state.isPlaying || state.isPaused) {
      if (this.isYouTubeMode()) {
        this.ytPlayer?.setVolume?.(this.ytVolume);
      } else {
        this.playback.restoreVolume();
      }
    }
  }

  // ── Intent Processing ─────────────────────────────────────────────

  /**
   * Process a music intent tag parsed from LLM output.
   */
  async processIntent(intent: MusicIntentTag): Promise<void> {
    switch (intent.type) {
      case "play":
        await this.playQuery(intent.query);
        break;
      case "stop":
        this.stop();
        break;
      case "pause":
        this.pause("user_requested");
        break;
      case "resume":
        this.resume();
        break;
      case "next":
        await this.next();
        break;
      case "previous":
        await this.previous();
        break;
      case "volume":
        this.setVolume(intent.level);
        break;
      case "volume_up":
        this.volumeUp();
        break;
      case "volume_down":
        this.volumeDown();
        break;
      case "association":
        this.context.addAssociation(intent.text);
        break;
      case "emotion":
        this.context.addEmotion(intent.text);
        break;
    }
  }

  // ── Active State Checks ───────────────────────────────────────────

  isActive(): boolean {
    const state = this.getState();
    return state.isPlaying || state.isPaused;
  }

  isPlaying(): boolean {
    return this.getState().isPlaying;
  }

  getCurrentTrack(): TrackInfo | null {
    return this._state.currentTrack;
  }

  /**
   * Build LLM context injection for active music.
   */
  buildContextInjection(): string {
    return this.context.buildContextInjection();
  }

  // ── YouTube IFrame Player ─────────────────────────────────────────

  private isYouTubeMode(): boolean {
    return this._state.currentTrack?.source === "youtube" && this.ytPlayerReady;
  }

  private initYouTubeAPI(): void {
    if (typeof window === "undefined") return;

    // Only load once
    if ((window as any).YT && (window as any).YT.Player) {
      return;
    }

    // Set callback before loading script
    (window as any).onYouTubeIframeAPIReady = () => {
      console.log("[MusicManager] YouTube IFrame API ready");
      if (this.ytPendingVideoId) {
        this.createYTPlayer(this.ytPendingVideoId);
        this.ytPendingVideoId = null;
      }
    };

    // Load YouTube IFrame API script
    if (!document.getElementById("yt-iframe-api")) {
      const tag = document.createElement("script");
      tag.id = "yt-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  }

  private playYouTube(videoId: string): boolean {
    this._state.currentTrack = this.queue.currentTrack;

    if (this.ytPlayer && this.ytPlayerReady) {
      this.ytPlayer.loadVideoById(videoId);
      this._state.isPlaying = true;
      this._state.isPaused = false;
      this.notifyListeners();
      return true;
    }

    // API not ready yet — queue the request
    if ((window as any).YT && (window as any).YT.Player) {
      this.createYTPlayer(videoId);
      return true;
    }

    this.ytPendingVideoId = videoId;
    this.initYouTubeAPI();
    this.notifyListeners();
    return true;
  }

  private createYTPlayer(videoId: string): void {
    // Create container if it doesn't exist
    if (!this.ytPlayerContainer) {
      this.ytPlayerContainer = document.createElement("div");
      this.ytPlayerContainer.id = "aura-yt-player";
      this.ytPlayerContainer.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;";
      document.body.appendChild(this.ytPlayerContainer);
    }

    try {
      this.ytPlayer = new (window as any).YT.Player("aura-yt-player", {
        height: "1",
        width: "1",
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          // Mobile Compatibility Fixes
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            this.ytPlayerReady = true;
            this.ytPlayer.setVolume(this.ytVolume);
            this._state.isPlaying = true;
            this._state.isPaused = false;
            this._state.duration = this.ytPlayer.getDuration() || 0;
            this.notifyListeners();
            console.log("[MusicManager] ▶️ YouTube player ready and playing");

            // Start position polling
            this.startYTPositionPolling();
          },
          onStateChange: (event: any) => {
            const YT_STATES: Record<number, string> = {
              [-1]: "unstarted",
              0: "ended",
              1: "playing",
              2: "paused",
              3: "buffering",
              5: "cued",
            };
            console.log(`[MusicManager] YT state: ${YT_STATES[event.data] || event.data}`);

            if (event.data === 0) {
              // Video ended
              this.handleTrackEnd();
            } else if (event.data === 1) {
              this._state.isPlaying = true;
              this._state.isPaused = false;
              this._state.duration = this.ytPlayer.getDuration() || 0;
              // Update track info from YT data
              if (this._state.currentTrack) {
                const videoData = this.ytPlayer.getVideoData?.();
                if (videoData?.title) {
                  this._state.currentTrack.title = videoData.title;
                }
                if (videoData?.author) {
                  this._state.currentTrack.artist = videoData.author;
                }
              }
              this.notifyListeners();
            } else if (event.data === 2) {
              this._state.isPlaying = false;
              this._state.isPaused = true;
              this.notifyListeners();
            }
          },
          onError: (event: any) => {
            console.error("[MusicManager] YouTube player error:", event.data);
            this._state.isPlaying = false;
            this._state.isPaused = false;
            this.notifyListeners();
          },
        },
      });
    } catch (err) {
      console.error("[MusicManager] Failed to create YouTube player:", err);
    }
  }

  private ytPositionInterval: ReturnType<typeof setInterval> | null = null;

  private startYTPositionPolling(): void {
    this.stopYTPositionPolling();
    this.ytPositionInterval = setInterval(() => {
      if (this.ytPlayer && this.ytPlayerReady) {
        this._state.position = this.ytPlayer.getCurrentTime?.() || 0;
        this._state.duration = this.ytPlayer.getDuration?.() || 0;
        // Notify sparingly (every 1s) to avoid performance overhead
      }
    }, 1000);
  }

  private stopYTPositionPolling(): void {
    if (this.ytPositionInterval) {
      clearInterval(this.ytPositionInterval);
      this.ytPositionInterval = null;
    }
  }

  private handleTrackEnd(): void {
    const nextTrack = this.queue.next();
    if (nextTrack) {
      this.playTrack(nextTrack);
    } else {
      this._state.isPlaying = false;
      this._state.isPaused = false;
      this._state.lastPausedReason = "track_ended";
      this.context.onTrackStop();
      this.stopYTPositionPolling();
      this.notifyListeners();
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  destroy(): void {
    this.playback.destroy();
    this.stopYTPositionPolling();
    if (this.ytPlayer) {
      try { this.ytPlayer.destroy(); } catch {}
    }
    if (this.ytPlayerContainer) {
      this.ytPlayerContainer.remove();
    }
    this.listeners.clear();
    MusicManager.instance = null;
  }
}
