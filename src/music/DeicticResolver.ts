import { PlaybackStateData, MusicalMoment, Track } from "./types";
import { playbackState } from "./PlaybackState";

export interface PositionResolution {
  seconds: number | null;
  source: "timestamp" | "section" | "lyric" | null;
  matched?: string;
  reason?: string;
}

/**
 * Parse a spoken/typed position into whole seconds. Handles "1:32",
 * "1 minute 30 seconds", "92 seconds", "three minutes", "0:45".
 * Returns null when no explicit time appears.
 */
export function parseTimestampToSeconds(text: string): number | null {
  const lower = text.toLowerCase().trim();
  if (!lower) return null;

  // "1:32" => 1m32s; "1:02:33" => 1h2m33s; "0:45" => 45s
  // Prefer minutes:seconds for two-part; only treat three-part as H:MM:SS.
  const colon = lower.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b|\b(\d{1,3}):(\d{2})\b/);
  if (colon) {
    if (colon[3] !== undefined) {
      // Three part H:MM:SS
      const h = parseInt(colon[1], 10);
      const m = parseInt(colon[2], 10);
      const s = parseInt(colon[3], 10);
      if (m >= 60 || s >= 60) return null;
      return h * 3600 + m * 60 + s;
    }
    if (colon[1] !== undefined && colon[2] !== undefined) {
      // Two part M:SS (or S:SS edge) — treat first token as minutes.
      const m = parseInt(colon[1], 10);
      const s = parseInt(colon[2], 10);
      if (s >= 60) return null;
      return m * 60 + s;
    }
    const m = parseInt(colon[4], 10);
    const s = parseInt(colon[5], 10);
    if (s >= 60) return null;
    return m * 60 + s;
  }

  const wordMap: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
  };

  // "3 minutes and 20 seconds" / "1 minute 30 seconds"
  const minSec = lower.match(
    /(?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|fifty))\s+minute(?:s)?(?:\s+and\s+|\s+)?(?:(\d+)\s+second(?:s)?)?/,
  );
  if (minSec) {
    const minsRaw = minSec[1].toLowerCase();
    const mins = wordMap[minsRaw] !== undefined ? wordMap[minsRaw] : parseInt(minsRaw, 10);
    const secs = minSec[2] ? parseInt(minSec[2], 10) : 0;
    if (Number.isFinite(mins)) return mins * 60 + secs;
  }

  // "92 seconds" / "forty five seconds"
  const secMatch = lower.match(/(?:(\d+|[a-z]+))\s+second(?:s)?/);
  if (secMatch) {
    const raw = secMatch[1].toLowerCase();
    const n = wordMap[raw] !== undefined ? wordMap[raw] : parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }

  return null;
}

const SECTION_KEYWORDS: Record<string, string[]> = {
  chorus: ["chorus", "refrain", "hook"],
  verse: ["verse"],
  intro: ["intro", "introduction", "beginning", "start"],
  bridge: ["bridge"],
  outro: ["outro", "ending", "end"],
  pre_chorus: ["pre-chorus", "pre chorus"],
  solo: ["solo", "instrumental"],
};

/**
 * Resolve a natural-language position target ("1:32", "the chorus",
 * "from the line ...") against a track's available metadata (chapters).
 *
 * - Exact/relative timestamps resolve directly.
 * - Named structural sections (chorus/verse/intro/...) resolve via the
 *   track's `chapters` metadata when present.
 * - A lyric line is best-effort: it only maps to a timestamp when it matches
 *   a chapter/section title. Without timestamped lyric data there is no way
 *   to map arbitrary lyric text to a time, so that returns null (honest).
 *
 * Returns seconds (relative to track start) when resolvable, else null.
 */
