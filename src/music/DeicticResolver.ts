import { PlaybackStateData, MusicalMoment } from "./types";

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
