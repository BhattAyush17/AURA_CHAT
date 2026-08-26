/**
 * RegisterState — the canonical conversation register (Phase 8.1).
 *
 * OWNERSHIP: This is a Conversation Executive decision, exactly like
 * LanguageState. The LLM never infers register; it only realizes this
 * state. Language answers "what words", Register answers "who AURA is
 * in this conversation".
 *
 * The engine is pure and deterministic:
 *   1. classifyRegisterObservation  — per-turn heuristic detection
 *                                      (no LLM)
 *   2. RegisterMomentumEngine        — continuous classification with
 *                                      inertia (register momentum)
 *   3. determineRelationshipStage    — deterministic relationship
 *                                      ladder (relationship gates what
 *                                      registers are permitted)
 *   4. Deterministic downstream maps — prompt directive, diagnostics
 *
 * Every confidence score is explainable: confidenceReasons carries the
 * human-readable evidence behind each value.
 */

export type ConversationRegister =
  | "CASUAL"
  | "PROFESSIONAL"
  | "ACADEMIC"
  | "PLAYFUL"
  | "SUPPORTIVE"
  | "INTIMATE"
  | "NEUTRAL";

export type RelationshipStage = "NEW" | "ACQUAINTING" | "COMFORTABLE" | "INTIMATE";

export interface RegisterState {
  /** The conversation's canonical register — momentum-decided. */
  register: ConversationRegister;
  /** 0–1, how sure the engine is of the current register. */
  confidence: number;
  /** 0–1, agreement across the momentum window (register inertia). */
  stability: number;
  /** Turn at which the current register became established. */
  establishedTurn: number;
  /** Why the register last changed (null = never changed). */
  transitionReason: string | null;
  /** Human-readable evidence behind the current confidence. */
  confidenceReasons: string[];
  /** How many turns are in the momentum window. */
  momentumWindow: number;
}

/** Per-turn raw observation (one message, before momentum). */
export interface RegisterObservation {
  register: ConversationRegister;
  /** 0–1 confidence in THIS observation alone. */
  confidence: number;
  /** Evidence for this observation (never a black box). */
  reasons: string[];
  /** Raw per-register heuristic scores. */
  scores: Record<ConversationRegister, number>;
  /** Mean words per sentence in this utterance. */
  avgSentenceLength: number;
}

/** Deterministic inputs for the relationship ladder. */
export interface RelationshipInput {
  sessionTurn: number;
  hasPersonalHistory: boolean;
  trust: number; // 0–1
}

// ─── Relationship ladder ─────────────────────────────────────────────

/**
 * Deterministic relationship stage — registers evolve with the
 * relationship, not the topic. The ladder only moves forward as turns
 * accumulate, personal history exists, and trust is present.
 */
export function determineRelationshipStage(rel: RelationshipInput): RelationshipStage {
  const { sessionTurn, hasPersonalHistory, trust } = rel;
  if (sessionTurn >= 20 && trust >= 0.65) return "INTIMATE";
  if (sessionTurn >= 10 || (hasPersonalHistory && sessionTurn >= 5)) return "COMFORTABLE";
  if (sessionTurn >= 3) return "ACQUAINTING";
  return "NEW";
}

/**
 * Which registers are permitted at each relationship stage.
 * INTIMATE is the only register that requires relationship trust.
 */
const ALLOWED_BY_STAGE: Record<RelationshipStage, ReadonlySet<ConversationRegister>> = {
  NEW: new Set(["NEUTRAL", "PROFESSIONAL", "ACADEMIC", "SUPPORTIVE"]),
  ACQUAINTING: new Set(["NEUTRAL", "PROFESSIONAL", "ACADEMIC", "SUPPORTIVE", "CASUAL", "PLAYFUL"]),
  COMFORTABLE: new Set([
    "NEUTRAL",
    "PROFESSIONAL",
    "ACADEMIC",
    "SUPPORTIVE",
    "CASUAL",
    "PLAYFUL",
    "INTIMATE",
  ]),
  INTIMATE: new Set([
    "NEUTRAL",
    "PROFESSIONAL",
    "ACADEMIC",
    "SUPPORTIVE",
    "CASUAL",
    "PLAYFUL",
    "INTIMATE",
  ]),
};