export function resolvePositionTarget(text: string, track?: Track | null): PositionResolution {
  const lower = text.toLowerCase().trim();
  if (!lower) return { seconds: null, source: null, reason: "Empty position request." };

  const explicit = parseTimestampToSeconds(text);
  if (explicit !== null) {
    return { seconds: explicit, source: "timestamp", matched: text.trim() };
  }

  const chapters = track?.chapters && Array.isArray(track.chapters) ? track.chapters : [];

  // Named section, e.g. "the chorus", "from the bridge".
  for (const [kind, keywords] of Object.entries(SECTION_KEYWORDS)) {
    if (keywords.some((k) => new RegExp(`\\b${k}\\b`).test(lower))) {
      if (chapters.length > 0) {
        const hit = chapters.find((c) => keywords.some((k) => c.title.toLowerCase().includes(k)));
        if (hit && typeof hit.start_time === "number") {
          return {
            seconds: hit.start_time,
            source: "section",
            matched: hit.title,
            reason: `Resolved "${kind}" to chapter "${hit.title}".`,
          };
        }
      }
      // Section named but no chapter metadata — cannot resolve honestly.
      return {
        seconds: null,
        source: "section",
        matched: kind,
        reason: `No chapter metadata available to locate the ${kind}.`,
      };
    }
  }

  // Lyric / arbitrary line: best-effort only against section titles.
  const lyricWords = lower.replace(/^(play|start|go|from|at)\s+/, "").trim();
  if (lyricWords.length > 2) {
    for (const c of chapters) {
      const ct = c.title.toLowerCase();
      if (ct && (ct.includes(lyricWords) || lyricWords.includes(ct))) {
        return {
          seconds: typeof c.start_time === "number" ? c.start_time : null,
          source: "lyric",
          matched: c.title,
          reason: `Matched "${lyricWords}" to chapter "${c.title}".`,
        };
      }
    }
    return {
      seconds: null,
      source: "lyric",
      matched: lyricWords,
      reason:
        "No timestamped lyric data is available to locate that line, so the exact position cannot be determined.",
    };
  }

  return { seconds: null, source: null, reason: "No resolvable position or section name found." };
}

/**
 * Resolve a position phrase ("1:32", "the chorus") against the currently
 * playing track. Returns whole seconds or null when unresolvable. Used by the
 * text-tag music paths (OpenRouter/Sarvam) where only the phrase is available.
 */
export function resolvePositionPhraseToSeconds(text: string): number | null {
  if (!text) return null;
  return resolvePositionTarget(text, playbackState.getState().currentTrack).seconds;
}

export type SemanticMusicCategory =
  | "DIRECT_MUSIC_REFERENCE"
  | "DEICTIC_MUSIC_REFERENCE"
  | "MUSICAL_OBSERVATION"
  | "MUSIC_INFORMATION_REQUEST"
  | "PLAYBACK_COMMAND"
  | "NON_MUSIC_TOPIC"
  | "AMBIGUOUS";

export interface DeicticResolution {
  category: SemanticMusicCategory;
  reference?: string;
  target?: string;
  moment?: MusicalMoment;
  confidence: number;
}

export function classifyMusicSemantics(text: string): SemanticMusicCategory {
  const lower = text.toLowerCase();

  // DIRECT_MUSIC_REFERENCE
  if (/who sings|what song|name of this|what is this song/i.test(lower)) {
    return "DIRECT_MUSIC_REFERENCE";
  }

  // PLAYBACK_COMMAND
  if (/play that again|skip this|go back|pause|play the|stop the/i.test(lower)) {
    return "PLAYBACK_COMMAND";
  }

  // MUSIC_INFORMATION_REQUEST
  if (/album is this|other songs like this|when did this come out/i.test(lower)) {
    return "MUSIC_INFORMATION_REQUEST";
  }

  // DEICTIC_MUSIC_REFERENCE
  if (
    /(this|that) part|(this|that) section|(this|that) beat|right there|what was that|what just happened|what changed|when it changed|the part (before|after) this|the beginning|the ending|this bit/i.test(
      lower,
    )
  ) {
    return "DEICTIC_MUSIC_REFERENCE";
  }

  // MUSICAL_OBSERVATION
  if (/drums sound|beat just|guitar is|sounds like|the arrangement/i.test(lower)) {
    return "MUSICAL_OBSERVATION";
  }

  // AMBIGUOUS / NON_MUSIC_TOPIC fallback
  if (/song|music|track|artist|lyrics/i.test(lower)) {
    return "AMBIGUOUS";
  }

  if (/explain|what is|how do i|weather|code|python|react/i.test(lower)) {
    return "NON_MUSIC_TOPIC";
  }

  if (/really|why|interesting|wow|cool|nice/i.test(lower)) {
    return "AMBIGUOUS";
  }

  return "NON_MUSIC_TOPIC";
}

