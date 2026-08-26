/**
 * LanguageState — the canonical conversation-language register.
 *
 * OWNERSHIP: This is a Conversation Executive decision. The LLM never
 * infers conversation language; it only realizes this state.
 *
 * The engine is pure and deterministic:
 *   1. classifyLanguageObservation  — per-turn detection
 *   2. LanguageMomentumEngine        — continuous classification with
 *                                      inertia (language momentum)
 *   3. Deterministic downstream maps — prompt directive, TTS voice code,
 *                                      thought-viewer localization
 */

export type ConversationLanguage =
  | "PURE_HINDI"
  | "PURE_ENGLISH"
  | "HINGLISH"
  | "ENGLISH_WITH_HINDI"
  | "HINDI_WITH_ENGLISH"
  | "UNKNOWN";

export type LanguageSecondary = "HINDI" | "ENGLISH" | "NONE";

export interface LanguageState {
  /** The conversation's dominant register — momentum-decided, not per-turn. */
  dominant: ConversationLanguage;
  /** The secondary flavor ("HINDI", "ENGLISH", "NONE"). */
  secondary: LanguageSecondary;
  /** 0–1, how sure the engine is of the current dominant. */
  confidence: number;
  /** 0–1, agreement across the momentum window (language inertia). */
  stability: number;
  /** Turn at which the current dominant language became established. */
  establishedAtTurn: number;
  /** Why the dominant last changed (null = never changed). */
  transitionReason: string | null;
  /** Human-readable evidence behind the current confidence. */
  confidenceReasons: string[];
  /** How many turns are in the momentum window. */
  momentumWindow: number;
}

/** Per-turn raw observation (one message, before momentum). */
export interface LanguageObservation {
  dominant: ConversationLanguage;
  secondary: LanguageSecondary;
  /** 0–1 confidence in THIS observation alone. */
  confidence: number;
  raw: { hindi: number; english: number; devanagari: number };
}

// ─── Lexicon ─────────────────────────────────────────────────────────

