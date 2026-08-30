import { PlaybackProvider, isValidMediaUrl } from "../types";
import { playbackState } from "../PlaybackState";
import { ENDPOINTS } from "@/config/api";
import { playbackTelemetry } from "./playbackTelemetry";

type AudioSourceClass = "unknown" | "blob" | "proxy" | "direct";
type MobileMusicTimelineKind = string;

function classifyAudioSource(url: string | null | undefined): AudioSourceClass {
  if (!url) return "unknown";
  if (url.startsWith("blob:")) return "blob";
  if (url.includes("/api/ytmusic/proxy") || url.includes("/api/music/proxy")) return "proxy";
  // Anything that goes through a backend ytmusic endpoint is also proxy.
  if (url.includes("/api/ytmusic/")) return "proxy";
  return "direct";
}

function recordAudioElementSnapshot(audio: HTMLAudioElement | null): void {
  if (!audio) {
    playbackTelemetry.updateMobileMusicAudioElement({
      present: false,
      paused: null,
      readyState: null,
      networkState: null,
      currentTime: null,
      duration: null,
      crossOrigin: null,
      sourceClass: "unknown",
    });
    return;
  }
  const url = audio.currentSrc || audio.src || null;
  playbackTelemetry.updateMobileMusicAudioElement({
    present: true,
    paused: audio.paused,
    readyState: audio.readyState,
    networkState: audio.networkState,
    currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : null,
    duration: Number.isFinite(audio.duration) ? audio.duration : null,
    crossOrigin:
      audio.crossOrigin === null || audio.crossOrigin === undefined
        ? null
        : String(audio.crossOrigin),
    sourceClass: classifyAudioSource(url),
  });
}

function recordEvent(kind: MobileMusicTimelineKind, note?: string): void {
  try {
    playbackTelemetry.recordMobileMusicTimeline(kind, note);
  } catch {
    /* never let observability crash playback */
  }
}

export class HTMLAudioPlaybackProvider implements PlaybackProvider {
  id = "html_audio_playback";
  name = "HTML5 Audio Playback";

  private audio: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;

  getAudioElement(): HTMLMediaElement | null {
    return this.audio;
  }

  async initialize(): Promise<void> {
    if (!this.audio && typeof window !== "undefined") {
      this.audio = new Audio();
      this.audio.crossOrigin = "anonymous";
      // playsInline is supported on HTMLAudioElement in iOS Safari but not in TS DOM types.
      // Safe to cast as it's a standard property that browsers support.
      (this.audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      this.audio.preload = "auto";

      this.audio.addEventListener("loadedmetadata", () => {
        recordEvent("loadedmetadata");
        recordAudioElementSnapshot(this.audio);
      });

      this.audio.addEventListener("playing", () => {
        playbackState.setPlaying(true, this.audio?.currentTime);
        playbackState.update({ hasFailed: false, failureReason: undefined });
        recordEvent("playing");
        recordAudioElementSnapshot(this.audio);
        // iOS-specific: track whether AudioContext was resumed during/after a
        // play() that followed a user gesture. The orchestrator already
        // exposes the AudioContext state separately; here we just observe that
        // a play() round-trip resolved successfully inside the gesture chain.
        const audio = this.audio;
        if (audio && !audio.paused) {
          // The user has both gestured and the audio element is now playing.
          playbackTelemetry.updateMobileMusicGesture({
            playResolvedAfterGesture:
              playbackTelemetry.getMobileMusicPipeline().gesture.lastGestureAt != null,
          });
        }
        import("@/runtime/RuntimeTelemetry").then(({ RuntimeTelemetry }) => {
          RuntimeTelemetry.getInstance().logEvent({
            subsystem: "Music",
            severity: "info",
            data: { event: "PlaybackStarted", url: this.currentUrl },
          });
        });
      });

      this.audio.addEventListener("pause", () => {
        playbackState.setPlaying(false, this.audio?.currentTime);
        recordEvent("pause");
        recordAudioElementSnapshot(this.audio);
        import("@/runtime/RuntimeTelemetry").then(({ RuntimeTelemetry }) => {
          RuntimeTelemetry.getInstance().logEvent({
            subsystem: "Music",
            severity: "info",
            data: { event: "PlaybackPaused" },
          });
        });
      });

      this.audio.addEventListener("timeupdate", () => {
        if (this.audio) {
          playbackState.setPosition(this.audio.currentTime * 1000);
          // Cheap, throttled state snapshot for the panel.
          recordAudioElementSnapshot(this.audio);
        }
      });

      let isSeeking = false;
      let seekStartMediaTime = 0;

      this.audio.addEventListener("seeking", () => {
        if (!isSeeking && this.audio) {
          isSeeking = true;
          seekStartMediaTime = this.audio.currentTime;
        }
        recordEvent("seeking");
      });

      this.audio.addEventListener("seeked", () => {
        if (this.audio) {
          isSeeking = false;
          playbackState.recordSeek(seekStartMediaTime, this.audio.currentTime);
          recordEvent("seeked", `to ${this.audio.currentTime.toFixed(2)}s`);
        }
      });

      this.audio.addEventListener("waiting", () => {
        playbackState.update({ isBuffering: true, isLoading: false });
        recordEvent("waiting");
      });

      this.audio.addEventListener("stalled", () => {
        recordEvent("stalled");
      });

      this.audio.addEventListener("canplay", () => {
        playbackState.update({ isBuffering: false, isLoading: false });
        recordEvent("canplay");
        recordAudioElementSnapshot(this.audio);
      });

      this.audio.addEventListener("ended", () => {
        const finalTime =
          this.audio?.duration && isFinite(this.audio.duration)
            ? this.audio.duration
            : this.audio?.currentTime;
        playbackState.recordTrackEnded(finalTime);
        playbackState.setPlaying(false, finalTime);
        recordEvent("ended");
        recordAudioElementSnapshot(this.audio);
        import("@/runtime/RuntimeTelemetry").then(({ RuntimeTelemetry }) => {
          RuntimeTelemetry.getInstance().logEvent({
            subsystem: "Music",
            severity: "info",
            data: { event: "PlaybackEnded" },
          });
        });
        // Explicitly advance the queue when the track completes naturally
        import("../MusicService").then(({ musicService }) => {
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
              data: { event: "HTML5VolumeChangeDetected", volume: currentVol },
            });
          });
        }
      });

