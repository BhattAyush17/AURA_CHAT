/**
 * AURA Music System — PlaybackController
 * 
 * Single authority over audio playback state. Wraps HTMLAudioElement
 * and manages play/pause/resume/stop/seek/volume operations.
 * 
 * This controller is provider-agnostic — it receives a stream URL
 * and handles all playback mechanics.
 */

import type { MusicState, PauseReason, PlaybackCallbacks, TrackInfo } from "./types";
import { createDefaultMusicState } from "./types";

export class PlaybackController {
  private audio: HTMLAudioElement;
  private state: MusicState;
  private callbacks: PlaybackCallbacks = {};
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  private savedPosition: number = 0;

  constructor() {
    this.state = createDefaultMusicState();
    this.audio = new Audio();
    // this.audio.crossOrigin = "anonymous"; // Disabled: Prevents direct playback of YouTube URLs due to lack of ACAO header
    this.audio.preload = "auto";
    this.audio.playsInline = true; // Mobile iOS fix to prevent fullscreen takeover

    // ── Wire native audio events ──
    this.audio.addEventListener("play", () => {
      this.state.isPlaying = true;
      this.state.isPaused = false;
      this.state.lastPausedReason = null;
      this.startTimeTracking();
      this.emit();
    });

    this.audio.addEventListener("pause", () => {
      this.state.isPlaying = false;
      this.state.isPaused = true;
      this.state.position = this.audio.currentTime;
      this.stopTimeTracking();
      this.emit();
    });

    this.audio.addEventListener("ended", () => {
      this.state.isPlaying = false;
      this.state.isPaused = false;
      this.state.lastPausedReason = "track_ended";
      this.stopTimeTracking();
      this.emit();
      this.callbacks.onTrackEnd?.();
    });

    this.audio.addEventListener("loadedmetadata", () => {
      this.state.duration = this.audio.duration;
      if (this.state.currentTrack) {
        this.state.currentTrack.duration = this.audio.duration;
      }
      this.emit();
    });

    this.audio.addEventListener("error", () => {
      const error = this.audio.error;
      const msg = error ? `Audio error: ${error.message || error.code}` : "Unknown audio error";
      console.error("[PlaybackController]", msg);
      this.state.isPlaying = false;
      this.state.isPaused = false;
      this.stopTimeTracking();
      this.emit();
      this.callbacks.onError?.(msg);
    });
  }

  // ── Public API ──────────────────────────────────────────────────────

  setCallbacks(callbacks: PlaybackCallbacks): void {
    this.callbacks = callbacks;
  }

  async play(streamUrl: string, track: TrackInfo): Promise<void> {
    // Stop any current playback
    this.audio.pause();
    this.stopTimeTracking();

    // Load new track
    this.state.currentTrack = track;
    this.state.source = streamUrl;
    this.state.position = 0;
    this.state.duration = track.duration || 0;
    this.savedPosition = 0;

    console.log(`[PlaybackController] 🎵 Loading: ${track.title} — ${track.artist}`);
    console.log(`[PlaybackController] 🔗 Stream URL: ${streamUrl.substring(0, 80)}...`);

    this.audio.src = streamUrl;
    this.audio.volume = this.state.volume;
    
    try {
      await this.audio.play();
      console.log(`[PlaybackController] ✅ Playback started successfully`);
    } catch (err: any) {
      // MOBILE FIX: Android Chrome blocks autoplay without user gesture.
      // If play() fails with NotAllowedError, wait for the next user interaction
      // to resume playback. AbortError happens when src changes mid-load.
      if (err?.name === "NotAllowedError") {
        console.warn("[PlaybackController] Autoplay blocked by browser. Waiting for user gesture...");
        const resumeOnGesture = async () => {
          try {
            if (this.audio.src && this.audio.paused) {
              await this.audio.play();
              console.log("[PlaybackController] ✅ Resumed after user gesture");
            }
          } catch {}
          document.removeEventListener("touchstart", resumeOnGesture);
          document.removeEventListener("click", resumeOnGesture);
        };
        document.addEventListener("touchstart", resumeOnGesture, { once: true });
        document.addEventListener("click", resumeOnGesture, { once: true });
      } else if (err?.name === "AbortError") {
        // Happens when audio.src is changed while loading — safe to ignore
        console.log("[PlaybackController] Load aborted (track changed rapidly)");
      } else {
        console.error("[PlaybackController] Play failed:", err);
        this.callbacks.onError?.(`Failed to play: ${err}`);
      }
    }
  }

  pause(reason: PauseReason = "user_requested"): void {
    if (!this.state.isPlaying) return;
    this.savedPosition = this.audio.currentTime;
    this.state.lastPausedReason = reason;
    this.audio.pause();
  }

  async resume(): Promise<void> {
    if (!this.state.isPaused || !this.audio.src) return;

    // Seek to saved position if we were paused by speech
    if (this.savedPosition > 0 && Math.abs(this.audio.currentTime - this.savedPosition) > 0.5) {
      this.audio.currentTime = this.savedPosition;
    }

    this.audio.volume = this.state.volume;
    try {
      await this.audio.play();
    } catch (err) {
      console.error("[PlaybackController] Resume failed:", err);
    }
  }

  stop(): void {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.audio.src = "";
    this.savedPosition = 0;
    this.state = createDefaultMusicState();
    this.state.volume = this.getVolume(); // Preserve volume across stops
    this.stopTimeTracking();
    this.emit();
  }

  seek(seconds: number): void {
    if (!this.audio.src) return;
    const clamped = Math.max(0, Math.min(seconds, this.audio.duration || 0));
    this.audio.currentTime = clamped;
    this.state.position = clamped;
    this.savedPosition = clamped;
    this.emit();
  }

  setVolume(level: number): void {
    const clamped = Math.max(0, Math.min(1, level));
    this.state.volume = clamped;
    this.audio.volume = clamped;
    this.emit();
  }

  getVolume(): number {
    return this.state.volume;
  }

  /**
   * Duck volume temporarily (e.g. when AURA is speaking).
   * Does NOT change the stored volume level — only the audio element.
   */
  duckVolume(targetLevel: number): void {
    this.audio.volume = Math.max(0, Math.min(1, targetLevel));
  }

  /**
   * Restore volume to the stored level after ducking.
   */
  restoreVolume(): void {
    this.audio.volume = this.state.volume;
  }

  getPosition(): number {
    return this.audio.currentTime || 0;
  }

  getDuration(): number {
    return this.audio.duration || this.state.duration || 0;
  }

  getState(): Readonly<MusicState> {
    return { ...this.state, position: this.getPosition() };
  }

  isActive(): boolean {
    return this.state.isPlaying || this.state.isPaused;
  }

  getCurrentTrack(): TrackInfo | null {
    return this.state.currentTrack;
  }

  // ── Internal ────────────────────────────────────────────────────────

  private startTimeTracking(): void {
    this.stopTimeTracking();
    this.updateInterval = setInterval(() => {
      this.state.position = this.audio.currentTime;
      this.callbacks.onTimeUpdate?.(this.audio.currentTime, this.audio.duration || 0);
    }, 250); // 4 updates/sec for smooth progress bar
  }

  private stopTimeTracking(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  private emit(): void {
    this.callbacks.onStateChange?.({ ...this.state, position: this.getPosition() });
  }

  destroy(): void {
    this.stop();
    this.stopTimeTracking();
    this.audio.removeAttribute("src");
  }
}
