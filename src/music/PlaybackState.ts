import { PlaybackStateData, Track, MusicTemporalEvent, MusicPerceptionContext } from "./types";
import { musicEvents } from "./PlaybackEvents";
import { MusicPerceptionOrchestrator } from "./perception/MusicPerceptionOrchestrator";

export class PlaybackState {
  private state: PlaybackStateData = {
    currentTrack: null,
    isPlaying: false,
    isPaused: false,
    isBuffering: false,
    isLoading: false,
    hasFailed: false,
    failureReason: undefined,
    positionMs: 0,
    durationMs: 0,
    volume: 100,
    isMuted: false,
    repeatMode: "off",
    isShuffled: false,
    queue: [],
    history: [],
    providerId: null,
    audioUnlockState: "unknown",
    pendingTrack: null,
    musicSessionId: null,
    temporalEvents: [],
    perception: undefined,
  };

  private orchestrator = new MusicPerceptionOrchestrator();

  setAudioSource(audio: HTMLMediaElement) {
    this.orchestrator.setAudioSource(audio);
  }

  getState(): PlaybackStateData {
    return { ...this.state };
  }

  update(partial: Partial<PlaybackStateData>) {
    this.state = { ...this.state, ...partial };
    musicEvents.emit("stateChanged", this.state);
  }

  addTemporalEvent(event: MusicTemporalEvent) {
    const events = [...this.state.temporalEvents, event];
    // Bound to last 100 events
    const trimmed = events.length > 100 ? events.slice(-100) : events;
    this.update({ temporalEvents: trimmed });
  }

  recordSeek(fromSec: number, toSec: number) {
    this.update({ positionMs: toSec * 1000 });
    const sessionId = this.state.musicSessionId;
    const trackId = this.state.currentTrack?.id;
    if (sessionId) {
      // Avoid duplicates within 500ms
      const lastEvent = this.state.temporalEvents[this.state.temporalEvents.length - 1];
      if (
        lastEvent &&
        lastEvent.type === "track_seeked" &&
        Math.abs(lastEvent.timestamp - Date.now()) < 500 &&
        lastEvent.metadata?.to === Math.round(toSec)
      ) {
        return;
      }
      this.addTemporalEvent({
        id: Math.random().toString(36).substring(2),
        sessionId,
        trackId,
        type: "track_seeked",
        timestamp: Date.now(),
        mediaTime: Math.round(toSec),
        metadata: {
          from: Math.round(fromSec),
          to: Math.round(toSec),
        },
      });
    }
  }

  recordTrackEnded(finalSec?: number) {
    const sessionId = this.state.musicSessionId;
    const trackId = this.state.currentTrack?.id;
    if (sessionId) {
      const mediaTime =
        finalSec !== undefined ? Math.round(finalSec) : Math.round(this.state.positionMs / 1000);
      const hasEnded = this.state.temporalEvents.some(
        (e) => e.sessionId === sessionId && e.type === "track_ended",
      );
      if (!hasEnded) {
        this.addTemporalEvent({
          id: Math.random().toString(36).substring(2),
          sessionId,
          trackId,
          type: "track_ended",
          timestamp: Date.now(),
          mediaTime,
        });
      }
    }
  }

  setTrack(track: Track) {
    if (this.state.currentTrack) {
      this.state.history.push(this.state.currentTrack);
    }
    const newSessionId = "ms_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);

    this.state = {
      ...this.state,
      currentTrack: track,
      musicSessionId: newSessionId,
      positionMs: 0,
      durationMs: track.durationMs,
      isPlaying: false,
      isPaused: false,
      isLoading: true,
      hasFailed: false,
      failureReason: undefined,
    };

    this.orchestrator.initializeSession(track, newSessionId);

    const trackChangedEvent: MusicTemporalEvent = {
      id: Math.random().toString(36).substring(2),
      sessionId: newSessionId,
      trackId: track.id,
      type: "track_changed",
      timestamp: Date.now(),
      mediaTime: 0,
      metadata: { title: track.title, artist: track.artist },
    };

    this.addTemporalEvent(trackChangedEvent);
    musicEvents.emit("trackChanged", track);
  }

  getPerceptionContext(): MusicPerceptionContext | undefined {
    return this.orchestrator.getPerceptionContext();
  }

  getRecentMusicalWindow(): MusicTemporalEvent[] {
    const sessionId = this.state.musicSessionId;
    if (!sessionId) return [];
    return this.state.temporalEvents.filter((e) => e.sessionId === sessionId);
  }

