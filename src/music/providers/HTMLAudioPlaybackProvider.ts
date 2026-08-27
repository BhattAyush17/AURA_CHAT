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
      
      this.audio.addEventListener("playing", () => {
        playbackState.setPlaying(true);
      });
      
      this.audio.addEventListener("pause", () => {
        playbackState.setPlaying(false);
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
        // Note: MusicEngine handleTrackEnded will detect state change or we emit event?
        // PlaybackEngine already polls or relies on state. We could emit an event here if needed,
        // but playbackState updates usually trigger the queue in AURA.
        // Wait, MusicService or PlaybackEngine manages 'next'. 
        // Actually PlaybackEngine has `handleTrackEnded` which we should call, or emit an event.
        // For now we'll just update state.
      });
      
      this.audio.addEventListener("error", (e) => {
        console.error("[HTMLAudioPlaybackProvider] Error:", e);
        playbackState.update({
          isPlaying: false,
          isPaused: false,
          isLoading: false,
          isBuffering: false,
        });
      });
    }
  }

  async play(trackId: string): Promise<void> {
    const state = playbackState.getState();
    const track = state.currentTrack;
    
    if (!track) return;
    
    // If it's a new track, load the URL
    if (track.url && track.url !== this.currentUrl) {
      this.currentUrl = track.url;
      
      // Determine the proxy base
      const proxyBase = ENDPOINTS.health.replace('/health', '');
      const proxyUrl = `${proxyBase}/api/ytmusic/proxy?url=${encodeURIComponent(track.url)}`;
      
      if (this.audio) {
        this.audio.src = proxyUrl;
        this.audio.load();
      }
    }
    
    if (this.audio) {
      try {
        await this.audio.play();
      } catch (e) {
        console.error("[HTMLAudioPlaybackProvider] Playback failed:", e);
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
      this.audio.volume = Math.max(0, Math.min(100, Math.round(volume))) / 100;
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