/** Clamp a detected register to what the relationship permits. */
function clampToRelationship(
  register: ConversationRegister,
  scores: Record<ConversationRegister, number>,
  relationship: RelationshipStage,
): ConversationRegister {
  if (ALLOWED_BY_STAGE[relationship].has(register)) return register;
  if (register === "INTIMATE") {
    return scores.CASUAL > scores.PROFESSIONAL ? "CASUAL" : "NEUTRAL";
  }
  if (register === "PLAYFUL") return scores.CASUAL > 0 ? "CASUAL" : "NEUTRAL";
  if (register === "ACADEMIC") return "PROFESSIONAL";
  if (register === "CASUAL" || register === "PROFESSIONAL" || register === "SUPPORTIVE") {
    return "NEUTRAL";
  }
  return register;
}

// ─── Lexicons ────────────────────────────────────────────────────────

// Strong colloquialisms — weak words ("really", "pretty") and laugh
// tokens ("haha", "lol") are excluded so CASUAL never bleeds into
// PLAYFUL and never over-triggers on plain speech.
const SLANG: ReadonlySet<string> = new Set([
  "ain't",
  "bro",
  "broo",
  "cuz",
  "coz",
  "dope",
  "dude",
  "duh",
  "fam",
  "gimme",
  "gonna",
  "gotta",
  "howdy",
  "kinda",
  "lemme",
  "lit",
  "nah",
  "nope",
  "okay",
  "ok",
  "sick",
  "sorta",
  "stuff",
  "sup",
  "thingy",
  "ugh",
  "wanna",
  "wassup",
  "whatever",
  "wow",
  "ya",
  "yeah",
  "yep",
  "yo",
  "yaar",
  "abe",
  "oye",
  "arre",
  "arey",
  "bc",
  "bhenchod",
  "chutiye",
  "matlab",
  "waise",
  "bakchodi",
  "chup",
  "theek",
  "kya",
  "haan",
  "nahi",
  "sahi",
  "bilkul",
  "bhai",
  "saale",
]);

const CONTRACTIONS: ReadonlySet<string> = new Set([
  "ain't",
  "aren't",
  "can't",
  "couldn't",
  "didn't",
  "doesn't",
  "don't",
  "gonna",
  "gotta",
  "hadn't",
  "hasn't",
  "haven't",
  "he'd",
  "he's",
  "here's",
  "how's",
  "i'd",
  "i'll",
  "i'm",
  "i've",
  "isn't",
  "it's",
  "kinda",
  "lemme",
  "let's",
  "she'd",
  "she's",
  "shouldn't",
  "sorta",
  "that's",
  "there's",
  "they'd",
  "they'll",
  "they're",
  "they've",
  "wasn't",
  "we'd",
  "we'll",
  "we're",
  "we've",
  "weren't",
  "what's",
  "when's",
  "where's",
  "who's",
  "why's",
  "wanna",
  "won't",
  "wouldn't",
  "you'd",
  "you'll",
  "you're",
  "you've",
]);

const POLITE: ReadonlySet<string> = new Set([
  "absolutely",
  "appreciate",
  "appreciated",
  "certainly",
  "kindly",
  "ma'am",
  "may",
  "pardon",
  "perhaps",
  "please",
  "sir",
  "sorry",
  "thank",
  "thanks",
]);

const ACADEMIC: ReadonlySet<string> = new Set([
  "analysis",
  "analytical",
  "concept",
  "consequently",
  "elaborate",
  "empirical",
  "furthermore",
  "hypothesis",
  "implications",
  "interpretation",
  "methodology",
  "moreover",
  "nevertheless",
  "namely",
  "perspective",
  "principle",
  "significant",
  "theoretical",
  "therefore",
  "thus",
  "underlying",
  "whereas",
]);

const LAUGH: ReadonlySet<string> = new Set([
  "haha",
  "hahaha",
  "hehe",
  "hehehe",
  "lmao",
  "lmfao",
  "lol",
]);

const SUPPORTIVE: ReadonlySet<string> = new Set([
  "don't worry",
  "hang in there",
  "i feel you",
  "i get it",
  "i hear you",
  "i understand",
  "i'm here",
  "i'm sorry to hear",
  "it'll be okay",
  "it's fine",
  "it's okay",
  "stay strong",
  "take your time",
  "that sounds difficult",
  "that sounds hard",
  "you matter",
  "you're not alone",
  "you've got this",
]);