const DEVANAGARI_RE = /[\u0900-\u097F]/;
const ROMAN_HINDI_RE = /^[a-z][a-z']*$/i;

// Common romanized-Hindi words (Hinglish core vocabulary).
const ROMAN_HINDI: ReadonlySet<string> = new Set([
  "aaj",
  "acha",
  "achha",
  "accha",
  "aap",
  "aaya",
  "aayi",
  "arre",
  "baat",
  "bahut",
  "bas",
  "bhai",
  "bhi",
  "bola",
  "boli",
  "bolo",
  "chahiye",
  "chalo",
  "chahta",
  "chahti",
  "dekh",
  "dekho",
  "gaya",
  "gayi",
  "haan",
  "hai",
  "hain",
  "hoga",
  "hoon",
  "ho",
  "hua",
  "humein",
  "ja",
  "jao",
  "kab",
  "kaha",
  "kahan",
  "kaise",
  "kal",
  "karo",
  "kar",
  "karke",
  "kaun",
  "ke",
  "ki",
  "kuch",
  "kya",
  "kyun",
  "kyon",
  "maine",
  "mera",
  "meri",
  "mujhe",
  "nahi",
  "nahin",
  "nhi",
  "pata",
  "raha",
  "rahi",
  "sab",
  "sahi",
  "se",
  "shayad",
  "sun",
  "suno",
  "tha",
  "theek",
  "thik",
  "thi",
  "thoda",
  "thodi",
  "tum",
  "unka",
  "unke",
  "waise",
  "wo",
  "woh",
  "yaar",
  "yeh",
  "ye",
  "zyada",
  "zada",
  "itna",
  "kitna",
  "kabhi",
  "kisi",
  "koi",
  "bahar",
  "andar",
  "upar",
  "neeche",
  "saath",
  "sath",
  "dil",
  "khaana",
  "khana",
  "paani",
  "pani",
  "kaam",
  "kam",
  "din",
  "raat",
  "subah",
  "shaam",
  "samajh",
  "samjha",
]);

// Hinglish markers: single Hindi tokens that flavor an otherwise-English
// sentence into conversational Hinglish (directive: HINGLISH register).
const HINGLISH_MARKERS: ReadonlySet<string> = new Set([
  "acha",
  "achha",
  "accha",
  "arre",
  "bhai",
  "haan",
  "nahi",
  "nhi",
  "shayad",
  "theek",
  "thik",
  "thoda",
  "thodi",
  "vaise",
  "waise",
  "yaar",
  "zyada",
  "zada",
  "bas",
  "sahi",
]);

// ─── Per-turn classification ─────────────────────────────────────────

/** Split a transcript into Devanagari / roman-Hindi / English token buckets. */
export function tokenizeLanguage(text: string): {
  hindi: number;
  english: number;
  devanagari: number;
} {
  let hindi = 0;
  let english = 0;
  let devanagari = 0;
  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue;
    if (DEVANAGARI_RE.test(token)) {
      hindi++;
      devanagari++;
      continue;
    }
    const word = token.replace(/[^\p{L}']/gu, "").toLowerCase();
    if (word.length === 0) continue; // punctuation-only
    if (ROMAN_HINDI_RE.test(word) && ROMAN_HINDI.has(word)) {
      hindi++;
    } else if (/^[a-z][a-z']*$/i.test(word)) {
      english++;
    }
  }
  return { hindi, english, devanagari };
}

/**
 * Classify a single utterance into the canonical register.
 * Bands (over meaningful tokens): >0.9 Hindi → PURE_HINDI;
 * 0.6–0.9 → HINDI_WITH_ENGLISH; 0.25–0.6 → HINGLISH;
 * <0.25 with a Hinglish marker → HINGLISH; <0.25 → ENGLISH_WITH_HINDI;
 * zero Hindi tokens → PURE_ENGLISH; no tokens → UNKNOWN.
 */
export function classifyLanguageObservation(text: string): LanguageObservation {
  const raw = tokenizeLanguage(text);
  const meaningful = raw.hindi + raw.english;
  if (meaningful === 0) {
    return {
      dominant: "UNKNOWN",
      secondary: "NONE",
      confidence: 0,
      raw,
    };
  }

  const hindiRatio = raw.hindi / meaningful;
  let dominant: ConversationLanguage;
  let secondary: LanguageSecondary;
  let confidence: number;

  if (hindiRatio > 0.9) {
    dominant = "PURE_HINDI";
    secondary = "ENGLISH";
    confidence = Math.min(1, hindiRatio + 0.05);
  } else if (hindiRatio >= 0.6) {
    dominant = "HINDI_WITH_ENGLISH";
    secondary = "ENGLISH";
    confidence = 0.6 + ((hindiRatio - 0.6) / 0.3) * 0.35;
  } else if (hindiRatio >= 0.25) {
    dominant = "HINGLISH";
    secondary = hindiRatio >= 0.5 ? "HINDI" : "ENGLISH";
    confidence = 0.7;
  } else if (hindiRatio > 0) {
    // English-dominant — a single Hinglish marker keeps it conversational
    const hasMarker = text
      .trim()
      .split(/\s+/)
      .some((t) => HINGLISH_MARKERS.has(t.replace(/[^\p{L}']/gu, "").toLowerCase()));
    if (hasMarker) {
      dominant = "HINGLISH";
      secondary = "ENGLISH";
      confidence = 0.65;
    } else {
      dominant = "ENGLISH_WITH_HINDI";
      secondary = "HINDI";
      confidence = 0.6 + ((0.25 - hindiRatio) / 0.25) * 0.35;
    }
  } else {
    dominant = "PURE_ENGLISH";
    secondary = "NONE";
    confidence = 1;
  }

  return { dominant, secondary, confidence, raw };
}

// ─── Momentum engine (Executive-owned continuous classification) ─────

const WINDOW_SIZE = 6;
const FLIP_MAJORITY = 3; // ≥3 of the last 6 turns must agree to flip

export class LanguageMomentumEngine {
  private observations: LanguageObservation[] = [];
  private state: LanguageState = {
    dominant: "UNKNOWN",
    secondary: "NONE",
    confidence: 0,
    stability: 0,
    establishedAtTurn: 0,
    transitionReason: null,
    confidenceReasons: [],
    momentumWindow: 0,
  };

  /**
   * Feed one turn. Momentum guard: a single borrowed word or a single
   * shifted turn never flips the conversation language; the new register
   * must win the majority of the recent window.
   */
  observe(text: string, turn: number): LanguageObservation {
    const obs = classifyLanguageObservation(text);
    this.observations.push(obs);
    if (this.observations.length > WINDOW_SIZE) this.observations.shift();

    const window = this.observations.filter((o) => o.dominant !== "UNKNOWN");
    if (window.length === 0) {
      this.state = {
        dominant: "UNKNOWN",
        secondary: "NONE",
        confidence: 0,
        stability: 0,
        establishedAtTurn: turn,
        transitionReason: null,
        confidenceReasons: ["no language signal yet"],
        momentumWindow: 0,
      };
      return obs;
    }

    const counts = new Map<ConversationLanguage, number>();
    for (const o of window) counts.set(o.dominant, (counts.get(o.dominant) ?? 0) + 1);
    const maxCount = Math.max(...counts.values());
    const leaders = [...counts.entries()].filter(([, c]) => c === maxCount).map(([d]) => d);
    // Inertia: on a tie the current register wins — a new register must
    // actually out-vote the incumbent before the conversation flips.
    const winner = leaders.includes(this.state.dominant) ? this.state.dominant : leaders[0];
    const winnerCount = maxCount;
    const stability = winnerCount / window.length;

    let next = this.state.dominant;
    let transitionReason = this.state.transitionReason;
    if (next === "UNKNOWN") {
      next = winner;
      transitionReason = "first language signal in the window";
    } else if (winner !== next && winnerCount >= FLIP_MAJORITY) {
      transitionReason = `${winnerCount}/${window.length} window agreement — ${winner}`;
      next = winner;
    }

    const last = window[window.length - 1];
    const secondary: LanguageSecondary =
      next === "PURE_ENGLISH"
        ? "NONE"
        : last.secondary === "NONE"
          ? this.state.secondary
          : last.secondary;

    const establishedAtTurn = next === this.state.dominant ? this.state.establishedAtTurn : turn;

    const meanConf = window.reduce((a, o) => a + o.confidence, 0) / window.length;
    const confidence = Math.min(1, meanConf * (0.4 + 0.6 * stability));

    // Explainable confidence — deterministic evidence, never a black box.
    const meaningful = obs.raw.hindi + obs.raw.english;
    const confidenceReasons: string[] = [];
    if (meaningful > 0) {
      const hindiPct = Math.round((obs.raw.hindi / meaningful) * 100);
      confidenceReasons.push(`${hindiPct}% Hindi tokens, ${100 - hindiPct}% English tokens`);
    }
    if (obs.raw.devanagari > 0) confidenceReasons.push(`${obs.raw.devanagari} Devanagari tokens`);
    const markers = text
      .trim()
      .split(/\s+/)
      .map((t) => t.replace(/[^\p{L}']/gu, "").toLowerCase())
      .filter((w) => HINGLISH_MARKERS.has(w));
    if (markers.length > 0) {
      confidenceReasons.push(
        `Hindi discourse markers: ${[...new Set(markers)].slice(0, 4).join(", ")}`,
      );
    }
    const ago = Math.max(0, turn - establishedAtTurn);
    confidenceReasons.push(`stable for ${ago} turn${ago === 1 ? "" : "s"}`);
    if (transitionReason && transitionReason !== this.state.transitionReason) {
      confidenceReasons.push(`transition: ${transitionReason}`);
    }

    this.state = {
      dominant: next,
      secondary,
      confidence: Math.round(confidence * 1000) / 1000,
      stability: Math.round(stability * 1000) / 1000,
      establishedAtTurn,
      transitionReason,
      confidenceReasons: [...new Set(confidenceReasons)].slice(0, 6),
      momentumWindow: window.length,
    };
    return obs;
  }

  getLanguageState(): LanguageState {
    return { ...this.state, confidenceReasons: [...this.state.confidenceReasons] };
  }

  /** Reset (new session). */
  reset(): void {
    this.observations = [];
    this.state = {
      dominant: "UNKNOWN",
      secondary: "NONE",
      confidence: 0,
      stability: 0,
      establishedAtTurn: 0,
      transitionReason: null,
      confidenceReasons: [],
      momentumWindow: 0,
    };
  }
}

// ─── Deterministic downstream mappings ───────────────────────────────

const REGISTER_RULES: Record<ConversationLanguage, string> = {
  PURE_HINDI:
    "respond entirely in natural Hindi — no English words unless universally used in Hindi conversation; avoid translated-sounding Hindi",
  PURE_ENGLISH: "respond entirely in natural English — do not insert Hindi",
  HINGLISH:
    "mirror the user's Hindi-English balance in natural conversational Hinglish; do not collapse into one language; keep technical words as the user said them",
  HINDI_WITH_ENGLISH:
    "respond in Hindi, keeping the user's English terms exactly as they said them (phone, office, meeting, project, deadline, etc.) — never translate them",
  ENGLISH_WITH_HINDI:
    "respond in English; mirror the user's Hindi expressions naturally when they fit (yaar, acha, haan, nahi) — never exaggerate",
  UNKNOWN:
    "match the user's language register from their message — never upgrade, never translate unnecessarily",
};

/** Deterministic prompt directive — the LLM's only language instruction. */
export function languagePromptDirective(state: LanguageState): string {
  const secondary = state.secondary !== "NONE" ? ` / secondary ${state.secondary}` : "";
  return (
    `language: ${state.dominant}${secondary} (confidence ${state.confidence.toFixed(2)}, ` +
    `stable since turn ${state.establishedAtTurn}) — ${REGISTER_RULES[state.dominant]}`
  );
}

/** TTS voice code for the spoken response register. null = keep user setting. */
export function ttsLanguageCode(state: LanguageState): "hi-IN" | "en-IN" | null {
  switch (state.dominant) {
    case "PURE_HINDI":
    case "HINDI_WITH_ENGLISH":
    case "HINGLISH":
      return "hi-IN";
    case "PURE_ENGLISH":
    case "ENGLISH_WITH_HINDI":
      return "en-IN";
    case "UNKNOWN":
      return null;
  }
}

/** Thought-viewer / audible-murmur localization for Hindi-family registers. */
const HI_MURMURS: Record<string, string> = {
  "Hmm…": "हम्म…",
  "Let me think…": "सोच रही हूँ…",
  "I want to understand something first…": "मैं पहले कुछ समझना चाहती हूँ…",
};

const HINDI_FAMILY: ReadonlySet<ConversationLanguage> = new Set([
  "PURE_HINDI",
  "HINDI_WITH_ENGLISH",
  "HINGLISH",
]);

export function localizeThinkingUtterance(utterance: string, state: LanguageState): string {
  if (!utterance) return utterance;
  if (!HINDI_FAMILY.has(state.dominant)) return utterance;
  return HI_MURMURS[utterance] ?? utterance;
}