      this.audio.addEventListener("error", (e) => {
        console.error("[HTMLAudioPlaybackProvider] Native HTMLAudioElement Error:", e);
        playbackState.update({
          isPlaying: false,
          isPaused: false,
          isLoading: false,
          isBuffering: false,
          hasFailed: true,
          failureReason: "HTMLAudioElement media loading error",
        });
        const err: any = (e as unknown as { error?: unknown }).error;
        const note = err ? `name=${err.name || "?"} code=${err.code ?? "?"}` : undefined;
        recordEvent("error", note);
        recordAudioElementSnapshot(this.audio);
        import("@/runtime/RuntimeTelemetry").then(({ RuntimeTelemetry }) => {
          RuntimeTelemetry.getInstance().logEvent({
            subsystem: "Music",
            severity: "error",
            data: { event: "PlaybackError", error: "Audio playback error" },
          });
        });
      });
    }

    recordAudioElementSnapshot(this.audio);
  }

  async play(trackId: string): Promise<void> {
    const state = playbackState.getState();
    const track = state.currentTrack;

    if (!track) return;

    if (!isValidMediaUrl(track.url)) {
      console.error("[MUSIC_ERROR] Music track has no playable audio source or URL is invalid.");
      playbackState.update({
        isPlaying: false,
        isLoading: false,
        hasFailed: true,
        failureReason: "Music track has no playable audio source",
      });
      throw new Error("Music track has no playable audio source.");
    }

    // If it's a new track, load the URL
    if (track.url !== this.currentUrl) {
      this.currentUrl = track.url ?? null;

      if (this.audio) {
        this.audio.src = track.url ?? "";
        this.audio.load();
      }
    }

    if (this.audio) {
      try {
        console.log("[MUSIC_PLAY] starting audio element playback");
        recordEvent("play_requested");
        await this.audio.play();
        recordEvent("play_resolved");
        // After a successful play() we know that a user gesture must have
        // occurred upstream (otherwise play() would have rejected). Snapshot
        // the audio element so the panel can show currentTime advancing.
        recordAudioElementSnapshot(this.audio);
      } catch (e: any) {
        recordEvent("play_rejected", `name=${e?.name || "?"}`);
        recordAudioElementSnapshot(this.audio);
        if (e.name === "NotAllowedError") {
          console.warn("[MUSIC_PLAY] browser rejected playback: NotAllowedError");
          playbackState.update({
            isPlaying: false,
            isLoading: false,
            hasFailed: true,
            failureReason: "Playback requires user interaction",
            audioUnlockState: "blocked",
            pendingTrack: track,
          });
          throw new Error("Playback requires user interaction.");
        } else if (e.name === "NotSupportedError") {
          console.error("[MUSIC_PLAY] browser rejected playback: NotSupportedError");
          playbackState.update({
            isPlaying: false,
            isLoading: false,
            hasFailed: true,
            failureReason: "Format or stream source not supported",
          });
          throw new Error("Music track has no playable audio source.");
        } else {
          console.error("[HTMLAudioPlaybackProvider] Playback failed:", e);
          playbackState.update({
            isPlaying: false,
            isLoading: false,
            hasFailed: true,
            failureReason: e.message || "Playback failed",
          });
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
          data: { event: "VolumeChanged", targetVolume: volume, targetVolumeFloat: volumeFloat },
        });
      });
    }
  }

  async unlockAudio(): Promise<void> {
    if (this.audio) {
      try {
        // unlockAudio is itself invoked from a user gesture in the UI.
        playbackTelemetry.updateMobileMusicGesture({ lastGestureAt: Date.now() });
        recordEvent("user_gesture", "unlockAudio");
        this.audio.muted = true;
        await this.audio.play();
        this.audio.pause();
        this.audio.muted = false;

        playbackState.update({ audioUnlockState: "unlocked" });

        const state = playbackState.getState();
        if (state.pendingTrack) {
          const track = state.pendingTrack;
          playbackState.update({ pendingTrack: null });
          import("../MusicService").then(({ musicService }) => {
            musicService
              .playTrack(track)
              .catch((e) => console.error("Resume pending track failed", e));
          });
        }
      } catch (e) {
        console.warn("[HTMLAudioPlaybackProvider] unlockAudio failed:", e);
        recordEvent("play_rejected", `name=${(e as { name?: string } | undefined)?.name || "?"}`);
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    this.currentUrl = null;
  }
}