// Relationship-gated — only counted when the relationship permits.
const INTIMATE_MARKERS: ReadonlySet<string> = new Set([
  "can i tell you something personal",
  "i feel safe",
  "i miss you",
  "i need you",
  "i trust you",
  "i'm scared to say",
  "i'm grateful",
  "never told anyone",
  "thank you for being",
  "you mean so much",
  "you matter to me",
]);

const FIRST_PERSON: ReadonlySet<string> = new Set(["i", "me", "my", "mine", "we", "our", "us"]);

const INFORMAL_GREETINGS: ReadonlySet<string> = new Set([
  "hey",
  "hi",
  "hiya",
  "howdy",
  "sup",
  "wassup",
  "what's up",
  "yo",
]);

const FORMAL_GREETINGS: ReadonlySet<string> = new Set([
  "dear",
  "good afternoon",
  "good evening",
  "good morning",
  "hello",
  "how do you do",
]);

const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

// ─── Per-turn classification ─────────────────────────────────────────

const ALL_REGISTERS: ConversationRegister[] = [
  "CASUAL",
  "PROFESSIONAL",
  "ACADEMIC",
  "PLAYFUL",
  "SUPPORTIVE",
  "INTIMATE",
  "NEUTRAL",
];

function emptyScores(): Record<ConversationRegister, number> {
  return {
    CASUAL: 0,
    PROFESSIONAL: 0,
    ACADEMIC: 0,
    PLAYFUL: 0,
    SUPPORTIVE: 0,
    INTIMATE: 0,
    NEUTRAL: 0,
  };
}

