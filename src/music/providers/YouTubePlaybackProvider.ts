import { PlaybackProvider } from "../types";

import { playbackState } from "../PlaybackState";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export class YouTubePlaybackProvider implements PlaybackProvider {
  id = "youtube_playback";
  name = "YouTube Native Playback";
  private player: any = null;
  private playerReady = false;
  private container: HTMLDivElement | null = null;
  private pendingVideoId: string | null = null;

  async initialize(): Promise<void> {
    await this.loadYTAPI();
  }

  private loadYTAPI(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === "undefined") return resolve();

      if (window.YT && window.YT.Player) {
        this.initPlayer();
        resolve();
        return;
      }

      window.onYouTubeIframeAPIReady = () => {
        this.initPlayer();
        resolve();
      };

      if (!document.getElementById("yt-iframe-api")) {
        const tag = document.createElement("script");
        tag.id = "yt-iframe-api";
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName("script")[0];
        if (firstScriptTag && firstScriptTag.parentNode) {
          firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        } else {
          document.head.appendChild(tag);
        }
      }
    });
  }

  private initPlayer() {
    if (this.container) return; // Already initialized

    this.container = document.createElement("div");
    this.container.id = "aura-yt-player";
    this.container.style.cssText =
      "position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;";
    document.body.appendChild(this.container);

    try {
      this.player = new window.YT.Player("aura-yt-player", {
        height: "1",
        width: "1",
        videoId: this.pendingVideoId || "",
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            this.playerReady = true;
            if (this.pendingVideoId) {
              this.play(this.pendingVideoId);
              this.pendingVideoId = null;
            }
          },
          onStateChange: (event: any) => {
            const state = event.data;
            if (state === -1 || state === 5) {
              playbackState.update({
                isLoading: true,
                isBuffering: false,
                isPlaying: false,
                isPaused: false,
              });
            } else if (state === 0) {
              playbackState.update({
                isPlaying: false,
                isPaused: false,
                isLoading: false,
                isBuffering: false,
              });
            } else if (state === 1) {
              playbackState.update({ isLoading: false, isBuffering: false });
              playbackState.setPlaying(true);
            } else if (state === 2) {
              playbackState.setPlaying(false);
            } else if (state === 3) {
              playbackState.update({ isBuffering: true, isLoading: false });
            }
          },
          onError: (event: any) => {
            console.error("[YouTubePlaybackProvider] Player error", event.data);
            playbackState.update({
              isPlaying: false,
              isPaused: false,
              isLoading: false,
              isBuffering: false,
            });
          },
        },
      });
    } catch (e) {
      console.error("[YouTubePlaybackProvider] Failed to initialize iframe API", e);
    }
  }

  async play(trackId: string): Promise<void> {
    if (!this.playerReady) {
      this.pendingVideoId = trackId;
      return;
    }
    this.player.loadVideoById(trackId);
    this.player.playVideo();
  }

  async pause(): Promise<void> {
    if (this.playerReady && this.player.pauseVideo) {
      this.player.pauseVideo();
    }
  }

  async resume(): Promise<void> {
    if (this.playerReady && this.player.playVideo) {
      this.player.playVideo();
    }
  }

  async seek(positionMs: number): Promise<void> {
    if (this.playerReady && this.player.seekTo) {
      this.player.seekTo(positionMs / 1000, true);
    }
  }

  async setVolume(volume: number): Promise<void> {
    if (this.playerReady && this.player.setVolume) {
      this.player.setVolume(Math.max(0, Math.min(100, Math.round(volume * 100))));
    }
  }

  async dispose(): Promise<void> {
    if (this.player) {
      try {
        this.player.destroy();
      } catch {}
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.playerReady = false;
  }
}
