import { PlaybackProvider } from "../types";
import { playbackState } from "../PlaybackState";
import { ENDPOINTS } from "@/config/api";

export class HTMLAudioPlaybackProvider implements PlaybackProvider {
  id = "html_audio_playback";
  name = "HTML5 Audio Playback";
  
  private audio: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;

  async initialize(): Promise<void> {
    if (!this.audio && typeof window !== "undefined") {
      this.audio = new Audio();
      this.audio.crossOrigin = "anonymous";
      this.audio.playsInline = true;
      this.audio.preload = "auto";
      
      this.audio.addEventListener("playing", () => {
        playbackState.setPlaying(true);
        import("@/runtime/RuntimeTelemetry").then(({ RuntimeTelemetry }) => {
          RuntimeTelemetry.getInstance().logEvent({
            subsystem: "Music",
            severity: "info",
            data: { event: "PlaybackStarted", url: this.currentUrl }
          });
        });
      });
      
      this.audio.addEventListener("pause", () => {
        playbackState.setPlaying(false);
        import("@/runtime/RuntimeTelemetry").then(({ RuntimeTelemetry }) => {
          RuntimeTelemetry.getInstance().logEvent({
            subsystem: "Music",
            severity: "info",
            data: { event: "PlaybackPaused" }
          });
        });
      });
      
      this.audio.addEventListener("timeupdate", () => {
        if (this.audio) {
          playbackState.setPosition(this.audio.currentTime * 1000);
        }
      });
      
      this.audio.addEventListener("waiting", () => {
        playbackState.update({ isBuffering: true, isLoading: false });
      });
      
      this.audio.addEventListener("canplay", () => {
        playbackState.update({ isBuffering: false, isLoading: false });
      });
      
      this.audio.addEventListener("ended", () => {
        playbackState.setPlaying(false);
        import("@/runtime/RuntimeTelemetry").then(({ RuntimeTelemetry }) => {
          RuntimeTelemetry.getInstance().logEvent({
            subsystem: "Music",
            severity: "info",
            data: { event: "PlaybackEnded" }
          });
        });
        // Explicitly advance the queue when the track completes naturally
        import('../MusicService').then(({ musicService }) => {
          musicService.next();
        });
      });
      
      this.audio.addEventListener("volumechange", () => {
        if (this.audio) {
          const currentVol = this.audio.volume;
          import("@/runtime/RuntimeTelemetry").then(({ RuntimeTelemetry }) => {
            RuntimeTelemetry.getInstance().logEvent({
              subsystem: "Music",
              severity: "info",
              data: { event: "HTML5VolumeChangeDetected", volume: currentVol }
            });
          });
        }
      });

      this.audio.addEventListener("error", (e) => {
        console.error("[HTMLAudioPlaybackProvider] Error:", e);
        playbackState.update({
          isPlaying: false,
          isPaused: false,
          isLoading: false,
          isBuffering: false,
        });
        import("@/runtime/RuntimeTelemetry").then(({ RuntimeTelemetry }) => {
          RuntimeTelemetry.getInstance().logEvent({
            subsystem: "Music",
            severity: "error",
            data: { event: "PlaybackError", error: "Audio playback error" }
          });
        });
      });
    }
  }

  async play(trackId: string): Promise<void> {
    const state = playbackState.getState();
    const track = state.currentTrack;
    
    if (!track) return;
    
    if (!track.url) {
      console.error("[MUSIC_ERROR] Music track has no playable audio source.");
      throw new Error("Music track has no playable audio source.");
    }

    // If it's a new track, load the URL
    if (track.url !== this.currentUrl) {
      this.currentUrl = track.url;
      
      if (this.audio) {
        this.audio.src = track.url;
        this.audio.load();
      }
    }
    
    if (this.audio) {
      try {
        console.log("[MUSIC_PLAY] starting audio");
        await this.audio.play();
      } catch (e: any) {
        if (e.name === "NotAllowedError") {
          console.warn("[MUSIC_PLAY] browser rejected playback: NotAllowedError");
          playbackState.update({ isPlaying: false, audioUnlockState: "blocked", pendingTrack: track });
          throw new Error("Playback requires user interaction.");
        } else if (e.name === "NotSupportedError") {
          console.error("[MUSIC_PLAY] browser rejected playback: NotSupportedError");
          playbackState.update({ isPlaying: false });
          throw new Error("Music track has no playable audio source.");
        } else {
          console.error("[HTMLAudioPlaybackProvider] Playback failed:", e);
          playbackState.update({ isPlaying: false });
          throw e;
        }
      }
    }
  }

  async pause(): Promise<void> {
    if (this.audio) {
      this.audio.pause();
    }
  }

  async resume(): Promise<void> {
    if (this.audio) {
      try {
        await this.audio.play();
      } catch (e) {
        console.error("[HTMLAudioPlaybackProvider] Resume failed:", e);
      }
    }
  }

  async seek(positionMs: number): Promise<void> {
    if (this.audio) {
      this.audio.currentTime = positionMs / 1000;
    }
  }

  async setVolume(volume: number): Promise<void> {
    if (this.audio) {
      const volumeFloat = Math.max(0, Math.min(100, Math.round(volume))) / 100;
      this.audio.volume = volumeFloat;
      
      import("@/runtime/RuntimeTelemetry").then(({ RuntimeTelemetry }) => {
        RuntimeTelemetry.getInstance().logEvent({
          subsystem: "Music",
          severity: "info",
          data: { event: "VolumeChanged", targetVolume: volume, targetVolumeFloat: volumeFloat }
        });
      });
    }
  }

  async unlockAudio(): Promise<void> {
    if (this.audio) {
      try {
        this.audio.muted = true;
        await this.audio.play();
        this.audio.pause();
        this.audio.muted = false;
        
        playbackState.update({ audioUnlockState: "unlocked" });
        
        const state = playbackState.getState();
        if (state.pendingTrack) {
          const track = state.pendingTrack;
          playbackState.update({ pendingTrack: null });
          import('../MusicService').then(({ musicService }) => {
            musicService.playTrack(track).catch(e => console.error("Resume pending track failed", e));
          });
        }
      } catch (e) {
        console.warn("[HTMLAudioPlaybackProvider] unlockAudio failed:", e);
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = null;
    }
    this.currentUrl = null;
  }
}
