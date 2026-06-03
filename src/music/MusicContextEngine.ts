/**
 * AURA Music System — MusicContextEngine
 * 
 * Tracks emotional associations and user memories tied to songs.
 * Provides context injection text for the LLM system prompt.
 */

import type { MusicContext, TrackInfo } from "./types";

interface SongMemory {
  song: string;
  artist: string;
  associations: string[];
  emotions: string[];
  playCount: number;
  lastPlayed: string;
}

export class MusicContextEngine {
  private currentContext: MusicContext = {
    currentSong: "",
    currentArtist: "",
    playbackState: "stopped",
    startTime: "",
    userAssociations: [],
    emotionsDetected: [],
  };

  // In-memory song memory store (persisted to localStorage)
  private songMemories: Map<string, SongMemory> = new Map();
  private saveTimeout: number | null = null;

  constructor() {
    this.loadFromStorage();
  }

  // ── Track Lifecycle ───────────────────────────────────────────────

  onTrackStart(track: TrackInfo): void {
    this.currentContext = {
      currentSong: track.title,
      currentArtist: track.artist,
      playbackState: "playing",
      startTime: new Date().toISOString(),
      userAssociations: [],
      emotionsDetected: [],
    };

    // Load existing associations for this song
    const key = this.songKey(track.title, track.artist);
    const existing = this.songMemories.get(key);
    if (existing) {
      this.currentContext.userAssociations = [...existing.associations];
      this.currentContext.emotionsDetected = [...existing.emotions];
      existing.playCount += 1;
      existing.lastPlayed = new Date().toISOString();
    } else {
      this.songMemories.set(key, {
        song: track.title,
        artist: track.artist,
        associations: [],
        emotions: [],
        playCount: 1,
        lastPlayed: new Date().toISOString(),
      });
    }
    this.saveToStorage();
  }

  onTrackPause(): void {
    this.currentContext.playbackState = "paused";
  }

  onTrackResume(): void {
    this.currentContext.playbackState = "playing";
  }

  onTrackStop(): void {
    this.currentContext = {
      currentSong: "",
      currentArtist: "",
      playbackState: "stopped",
      startTime: "",
      userAssociations: [],
      emotionsDetected: [],
    };
  }

  // ── Association Tracking ──────────────────────────────────────────

  addAssociation(text: string): void {
    if (!this.currentContext.currentSong || !text.trim()) return;

    // Constrain size to prevent memory bloat
    const trimmed = text.trim().slice(0, 100);
    if (!this.currentContext.userAssociations.includes(trimmed)) {
      if (this.currentContext.userAssociations.length >= 5) {
        this.currentContext.userAssociations.shift(); // FIFO eviction per-song
      }
      this.currentContext.userAssociations.push(trimmed);
    }

    // Persist to song memory
    const key = this.songKey(this.currentContext.currentSong, this.currentContext.currentArtist);
    const memory = this.songMemories.get(key);
    if (memory && !memory.associations.includes(trimmed)) {
      if (memory.associations.length >= 5) {
        memory.associations.shift();
      }
      memory.associations.push(trimmed);
      this.saveToStorage();
    }
  }

  addEmotion(emotion: string): void {
    if (!this.currentContext.currentSong || !emotion.trim()) return;

    // Constrain size to prevent memory bloat
    const trimmed = emotion.trim().toLowerCase().slice(0, 50);
    if (!this.currentContext.emotionsDetected.includes(trimmed)) {
      if (this.currentContext.emotionsDetected.length >= 5) {
        this.currentContext.emotionsDetected.shift(); // FIFO eviction per-song
      }
      this.currentContext.emotionsDetected.push(trimmed);
    }

    // Persist to song memory
    const key = this.songKey(this.currentContext.currentSong, this.currentContext.currentArtist);
    const memory = this.songMemories.get(key);
    if (memory && !memory.emotions.includes(trimmed)) {
      if (memory.emotions.length >= 5) {
        memory.emotions.shift();
      }
      memory.emotions.push(trimmed);
      this.saveToStorage();
    }
  }

  // ── LLM Context Injection ─────────────────────────────────────────

  /**
   * Build context string to inject into the LLM system prompt
   * when music is active. Returns empty string when no music is playing.
   */
  buildContextInjection(): string {
    if (this.currentContext.playbackState === "stopped") return "";

    const lines: string[] = [
      "\n━━━ ACTIVE MUSIC CONTEXT ━━━",
      `CURRENT SONG: ${this.currentContext.currentSong}`,
      `CURRENT ARTIST: ${this.currentContext.currentArtist}`,
      `PLAYBACK STATE: ${this.currentContext.playbackState}`,
    ];

    if (this.currentContext.userAssociations.length > 0) {
      lines.push(`USER ASSOCIATIONS: ${this.currentContext.userAssociations.join(", ")}`);
    }

    if (this.currentContext.emotionsDetected.length > 0) {
      lines.push(`EMOTIONAL TAGS: ${this.currentContext.emotionsDetected.join(", ")}`);
    }

    lines.push(
      "Use this context to enrich your responses when relevant.",
      "The user is listening to music while talking to you — treat it as a shared experience.",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );

    return lines.join("\n");
  }

  getContext(): Readonly<MusicContext> {
    return { ...this.currentContext };
  }

  getSongMemory(title: string, artist: string): SongMemory | null {
    return this.songMemories.get(this.songKey(title, artist)) ?? null;
  }

  // ── Persistence ───────────────────────────────────────────────────

  private songKey(title: string, artist: string): string {
    return `${title.toLowerCase().trim()}::${artist.toLowerCase().trim()}`;
  }

  private saveToStorage(): void {
    if (this.saveTimeout) return;
    
    // Throttle saves to once every 2 seconds
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      try {
        // LRU Eviction: Cap at 500 items to prevent localStorage bloat (~100-200kb max)
        const MAX_MEMORIES = 500;
        if (this.songMemories.size > MAX_MEMORIES) {
          // Sort by lastPlayed descending (newest first)
          const sorted = Array.from(this.songMemories.entries()).sort(
            (a, b) => new Date(b[1].lastPlayed).getTime() - new Date(a[1].lastPlayed).getTime()
          );
          // Keep only the top MAX_MEMORIES
          this.songMemories = new Map(sorted.slice(0, MAX_MEMORIES));
        }

        const data = Object.fromEntries(this.songMemories);
        localStorage.setItem("aura_music_memories", JSON.stringify(data));
      } catch {
        // Storage full or unavailable — graceful degradation
      }
    }, 2000) as any;
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem("aura_music_memories");
      if (raw) {
        const data = JSON.parse(raw);
        this.songMemories = new Map(Object.entries(data));
      }
    } catch {
      // Invalid data — start fresh
    }
  }
}