/** Split into words, sentences; count marker memberships. */
function analyzeTurn(text: string): {
  words: string[];
  sentenceCount: number;
  avgSentenceLength: number;
  slang: string[];
  contractions: string[];
  polite: string[];
  academic: string[];
  laugh: string[];
  supportive: string[];
  intimate: string[];
  firstPerson: number;
  emojis: number;
  exclamations: number;
  informalGreeting: string | null;
  formalGreeting: string | null;
} {
  const sentences = text
    .split(/[.!?।]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sentenceCount = Math.max(1, sentences.length);
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const wordSet = new Set(words);
  // Punctuation-normalized text — "i trust you," must match "i trust you".
  const phraseText = ` ${text
    .toLowerCase()
    .replace(/[^\p{L}'\s]/gu, " ")
    .replace(/\s+/g, " ")} `;

  const slang: string[] = [];
  const contractions: string[] = [];
  const polite: string[] = [];
  const academic: string[] = [];
  const laugh: string[] = [];
  const supportive: string[] = [];
  const intimate: string[] = [];

  for (const w of words) {
    if (SLANG.has(w)) slang.push(w);
    if (CONTRACTIONS.has(w)) contractions.push(w);
    if (POLITE.has(w)) polite.push(w);
    if (ACADEMIC.has(w)) academic.push(w);
    if (LAUGH.has(w)) laugh.push(w);
  }

  // Phrase-level markers are matched against the normalized text.
  for (const phrase of SUPPORTIVE) {
    if (phraseText.includes(` ${phrase} `)) supportive.push(phrase);
  }
  for (const phrase of INTIMATE_MARKERS) {
    if (phraseText.includes(` ${phrase} `)) intimate.push(phrase);
  }
  for (const g of INFORMAL_GREETINGS) {
    if (phraseText.includes(` ${g} `)) slang.push(g); // greeting doubles as a casual signal
  }
  for (const g of FORMAL_GREETINGS) {
    if (phraseText.includes(` ${g} `)) polite.push(g);
  }

  const firstPerson = words.filter((w) => FIRST_PERSON.has(w)).length;
  const emojis = (text.match(EMOJI_RE) ?? []).length;
  const exclamations = (text.match(/!/g) ?? []).length;

  const informalGreeting =
    [...INFORMAL_GREETINGS].find((g) => phraseText.includes(` ${g} `)) ?? null;
  const formalGreeting = [...FORMAL_GREETINGS].find((g) => phraseText.includes(` ${g} `)) ?? null;

  return {
    words,
    sentenceCount,
    avgSentenceLength: words.length / sentenceCount,
    slang,
    contractions,
    polite,
    academic,
    laugh,
    supportive,
    intimate,
    firstPerson,
    emojis,
    exclamations,
    informalGreeting,
    formalGreeting,
  };
}

/**
 * Classify a single utterance into a canonical register using only
 * deterministic heuristics. Never calls an LLM.
 *
 * Confidence is margin-based: how far the winner outscored the runner-up,
 * decayed for very short utterances (a single word is never trusted).
 */
export function classifyRegisterObservation(
  text: string,
  relationship: RelationshipStage = "ACQUAINTING",
): RegisterObservation {
  const a = analyzeTurn(text);
  const scores = emptyScores();
  const reasons: string[] = [];

  if (a.slang.length > 0) {
    scores.CASUAL += a.slang.length * 2;
    reasons.push(
      `slang/colloquial markers: ${[...new Set(a.slang)].slice(0, 4).join(", ")} (${a.slang.length})`,
    );
  }
  if (a.contractions.length > 0) {
    scores.CASUAL += a.contractions.length;
    reasons.push(
      `contractions: ${[...new Set(a.contractions)].slice(0, 4).join(", ")} (${a.contractions.length})`,
    );
  }
  if (a.informalGreeting) {
    scores.CASUAL += 2;
    reasons.push(`informal greeting "${a.informalGreeting}"`);
  }
  // Short sentences alone never signal CASUAL — they need at least one
  // other casual marker, so plain neutral speech stays neutral.
  if (
    a.avgSentenceLength > 0 &&
    a.avgSentenceLength <= 6 &&
    (a.slang.length > 0 || a.contractions.length > 0)
  ) {
    scores.CASUAL += 1;
    reasons.push(`short sentences (avg ${a.avgSentenceLength.toFixed(1)} words)`);
  }

  // Politeness is orthogonal to formality: a quick "thanks" in a casual
  // conversation is courtesy, not a register change. Politeness only
  // reads PROFESSIONAL when the turn has real sentence structure (at
  // least two words) and no casual signals (slang, laughter, emoji).
  if (
    a.polite.length > 0 &&
    a.avgSentenceLength >= 2 &&
    a.slang.length === 0 &&
    a.laugh.length === 0 &&
    a.emojis === 0
  ) {
    scores.PROFESSIONAL += a.polite.length * 2;
    reasons.push(
      `politeness markers: ${[...new Set(a.polite)].slice(0, 4).join(", ")} (${a.polite.length})`,
    );
  }
  if (a.formalGreeting) {
    scores.PROFESSIONAL += 2;
    reasons.push(`formal greeting "${a.formalGreeting}"`);
  }
  if (a.contractions.length === 0 && a.avgSentenceLength >= 8) {
    scores.PROFESSIONAL += 1;
    reasons.push(
      `no contractions, measured sentences (avg ${a.avgSentenceLength.toFixed(1)} words)`,
    );
  }
  if (a.avgSentenceLength >= 12) {
    scores.PROFESSIONAL += 1;
  }

  if (a.academic.length > 0) {
    scores.ACADEMIC += a.academic.length * 2;
    reasons.push(
      `academic/analytical terms: ${[...new Set(a.academic)].slice(0, 4).join(", ")} (${a.academic.length})`,
    );
  }
  if (a.avgSentenceLength >= 14) {
    scores.ACADEMIC += 1;
    reasons.push(`long structured sentences (avg ${a.avgSentenceLength.toFixed(1)} words)`);
  }
  if (a.contractions.length === 0 && a.avgSentenceLength >= 10 && a.academic.length === 0) {
    // shared with professional — only counts as academic when academic terms exist
    if (a.academic.length > 0) scores.ACADEMIC += 1;
  }

  if (a.laugh.length > 0) {
    scores.PLAYFUL += a.laugh.length * 2;
    reasons.push(`laugh tokens: ${a.laugh.join(", ")}`);
  }
  if (a.emojis > 0) {
    scores.PLAYFUL += a.emojis;
    reasons.push(`emoji usage (${a.emojis})`);
  }
  if (a.exclamations >= 2) {
    scores.PLAYFUL += 2;
    reasons.push("multiple exclamations");
  }

  if (a.supportive.length > 0) {
    scores.SUPPORTIVE += a.supportive.length * 2;
    reasons.push(`supportive phrases: ${a.supportive.slice(0, 3).join(", ")}`);
  }

  // INTIMATE markers are always detected; the relationship clamp below
  // is the single gate that decides whether they are permitted.
  if (a.intimate.length > 0) {
    scores.INTIMATE += a.intimate.length * 2;
    reasons.push(`personal/trusting markers: ${a.intimate.slice(0, 3).join(", ")}`);
  }
  if (
    relationship === "INTIMATE" &&
    a.firstPerson >= 2 &&
    a.avgSentenceLength <= 7 &&
    a.slang.length === 0 &&
    a.polite.length === 0
  ) {
    scores.INTIMATE += 1;
    reasons.push("quiet first-person confession style (established intimacy)");
  }
  if (scores.INTIMATE > 0 && relationship !== "NEW") {
    reasons.push(`relationship gating: INTIMATE permitted at ${relationship}`);
  }

  // Pick the winner; ties and zero-signal fall back to NEUTRAL so an
  // ambiguous turn never hijacks the conversation's momentum.
  const sorted = ALL_REGISTERS.filter((r) => r !== "NEUTRAL")
    .map((r) => ({ r, s: scores[r] }))
    .sort((x, y) => y.s - x.s);
  const winnerScore = sorted[0].s;
  const runnerUpScore = sorted[1]?.s ?? 0;

  if (winnerScore === 0) {
    return {
      register: "NEUTRAL",
      confidence: 0,
      reasons: reasons.length > 0 ? reasons : ["no register signal detected"],
      scores,
      avgSentenceLength: a.avgSentenceLength,
    };
  }

  if (winnerScore === runnerUpScore) {
    return {
      register: "NEUTRAL",
      confidence: 0.2,
      reasons: [
        ...reasons,
        `ambiguous register tie (${sorted[0].r} = ${sorted[1].r}) — treated as neutral`,
      ],
      scores,
      avgSentenceLength: a.avgSentenceLength,
    };
  }

  {
    const register = sorted[0].r;
    const margin = 1 - runnerUpScore / winnerScore;
    let confidence = 0.4 + margin * 0.55;
    if (a.words.length <= 2) confidence *= 0.6; // single-word caution
    if (register === "INTIMATE" && relationship !== "INTIMATE")
      confidence = Math.min(confidence, 0.6);

    const clamped = clampToRelationship(register, scores, relationship);
    if (clamped !== register) {
      // The detected winner is not permitted at this relationship stage —
      // treat as neutral so momentum is never built from an unearned
      // register (e.g. INTIMATE in a brand-new conversation).
      return {
        register: "NEUTRAL",
        confidence: 0,
        reasons: [
          ...reasons,
          `relationship gating: ${register} not permitted at ${relationship} — treated as neutral`,
        ],
        scores,
        avgSentenceLength: a.avgSentenceLength,
      };
    }

    return {
      register,
      confidence: Math.round(Math.min(1, confidence) * 1000) / 1000,
      reasons,
      scores,
      avgSentenceLength: a.avgSentenceLength,
    };
  }
}

// ─── Momentum engine (Executive-owned continuous classification) ─────

const WINDOW_SIZE = 6;
const FLIP_MAJORITY = 3; // ≥3 of the last 6 turns must agree to flip

export class RegisterMomentumEngine {
  private observations: RegisterObservation[] = [];
  private relationship: RelationshipStage = "NEW";
  private state: RegisterState = {
    register: "NEUTRAL",
    confidence: 0,
    stability: 0,
    establishedTurn: 0,
    transitionReason: null,
    confidenceReasons: [],
    momentumWindow: 0,
  };

  /**
   * Feed one turn. Momentum guard: a single "Bro…" or a single polite
   * sentence never flips the conversation register; the new register
   * must win the majority of the recent window.
   */
  observe(text: string, turn: number, relationship: RelationshipStage): RegisterObservation {
    this.relationship = relationship;
    const obs = classifyRegisterObservation(text, relationship);
    this.observations.push(obs);
    if (this.observations.length > WINDOW_SIZE) this.observations.shift();

    const window = this.observations.filter((o) => o.confidence > 0);
    if (window.length === 0) {
      this.state = {
        register: "NEUTRAL",
        confidence: 0,
        stability: 0,
        establishedTurn: turn,
        transitionReason: null,
        confidenceReasons: ["no register signal yet"],
        momentumWindow: window.length,
      };
      return obs;
    }

    const counts = new Map<ConversationRegister, number>();
    for (const o of window) counts.set(o.register, (counts.get(o.register) ?? 0) + 1);
    const maxCount = Math.max(...counts.values());
    const leaders = [...counts.entries()].filter(([, c]) => c === maxCount).map(([r]) => r);
    // Inertia: on a tie the current register wins — a new register must
    // actually out-vote the incumbent before the conversation flips.
    const winner = leaders.includes(this.state.register) ? this.state.register : leaders[0];
    const winnerCount = maxCount;
    const stability = winnerCount / window.length;

    let next = this.state.register;
    let transitionReason = this.state.transitionReason;
    if (this.state.register === "NEUTRAL" && this.state.confidence === 0) {
      // First Conversation Rule (mirrors LanguageState): the first
      // permitted register signal establishes the conversation register.
      next = winner;
      transitionReason = "first register signal in the window";
    } else if (winner !== next && winnerCount >= FLIP_MAJORITY) {
      transitionReason = `${winnerCount}/${window.length} window agreement — ${winner}`;
      next = winner;
    }

    const establishedTurn = next === this.state.register ? this.state.establishedTurn : turn;
    const meanConf = window.reduce((a, o) => a + o.confidence, 0) / window.length;
    const confidence = Math.min(1, meanConf * (0.4 + 0.6 * stability));

    // Explainable confidence — top evidence from the latest observation
    // plus the stability picture. Never a black box.
    const confidenceReasons = [...obs.reasons];
    const ago = Math.max(0, turn - establishedTurn);
    confidenceReasons.push(`stable for ${ago} turn${ago === 1 ? "" : "s"}`);
    if (transitionReason && transitionReason !== this.state.transitionReason) {
      confidenceReasons.push(`transition: ${transitionReason}`);
    }

    this.state = {
      register: next,
      confidence: Math.round(confidence * 1000) / 1000,
      stability: Math.round(stability * 1000) / 1000,
      establishedTurn,
      transitionReason,
      confidenceReasons: [...new Set(confidenceReasons)].slice(0, 6),
      momentumWindow: window.length,
    };
    return obs;
  }

  getRegisterState(): RegisterState {
    return { ...this.state, confidenceReasons: [...this.state.confidenceReasons] };
  }

  /** Reset (new session). */
  reset(): void {
    this.observations = [];
    this.relationship = "NEW";
    this.state = {
      register: "NEUTRAL",
      confidence: 0,
      stability: 0,
      establishedTurn: 0,
      transitionReason: null,
      confidenceReasons: [],
      momentumWindow: 0,
    };
  }
}

// ─── Deterministic downstream mappings ───────────────────────────────

const REGISTER_RULES: Record<ConversationRegister, string> = {
  CASUAL:
    "respond in relaxed, conversational language — contractions, short sentences, light slang, no formality; mirror the user's casual ease",
  PROFESSIONAL:
    "respond courteously and professionally — measured tone, polite phrasing, minimal contractions, no slang, keep it crisp",
  ACADEMIC:
    "respond precisely and analytically — structured reasoning, formal register, precise vocabulary, no slang",
  PLAYFUL:
    "respond lightly and playfully — warmth, humor, relaxed energy, occasional light teasing, matching their fun",
  SUPPORTIVE:
    "respond gently and supportively — short warm lines, validate the feeling first, never lecture, no cheerleading",
  INTIMATE:
    "respond quietly, personally and gently — soft, close, unhurried, relationship-aware; never exaggerated, never performative",
  NEUTRAL:
    "match the user's register naturally — no strong register of your own; keep it plain and unforced",
};

/** Deterministic prompt directive — the LLM's only register instruction. */
export function registerPromptDirective(state: RegisterState): string {
  return (
    `register: ${state.register} (confidence ${state.confidence.toFixed(2)}, ` +
    `stable since turn ${state.establishedTurn}) — ${REGISTER_RULES[state.register]}`
  );
}

/** Relationship line for the prompt — one concise deterministic note. */
export function relationshipPromptDirective(stage: RelationshipStage): string {
  const NOTE: Record<RelationshipStage, string> = {
    NEW: "first conversation — keep responses measured and warm",
    ACQUAINTING: "getting to know each other — warm, still discovering",
    COMFORTABLE: "familiar and at ease — natural closeness is fine",
    INTIMATE: "close and trusting — speak softly, honestly, unhurried",
  };
  return `relationship: ${stage} — ${NOTE[stage]}`;
}