  getCurrentMusicalMoment(): import("./types").MusicalMoment | undefined {
    const track = this.state.currentTrack;
    if (!track || !this.state.musicSessionId) return undefined;

    const perception = this.getPerceptionContext();
    const window = this.getRecentMusicalWindow();

    // Check if the Fusion Engine provided a recent salient moment
    let fusionMoment: import("./types").MusicalMoment | undefined;
    if (perception?.recentMoments && perception.recentMoments.length > 0) {
      fusionMoment = perception.recentMoments[perception.recentMoments.length - 1];
    }

    let trigger: import("./types").MusicalMoment["trigger"] = "unknown";
    let startMs = perception?.structure?.sectionStartMs || 0;
    let confidence = 0.5;

    // We still want to acknowledge manual triggers (seek/resume) if they are newer than the fusion moment
    let manualTriggerEvent: import("./types").MusicTemporalEvent | undefined;
    if (window.length > 0) {
      const reversed = [...window].reverse();
      manualTriggerEvent = reversed.find(
        (e) =>
          e.type === "section_changed" ||
          e.type === "track_seeked" ||
          e.type === "track_started" ||
          e.type === "track_resumed",
      );
    }

    if (
      fusionMoment &&
      (!manualTriggerEvent || fusionMoment.startMs >= manualTriggerEvent.timestamp - 1000)
    ) {
      // Fusion moment is the most relevant
      return {
        ...fusionMoment,
        endMs: this.state.positionMs,
        previousSection: perception?.structure?.previousSection,
        nextSection: perception?.structure?.nextSection,
      };
    }

    if (manualTriggerEvent) {
      if (manualTriggerEvent.type === "section_changed") {
        trigger = "section_change";
        startMs = (manualTriggerEvent.mediaTime || 0) * 1000;
        confidence = 0.9;
      } else if (manualTriggerEvent.type === "track_seeked") {
        trigger = "seek";
        startMs = (manualTriggerEvent.mediaTime || 0) * 1000;
        confidence = 0.8;
      } else if (manualTriggerEvent.type === "track_started") {
        trigger = "track_start";
        startMs = (manualTriggerEvent.mediaTime || 0) * 1000;
        confidence = 0.8;
      } else if (manualTriggerEvent.type === "track_resumed") {
        trigger = "resume";
        startMs = (manualTriggerEvent.mediaTime || 0) * 1000;
        confidence = 0.7;
      }
    }

    return {
      trackId: track.id,
      sessionId: this.state.musicSessionId,
      startMs,
      endMs: this.state.positionMs,
      section: perception?.structure?.section,
      previousSection: perception?.structure?.previousSection,
      nextSection: perception?.structure?.nextSection,
      trigger,
      transition: "unknown_transition",
      salience: 0.1,
      evidence: [],
      sources: ["temporal_history"],
      confidence,
      observedAt: Date.now(),
    };
  }

  setPosition(ms: number) {
    this.update({ positionMs: ms });

    const signals = this.orchestrator.updatePosition(ms);
    const perception = this.getPerceptionContext();
    const prevSection = this.state.perception?.structure?.section;
    const newSection = perception?.structure?.section;

    if (newSection && newSection !== prevSection && this.state.musicSessionId) {
      this.addTemporalEvent({
        id: Math.random().toString(36).substring(2),
        sessionId: this.state.musicSessionId,
        trackId: this.state.currentTrack?.id,
        type: "section_changed",
        timestamp: Date.now(),
        mediaTime: Math.round(ms / 1000),
        metadata: { section: newSection },
      });
    }

    if (perception) {
      // Don't overwrite recentMoments, just let perception context carry it
      // but if other places rely on recentMoment singular, we can still set it.
    }

    this.update({ perception });
  }

  setPlaying(isPlaying: boolean, currentSec?: number) {
    if (currentSec !== undefined) {
      this.update({ positionMs: currentSec * 1000 });
      this.orchestrator.updatePosition(currentSec * 1000);
    }
    const wasPlaying = this.state.isPlaying;
    this.update({
      isPlaying,
      isPaused: !isPlaying,
      isLoading: false,
      isBuffering: false,
    });

    const sessionId = this.state.musicSessionId;
    const trackId = this.state.currentTrack?.id;
    if (sessionId) {
      const mediaTime = Math.round(this.state.positionMs / 1000);
      const eventId = Math.random().toString(36).substring(2);
      if (isPlaying && !wasPlaying) {
        const hasStarted = this.state.temporalEvents.some(
          (e) => e.sessionId === sessionId && e.type === "track_started",
        );
        this.addTemporalEvent({
          id: eventId,
          sessionId,
          trackId,
          type: hasStarted ? "track_resumed" : "track_started",
          timestamp: Date.now(),
          mediaTime,
        });
        musicEvents.emit("playing");
      } else if (!isPlaying && wasPlaying) {
        this.addTemporalEvent({
          id: eventId,
          sessionId,
          trackId,
          type: "track_paused",
          timestamp: Date.now(),
          mediaTime,
        });
        musicEvents.emit("paused");
        this.orchestrator.deactivate();
      }
    }
  }
}

export const playbackState = new PlaybackState();
