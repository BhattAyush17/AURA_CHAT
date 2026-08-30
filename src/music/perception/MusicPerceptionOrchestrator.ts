import type {
  MusicPerceptionProvider,
  MusicPerceptionSignal,
  MusicPerceptionContext,
  Track,
} from "../types";
import { ChapterMetadataProvider } from "./ChapterMetadataProvider";
import { WebAudioPerceptionProvider } from "./WebAudioPerceptionProvider";
import { MusicalEvidenceFusion } from "./MusicalEvidenceFusion";
import { perceptionTelemetry } from "./perceptionTelemetry";

export class MusicPerceptionOrchestrator {
  private providers: MusicPerceptionProvider[] = [];

  private currentTrack: Track | null = null;
  private currentSessionId: string | null = null;
  private currentPositionMs = 0;

  private activeSignals: MusicPerceptionSignal[] = [];
  private fusionEngine = new MusicalEvidenceFusion();

  constructor() {
    this.registerProvider(new ChapterMetadataProvider());
    this.registerProvider(new WebAudioPerceptionProvider());
  }

  public registerProvider(provider: MusicPerceptionProvider) {
    this.providers.push(provider);
  }

  public setAudioSource(audio: HTMLMediaElement) {
    for (const provider of this.providers) {
      if (provider.setAudioSource) {
        try {
          provider.setAudioSource(audio);
        } catch (e) {
          console.error(
            `[PerceptionOrchestrator] Provider ${provider.id} setAudioSource error:`,
            e,
          );
        }
      }
    }
  }

  public initializeSession(track: Track, sessionId: string) {
    this.currentTrack = track;
    this.currentSessionId = sessionId;
    this.currentPositionMs = 0;
    this.activeSignals = [];
    this.fusionEngine.clear();

    for (const provider of this.providers) {
      try {
        provider.initialize(track, sessionId);
      } catch (e) {
        console.error(`[PerceptionOrchestrator] Provider ${provider.id} init error:`, e);
      }
    }
    perceptionTelemetry.updateMobileMusicPerception({
      lastContextRebuildAt: Date.now(),
      signalsIn: 0,
      signalsOut: 0,
      lastSignalAt: null,
      lastSignalType: null,
      lifecycle: "inactive",
    });
    perceptionTelemetry.updateMobileMusicEvidence({
      signalsReceived: 0,
      evidenceGenerated: 0,
      momentsGenerated: 0,
      lastMomentAt: null,
      lastSourceCategories: [],
    });
  }

  public updatePosition(positionMs: number): MusicPerceptionSignal[] {
    if (!this.currentTrack || !this.currentSessionId) return [];
    this.currentPositionMs = positionMs;

    const newSignals: MusicPerceptionSignal[] = [];

    for (const provider of this.providers) {
      try {
        const signal = provider.update(positionMs);
        if (signal) {
          // Verify track/session isolation
          if (
            signal.trackId === this.currentTrack.id &&
            signal.sessionId === this.currentSessionId
          ) {
            newSignals.push(signal);
          }
        }
      } catch (e) {
        console.error(`[PerceptionOrchestrator] Provider ${provider.id} update error:`, e);
      }
    }

    if (newSignals.length > 0) {
      // signalsIn counts every signal the orchestrator accepted from providers.
      const prev = perceptionTelemetry.getMobileMusicPipeline().perception;
      perceptionTelemetry.updateMobileMusicPerception({
        signalsIn: prev.signalsIn + newSignals.length,
      });
      const deduplicated = this.deduplicateSignals(newSignals);
      this.activeSignals.push(...deduplicated);

      if (this.activeSignals.length > 100) {
        this.activeSignals = this.activeSignals.slice(-100);
      }

      // Determine current structural section from existing context if any
      const currentContext = this.getPerceptionContext();
      const currentSection = currentContext?.structure?.section;

      const moments = this.fusionEngine.processSignals(
        deduplicated,
        this.currentTrack.id,
        this.currentSessionId,
        currentSection,
      );
      // Tell the fusion engine's own counters into telemetry. We avoid
      // double-counting: signalsReceived is the orchestrator's view, fusion
      // counts evidence + moments it produced.
      perceptionTelemetry.updateMobileMusicEvidence((prevEv) => ({
        ...prevEv,
        signalsReceived: prevEv.signalsReceived + deduplicated.length,
        evidenceGenerated: prevEv.evidenceGenerated + deduplicated.length, // 1 evidence / signal
        momentsGenerated: Math.max(prevEv.momentsGenerated, moments.length),
        lastMomentAt: moments.length > 0 ? Date.now() : prevEv.lastMomentAt,
        lastSourceCategories: Array.from(new Set(deduplicated.map((s) => s.source))),
      }));

      return deduplicated;
    }

    return [];
  }

  private deduplicateSignals(newSignals: MusicPerceptionSignal[]): MusicPerceptionSignal[] {
    const finalSignals: MusicPerceptionSignal[] = [];

    for (const signal of newSignals) {
      const isDuplicate =
        finalSignals.some(
          (s) => s.type === signal.type && Math.abs(s.timestampMs - signal.timestampMs) < 1000,
        ) ||
        this.activeSignals.some(
          (s) => s.type === signal.type && Math.abs(s.timestampMs - signal.timestampMs) < 1000,
        );

      if (!isDuplicate) {
        finalSignals.push(signal);
      }
    }

    return finalSignals;
  }

  public getPerceptionContext(): MusicPerceptionContext | undefined {
    if (!this.currentTrack || !this.currentSessionId) return undefined;

    let currentSection: string | undefined = undefined;
    let sectionStartMs: number | undefined = undefined;
    let sectionEndMs: number | undefined = undefined;
    let previousSection: string | undefined = undefined;
    let nextSection: string | undefined = undefined;
    let confidence = 0;

    const sources = new Set<string>();

    for (let i = this.activeSignals.length - 1; i >= 0; i--) {
      const sig = this.activeSignals[i];
      sources.add(sig.source);

      if (sig.type === "section" && sig.metadata && sig.metadata.section && !currentSection) {
        currentSection = sig.metadata.section as string;
        sectionStartMs = sig.metadata.sectionStartMs as number;
        sectionEndMs = sig.metadata.sectionEndMs as number;
        previousSection = sig.metadata.previousSection as string;
        nextSection = sig.metadata.nextSection as string;
        confidence = sig.confidence;
      }
    }

    return {
      trackId: this.currentTrack.id,
      sessionId: this.currentSessionId,
      positionMs: this.currentPositionMs,
      structure: currentSection
        ? {
            section: currentSection,
            sectionStartMs,
            sectionEndMs,
            previousSection,
            nextSection,
          }
        : undefined,
      signals: [...this.activeSignals],
      sources: Array.from(sources),
      recentMoments: this.fusionEngine.getRecentMoments(),
      confidence,
      observedAt: Date.now(),
    };
  }

  public deactivate() {
    for (const provider of this.providers) {
      try {
        provider.deactivate();
      } catch (e) {
        console.error(`[PerceptionOrchestrator] Provider deactivate error:`, e);
      }
    }
    perceptionTelemetry.updateMobileMusicPerception({ lifecycle: "inactive" });
  }

  public dispose() {
    for (const provider of this.providers) {
      try {
        provider.dispose();
      } catch (e) {
        console.error(`[PerceptionOrchestrator] Provider dispose error:`, e);
      }
    }
    this.currentTrack = null;
    this.currentSessionId = null;
    this.activeSignals = [];
  }
}
