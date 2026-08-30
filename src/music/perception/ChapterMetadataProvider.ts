import type {
  MusicPerceptionProvider,
  MusicPerceptionSignal,
  MusicPerceptionContext,
  Track,
} from "../types";

export class ChapterMetadataProvider implements MusicPerceptionProvider {
  public id = "chapters";

  private currentTrack: Track | null = null;
  private currentSessionId: string | null = null;

  private lastReportedSection: string | null = null;

  public initialize(track: Track, sessionId: string): void {
    this.currentTrack = track;
    this.currentSessionId = sessionId;
    this.lastReportedSection = null;
  }

  public update(positionMs: number): MusicPerceptionSignal | null {
    if (!this.currentTrack || !this.currentSessionId || !this.currentTrack.chapters) return null;

    const posSec = positionMs / 1000;
    let currentSection: string | null = null;
    let sectionStartMs = 0;
    let sectionEndMs = 0;
    let previousSection: string | undefined = undefined;
    let nextSection: string | undefined = undefined;

    for (let i = 0; i < this.currentTrack.chapters.length; i++) {
      const chapter = this.currentTrack.chapters[i];
      if (posSec >= chapter.start_time && posSec < chapter.end_time) {
        currentSection = chapter.title;
        sectionStartMs = chapter.start_time * 1000;
        sectionEndMs = chapter.end_time * 1000;
        if (i > 0) previousSection = this.currentTrack.chapters[i - 1].title;
        if (i < this.currentTrack.chapters.length - 1)
          nextSection = this.currentTrack.chapters[i + 1].title;
        break;
      }
    }

    if (currentSection && currentSection !== this.lastReportedSection) {
      this.lastReportedSection = currentSection;

      return {
        type: "section",
        trackId: this.currentTrack.id,
        sessionId: this.currentSessionId,
        timestampMs: Date.now(),
        confidence: 1.0,
        source: this.id,
        metadata: {
          section: currentSection,
          sectionStartMs,
          sectionEndMs,
          previousSection,
          nextSection,
        },
      };
    }

    return null;
  }

  public getCurrentContext(): MusicPerceptionContext | null {
    return null;
  }

  public deactivate(): void {}

  public dispose(): void {
    this.currentTrack = null;
    this.currentSessionId = null;
    this.lastReportedSection = null;
  }
}