function parseExplicitTime(text: string): number | null {
  // Matches "around 1:30" or "at 2:45"
  const colonMatch = text.match(/(\d{1,2}):(\d{2})/);
  if (colonMatch) {
    const mins = parseInt(colonMatch[1], 10);
    const secs = parseInt(colonMatch[2], 10);
    return (mins * 60 + secs) * 1000;
  }

  // Matches "around two minutes" or "at 3 minutes"
  const wordMap: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const minMatch = text.match(/(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+minute/i);
  if (minMatch) {
    const numStr = minMatch[1].toLowerCase();
    const mins = wordMap[numStr] !== undefined ? wordMap[numStr] : parseInt(numStr, 10);
    return mins * 60 * 1000;
  }

  return null;
}

export function resolveDeicticReference(
  text: string,
  state: PlaybackStateData,
  recentMoments?: MusicalMoment[],
): DeicticResolution {
  const category = classifyMusicSemantics(text);

  if (category === "NON_MUSIC_TOPIC") {
    return { category, confidence: 0 };
  }

  if (!state.currentTrack || !state.isPlaying) {
    // If not playing but we have history, user might be asking about previous track.
    // That gets handled at the context level.
    return { category, confidence: 0 };
  }

  let target = "current playback";
  let confidence = 0.5;

  let moments = recentMoments || [];
  if (moments.length === 0 && state.perception?.recentMoments) {
    moments = state.perception.recentMoments;
  }

  // Try finding an explicit time reference first
  const explicitTimeMs = parseExplicitTime(text);
  if (explicitTimeMs !== null) {
    let bestMoment: MusicalMoment | undefined;
    if (moments.length > 0) {
      bestMoment = moments.reduce((prev, curr) => {
        return Math.abs(curr.startMs - explicitTimeMs) < Math.abs(prev.startMs - explicitTimeMs)
          ? curr
          : prev;
      }, moments[0]);
    }

    // Create a synthesized moment if we don't have one near it
    const finalMoment =
      bestMoment && Math.abs(bestMoment.startMs - explicitTimeMs) < 15000 ? bestMoment : undefined;

    return {
      category: "DEICTIC_MUSIC_REFERENCE",
      reference: text,
      target: `moment near ${explicitTimeMs / 1000}s`,
      moment: finalMoment,
      confidence: 0.9,
    };
  }

  // Otherwise pick the most salient recent moment if available
  // Fall back to a default synthesized one if not
  const latestSalientMoment =
    moments.length > 0 ? [...moments].sort((a, b) => b.salience - a.salience)[0] : undefined;

  let moment = latestSalientMoment;

  if (category === "DEICTIC_MUSIC_REFERENCE") {
    const lower = text.toLowerCase();
    let reference = "that part";
    const match = lower.match(
      /(this|that) part|(this|that) section|right there|what was that|this bit/,
    );
    if (match) {
      reference = match[0];
    }

    if (moment && moment.trigger && moment.trigger !== "unknown") {
      const timeSinceObserved = Date.now() - moment.observedAt;

      if (moment.trigger === "section_change") {
        target = `recent transition from ${moment.previousSection || "previous part"} to ${moment.section}`;
        confidence = timeSinceObserved < 15000 ? 0.95 : 0.7;
      } else if (moment.trigger === "seek") {
        target = "recent seek target";
        confidence = 0.8;
      } else if (moment.trigger === "acoustic_event") {
        target = `recent acoustic transition (${moment.transition || "event"}) at ${Math.round(moment.startMs / 1000)}s`;
        confidence = moment.salience > 0.5 ? 0.85 : 0.6;
      } else {
        target = moment.section || "current section";
        confidence = 0.7;
      }
    } else if (moment?.section) {
      target = moment.section;
      confidence = 0.8;
    } else {
      target = "unknown";
      confidence = 0.3;
    }

    return {
      category,
      reference,
      target,
      moment,
      confidence,
    };
  }

  return {
    category,
    moment,
    confidence: 0.5,
  };
}
