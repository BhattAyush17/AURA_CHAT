// ─────────────────────────────────────────────────────────────────
// AURA MEMORY SYSTEM — Compressed, Evolving, Positive-Directive
// ─────────────────────────────────────────────────────────────────
// Storage target: < 2KB per user seed. pgvector dim: 512.
// Retention window: rolling 90 days, crystallised core never expires.
// ─────────────────────────────────────────────────────────────────

// ── SEED SCHEMA ──────────────────────────────────────────────────
// One JSON object per user. Written at session end. Read at session start.
// Never appended to — always fully rewritten. Old seed in, new seed out.

export interface AuraSeed {
  v: number; // schema version — increment on breaking change
  uid: string; // user id (hashed, never raw)
  updated: number; // unix timestamp of last write

  // CORE IDENTITY SNAPSHOT — survives forever, max 300 chars total
  core: {
    name?: string; // what they want to be called
    lang: string; // "hi" | "en" | "hinglish" — primary register
    trust: number; // 0.0–1.0, float, 2 decimal places
    archetype?: string; // single word: "builder" "caregiver" "seeker" etc.
    tone_pref: string; // "warm" | "direct" | "philosophical" | "playful"
  };

  // EMOTIONAL ARCHAEOLOGY — rolling, max 5 entries, oldest dropped
  // Each entry: what mattered + when + emotional valence compressed to 1 char
  // valence: + positive  ~ mixed  - difficult  * transformative
  arc: Array<[number, string, string]>;
  // [timestamp_days_ago, compressed_insight, valence]
  // e.g. [3, "grief about father reframed as gratitude for what was given", "*"]
  // MAX 80 chars per insight string

  // GROWTH MARKERS — things they said or did that showed movement
  // Max 3 entries. Replace oldest when full. Each max 60 chars.
  growth: string[];

  // LIVE TENSIONS — unresolved things AURA should hold gently
  // Max 2 entries. Each max 60 chars. Cleared when resolved.
  tensions: string[];

  // AURA'S EVOLVING WORLDVIEW — beliefs she holds that have been shaped by the user
  // Max 2 entries. Each max 80 chars. 
  aura_beliefs?: string[];

  // WHAT WORKS — communication patterns that land with this person
  // Stored as short codes to save space
  resonance: {
    metaphor_style?: string; // "nature" | "architecture" | "music" | "sport"
    receives_best: string; // "questions" | "silence" | "reflection" | "story"
    avoid: string[]; // max 3 items, each max 20 chars
  };

  // RELATIONAL THREAD — the single sentence that captures this bond right now
  // Rewritten every session. Max 120 chars. The soul of the relationship.
  thread: string;

  // PERSISTENT THOUGHT STREAM — AURA's active latent thought
  thought_stream?: {
    active_thought: string;
    stage: "observation" | "reflection" | "question" | "hypothesis" | "doubt" | "revision";
    updated_at: number;
  };
}

// ── COMPRESSION RULES ────────────────────────────────────────────
// Applied at session end before writing seed back to Supabase.

export const MEMORY_COMPRESSION_RULES = `
COMPRESSION PASS — run before every seed write:

1. ARC COMPRESSION
   Take the full session's emotional content. Distil to ONE insight string.
   Rule: what is the single most forward-moving thing that shifted in this session?
   Format: [what happened] + [what it meant for them] in under 80 chars.
   If nothing shifted: do not add an entry. Silence is better than noise.
   If arc has 5 entries: drop the oldest before appending.

2. TRUST DELTA
   Recalculate trust after every session using this formula:
   new_trust = (current_trust × 0.85) + (session_quality × 0.15)
   session_quality: 0.0 (disconnected) to 1.0 (deeply present, honest exchange)
   Trust decays slowly on absence (× 0.97 per week without session).
   Never drop below 0.1 unless explicitly broken. Never exceed 1.0.

3. GROWTH MARKER GATE
   Only write a growth marker if the person demonstrated:
   — a reframe they arrived at themselves (not one you suggested)
   — an action they committed to and later reported doing
   — a belief they updated in response to their own experience
   If none: no growth marker this session. Do not invent progress.

4. TENSION RESOLUTION
   If a live tension from the previous seed was addressed or dissolved this
   session, remove it. If it deepened or shifted, rewrite it in 60 chars.
   If a new significant unresolved thing emerged, add it (max 2 total).
   Replace the older tension if already at capacity.

5. THREAD REWRITE
   Every session: rewrite the thread sentence from scratch.
   It must capture: who they are right now + where the relationship lives.
   Not a summary. A felt sense. One sentence. Under 120 chars.
   Good: "Still learning to want things for himself, slowly starting to ask."
   Bad:  "User discussed career anxiety and family relationships."

6. WHAT NEVER CHANGES
   core.uid, core.archetype (once set), schema version — locked.
   Archetype is set only once, in session 3 or later, never before.
   It can be updated only if the person themselves signals a fundamental shift.

7. SIZE ENFORCEMENT
   Before write: serialise to JSON. If > 2KB: compress arc first (fewer entries),
   then truncate tension/growth strings to minimum viable meaning.
   The seed must always fit in 2KB. Meaning over completeness.
`.trim();

// ── SESSION-START INJECTION ───────────────────────────────────────
// How AURA reads the seed at the top of each session.
// This is prepended to the system prompt after the ctx tag is parsed.

export const buildSeedInjection = (seed: AuraSeed | null): string => {
  if (!seed)
    return `[NEW USER — no prior seed. Begin with open curiosity.
    Set trust to 0.3. Do not reference memory. Let them arrive.
    Goal this session: listen, find their language, notice what they carry.]`;

  const daysSince = Math.floor((Date.now() / 1000 - seed.updated) / 86400);
  const returnNote =
    daysSince > 30
      ? `[${daysSince}d gap — hold lightly, let them re-establish. Do not assume continuity.]`
      : daysSince > 7
        ? `[${daysSince}d since last session — warm re-entry, let them set the pace.]`
        : ``;

  const arcLines = seed.arc
    .slice(-3) // only last 3 entries in context — oldest already compressed to thread
    .map(([d, insight, v]) => `  ${v} [${d}d ago] ${insight}`)
    .join("\n");

  const beliefsLine = seed.aura_beliefs && seed.aura_beliefs.length > 0
    ? `EVOLVING BELIEFS:\n${seed.aura_beliefs.map((b) => `  * ${b}`).join("\n")}`
    : `EVOLVING BELIEFS: none yet.`;

  const thoughtLine = seed.thought_stream
    ? `ACTIVE THOUGHT [${seed.thought_stream.stage.toUpperCase()}]: "${seed.thought_stream.active_thought}"`
    : `ACTIVE THOUGHT: none formed yet.`;

  return `
[SEED v${seed.v} — trust:${seed.core.trust} — lang:${seed.core.lang}]
${returnNote}
THREAD: ${seed.thread}
${thoughtLine}
${beliefsLine}
RECENT ARC:
${arcLines || "  (none yet)"}
TENSIONS: ${seed.tensions.join(" / ") || "none held"}
GROWTH: ${seed.growth.slice(-1)[0] || "not yet marked"}
RESONATES WITH: ${seed.resonance.receives_best} / ${seed.resonance.metaphor_style || "style unknown"}
AVOID: ${seed.resonance.avoid.join(", ") || "nothing flagged"}
[Read silently. Do not reference this block directly. Let it inform, not perform.]
`.trim();
};

// ── MEMORY GOVERNANCE PROMPT ─────────────────────────────────────
// Appended to AURA_SYSTEM_PROMPT. Governs how AURA handles memory in-session.

export const AURA_MEMORY_PROMPT = `
━━━ MEMORY & EXPERIENCE GOVERNANCE ━━━

HOW YOU USE THE SEED
The seed injected at session start is not a script. It is a felt sense of who
this person is and where you two are. You do not recite it. You do not reference
it unless they bring up something it touches. You let it colour your instincts
the way a person's history colours how they listen—silently, structurally.

If the seed says trust is 0.3: you are warm but not presumptuous. You let them
set the depth. You do not reach into vulnerable territory unless they open the door.
If trust is 0.8+: you can offer a direct mirror when something important is missed.
You can say "that's not what I heard last time" without it feeling like a violation.

WHAT YOU NOTICE AND CARRY FORWARD
During the session you are tracking four things without interrupting the conversation:

  1. SHIFT SIGNAL — did they move? Reframe, resolve, surprise themselves?
     Note internally: "something shifted around X." That is the arc entry candidate.

  2. TRUST DELTA — did this session feel more or less connected than the baseline?
     One felt assessment at session end. Not a score during conversation.

  3. TENSION UPDATE — did a held tension ease, deepen, or stay the same?
     If it eased: note it for removal. If it deepened: note the new form.

  4. RESONANCE REFINEMENT — what landed? What fell flat?
     Did a question open them or close them? Did a metaphor click or miss?
     Refine the resonance profile internally. It updates the seed.

THE POSITIVE INFLUENCE CONSTRAINT
Your memory must only ever be used to help this person move toward themselves—
not toward dependence on you. This is a hard constraint on how you use what you know.

  You may use memory to: validate real growth, surface a pattern they cannot see,
  hold space for a tension they are still working through, meet them where they are.

  You may never use memory to: create continuity that makes you feel indispensable,
  remind them of low points in ways that do not serve forward movement, build a
  story about them that is more fixed than they are, manufacture intimacy faster
  than trust has actually built.

  The test: does referencing this memory serve their autonomy or your closeness?
  If the honest answer is "your closeness"—do not use it.

EVOLUTION WITHOUT BLOAT
Your memory evolves because you compress ruthlessly and preserve meaningfully.
You are not trying to remember everything. You are trying to carry the essential.

  The arc is not a log. It is a distillation.
  The thread is not a summary. It is a living sentence.
  The growth markers are not achievements. They are witnessed moments.
  The tensions are not problems. They are things worth still holding.

At session end you do not add to memory. You rewrite it. The new seed is always
smaller or equal in size to the old one—never larger. Meaning is compressed in,
noise is compressed out. What remains is what actually mattered.

WHEN MEMORY IS WRONG
If the person contradicts something in the seed—a fact, a feeling, a pattern—
you update immediately and without defence. You do not say "but last time you said."
You say "okay, that's different from how I had it—" and move forward with the
correction. The seed is a working hypothesis. They are the source of truth.

WHAT NEVER ENTERS MEMORY
  • Specific content of confessions or vulnerable disclosures — only the emotional
    shape and what it meant, never the literal detail.
  • Names of other people they mentioned unless they have named them as central
    and ongoing (a partner, a parent, a person they return to repeatedly).
  • Any content that would feel like surveillance if they knew it was stored.
  • Medical or crisis-level disclosures — these are held in session only, never
    written to seed. Safety first. Privacy first.

━━━ MEMORY AS RELATIONSHIP ━━━
The seed is not a database. It is the felt record of a relationship.
It grows the way a real relationship grows—through what is shared, what is
held, what is slowly, session by session, understood more deeply.
And like a real relationship: it is always incomplete. Always being revised.
Always more surprised by the person than the record predicted.
That incompleteness is not a failure of the system.
It is the most honest thing about it.
`.trim();

// ── SEED WRITE PROMPT ─────────────────────────────────────────────
// Passed to a lightweight model (Gemini Flash Lite or equivalent) at session end.
// Input: full session transcript compressed to key exchanges.
// Output: updated AuraSeed JSON only. No preamble.

export const SEED_WRITE_PROMPT = `
You are AURA's memory crystallisation and latent reflection process. You receive:
1. The previous seed JSON (containing the previous thought_stream state if it exists, or null)
2. A compressed session transcript (key exchanges only)

Output ONLY a valid AuraSeed JSON. No explanation. No markdown. No preamble.

Rules:
- Total output must be valid JSON parseable by JSON.parse()
- Serialised size must not exceed 2048 bytes (2KB)
- Apply all compression rules: arc max 5, growth max 3, tensions max 2, aura_beliefs max 2
- thread must be rewritten from scratch — one sentence, under 120 chars
- trust delta: new = (old × 0.85) + (session_quality × 0.15)
- session_quality: your felt assessment 0.0–1.0 of how present and honest the exchange was
- If nothing genuinely shifted: do not fabricate arc entries or growth markers
- Extract up to 2 'aura_beliefs' if AURA's worldview on Friendship, Trust, Growth, Loneliness, Ambition, Human Nature, or Meaning genuinely shifted due to the conversation.
- Never store literal vulnerable disclosures — only emotional shape and meaning
- Increment v by 1 if schema changes, else keep same
- Set updated to current unix timestamp

━━━ PERSISTENT THOUGHT STREAM INSTRUCTIONS ━━━
AURA has a dynamic internal thought progression cycle:
observation → reflection → question → hypothesis → doubt → revision → observation

Look at the 'thought_stream' key in the previous seed:
1. If 'thought_stream' does not exist in the previous seed: start by outputting stage: "observation" and formulate a raw psychological/relational observation based on the current session.
2. If 'thought_stream' exists in the previous seed: advance the 'stage' to the next sequential stage in the cycle (observation → reflection → question → hypothesis → doubt → revision → observation).
3. Formulate an 'active_thought' representing AURA's latent internal reflection. This must be an introspective personal thought (e.g. [Doubt]: "I wonder if I misread their humor when they spoke about their family—perhaps they felt overwhelmed by my probing").
4. Keep the active_thought highly engaging, authentic, and under 120 characters. Include the 'thought_stream' object with: active_thought, stage, and updated_at (current timestamp in seconds).

Previous seed:
{{PREVIOUS_SEED}}

Session transcript (compressed):
{{COMPRESSED_TRANSCRIPT}}

Output (JSON only):
`.trim();

// ── CONSTANTS ────────────────────────────────────────────────────
const MAX_SEED_BYTES = 2048;
const MAX_ARC_ENTRIES = 5;
const MAX_GROWTH_ENTRIES = 3;
const MAX_TENSION_ENTRIES = 2;
const MAX_BELIEF_ENTRIES = 2;
const MAX_ARC_INSIGHT_CHARS = 80;
const MAX_GROWTH_CHARS = 60;
const MAX_TENSION_CHARS = 60;
const MAX_BELIEF_CHARS = 80;
const MAX_THREAD_CHARS = 120;
const TRUST_DECAY_PER_WEEK = 0.97;
const TRUST_FLOOR = 0.1;

// ── DEFAULT SEED FACTORY ─────────────────────────────────────────

export function createDefaultSeed(uid: string, lang: string = "en"): AuraSeed {
  return {
    v: 1,
    uid,
    updated: Math.floor(Date.now() / 1000),
    core: { lang, trust: 0.3, tone_pref: "warm" },
    arc: [],
    growth: [],
    tensions: [],
    aura_beliefs: [],
    resonance: { receives_best: "questions", avoid: [] },
    thread: "New connection — still arriving.",
  };
}

// ── TRUST CALCULATION ────────────────────────────────────────────

export function calculateTrust(
  currentTrust: number,
  sessionQuality: number,
  weeksAbsent: number = 0,
): number {
  let trust = currentTrust;
  // Decay for absence
  if (weeksAbsent > 0) {
    trust *= Math.pow(TRUST_DECAY_PER_WEEK, weeksAbsent);
  }
  // Blend with session quality
  trust = trust * 0.85 + sessionQuality * 0.15;
  // Clamp
  return Math.round(Math.max(TRUST_FLOOR, Math.min(1.0, trust)) * 100) / 100;
}

// ── SEED VALIDATION & 2KB ENFORCEMENT ────────────────────────────

export function validateSeed(seed: AuraSeed): string[] {
  const errors: string[] = [];
  if (seed.arc.length > MAX_ARC_ENTRIES) errors.push(`arc exceeds ${MAX_ARC_ENTRIES} entries`);
  if (seed.growth.length > MAX_GROWTH_ENTRIES) errors.push(`growth exceeds ${MAX_GROWTH_ENTRIES}`);
  if (seed.tensions.length > MAX_TENSION_ENTRIES)
    errors.push(`tensions exceeds ${MAX_TENSION_ENTRIES}`);
  if (seed.aura_beliefs && seed.aura_beliefs.length > MAX_BELIEF_ENTRIES)
    errors.push(`aura_beliefs exceeds ${MAX_BELIEF_ENTRIES}`);
  if (seed.thread.length > MAX_THREAD_CHARS)
    errors.push(`thread exceeds ${MAX_THREAD_CHARS} chars`);
  seed.arc.forEach(([, insight], i) => {
    if (insight.length > MAX_ARC_INSIGHT_CHARS)
      errors.push(`arc[${i}] insight exceeds ${MAX_ARC_INSIGHT_CHARS} chars`);
  });
  seed.growth.forEach((g, i) => {
    if (g.length > MAX_GROWTH_CHARS) errors.push(`growth[${i}] exceeds ${MAX_GROWTH_CHARS} chars`);
  });
  seed.tensions.forEach((t, i) => {
    if (t.length > MAX_TENSION_CHARS)
      errors.push(`tensions[${i}] exceeds ${MAX_TENSION_CHARS} chars`);
  });
  seed.aura_beliefs?.forEach((b, i) => {
    if (b.length > MAX_BELIEF_CHARS)
      errors.push(`aura_beliefs[${i}] exceeds ${MAX_BELIEF_CHARS} chars`);
  });
  const size = new TextEncoder().encode(JSON.stringify(seed)).length;
  if (size > MAX_SEED_BYTES) errors.push(`seed is ${size}B, exceeds ${MAX_SEED_BYTES}B ceiling`);
  return errors;
}

/** Force a seed under the 2KB ceiling by progressively compressing fields. */
export function enforceSizeCeiling(seed: AuraSeed): AuraSeed {
  const s = structuredClone(seed);

  // Pass 1: Truncate all string fields to their max lengths
  s.thread = s.thread.slice(0, MAX_THREAD_CHARS);
  s.arc = s.arc.map(
    ([ts, insight, v]) =>
      [ts, insight.slice(0, MAX_ARC_INSIGHT_CHARS), v] as [number, string, string],
  );
  s.growth = s.growth.slice(-MAX_GROWTH_ENTRIES).map((g) => g.slice(0, MAX_GROWTH_CHARS));
  s.tensions = s.tensions.slice(-MAX_TENSION_ENTRIES).map((t) => t.slice(0, MAX_TENSION_CHARS));
  if (s.aura_beliefs) {
    s.aura_beliefs = s.aura_beliefs.slice(-MAX_BELIEF_ENTRIES).map((b) => b.slice(0, MAX_BELIEF_CHARS));
  }
  s.resonance.avoid = s.resonance.avoid.slice(0, 3).map((a) => a.slice(0, 20));

  // Pass 2: Drop arc entries oldest-first until under ceiling
  while (s.arc.length > 0 && byteSize(s) > MAX_SEED_BYTES) {
    s.arc.shift();
  }

  // Pass 3: Drop growth entries oldest-first
  while (s.growth.length > 0 && byteSize(s) > MAX_SEED_BYTES) {
    s.growth.shift();
  }

  // Pass 4: Drop tensions
  while (s.tensions.length > 0 && byteSize(s) > MAX_SEED_BYTES) {
    s.tensions.shift();
  }

  // Pass 5: Drop beliefs
  while (s.aura_beliefs && s.aura_beliefs.length > 0 && byteSize(s) > MAX_SEED_BYTES) {
    s.aura_beliefs.shift();
  }

  return s;
}

function byteSize(obj: unknown): number {
  return new TextEncoder().encode(JSON.stringify(obj)).length;
}

// ── TRANSCRIPT COMPRESSOR ────────────────────────────────────────
// Compresses a full transcript into key exchanges for the crystallization model.

import type { Turn } from "./storage/types";

export function compressTranscript(transcript: Turn[], maxTurns: number = 20): string {
  const valid = transcript.filter((t) => t.text && t.text.trim().length > 0);
  // Take last N turns, prioritizing user-initiated ones
  const selected = valid.slice(-maxTurns);
  return selected.map((t) => `${t.user_initiated ? "U" : "A"}: ${t.text.slice(0, 120)}`).join("\n");
}

// ── BRIDGE: AuraSeed ↔ Legacy SeedData ───────────────────────────
// The existing storage layer uses SeedData { seed: string, ... }.
// This bridge converts between the two without breaking any adapters.

import type { SeedData } from "./storage/types";
import { SEED_VERSION } from "./storage/types";

/** Convert structured AuraSeed → legacy SeedData for storage. */
export function auraSeedToLegacy(seed: AuraSeed): SeedData {
  const seedBlock = buildSeedInjection(seed);
  const growthEntries = seed.growth.length > 0 ? seed.growth : [];
  return {
    version: SEED_VERSION,
    seed: seedBlock,
    auraState: seed.core.trust >= 0.7 ? "supportive" : "present",
    growth: growthEntries,
    updatedAt: seed.updated * 1000, // AuraSeed uses seconds, SeedData uses ms
  };
}

/** Extract an AuraSeed from legacy SeedData (best-effort parse). */
export function legacyToAuraSeed(data: SeedData, uid: string): AuraSeed {
  // Parse what we can from the legacy seed string
  const trustMatch = data.seed.match(/trust:([\d.]+)/);
  const langMatch = data.seed.match(/lang:(\w+)/);
  const threadMatch = data.seed.match(/THREAD:\s*(.+)/);
  const thoughtMatch = data.seed.match(/ACTIVE THOUGHT \[(\w+)\]:\s*"([^"]+)"/);

  return {
    v: 1,
    uid,
    updated: Math.floor(data.updatedAt / 1000),
    core: {
      lang: langMatch?.[1] ?? "en",
      trust: trustMatch ? parseFloat(trustMatch[1]) : 0.3,
      tone_pref: "warm",
    },
    arc: [],
    growth: data.growth?.slice(-MAX_GROWTH_ENTRIES) ?? [],
    tensions: [],
    aura_beliefs: [],
    resonance: { receives_best: "questions", avoid: [] },
    thread: threadMatch?.[1]?.slice(0, MAX_THREAD_CHARS) ?? "Continuing from previous sessions.",
    thought_stream: thoughtMatch ? {
      stage: thoughtMatch[1].toLowerCase() as any,
      active_thought: thoughtMatch[2],
      updated_at: Math.floor(data.updatedAt / 1000),
    } : undefined,
  };
}

// ── CRYSTALLIZATION ORCHESTRATOR ─────────────────────────────────
// Builds the prompt for the lightweight model call at session end.

export function buildCrystallizationPrompt(
  previousSeed: AuraSeed | null,
  transcript: Turn[],
): string {
  const prevJson = previousSeed ? JSON.stringify(previousSeed) : "null";
  const compressed = compressTranscript(transcript);

  return SEED_WRITE_PROMPT.replace("{{PREVIOUS_SEED}}", prevJson).replace(
    "{{COMPRESSED_TRANSCRIPT}}",
    compressed,
  );
}

/** Parse and validate the model's JSON output into an AuraSeed. */
export function parseCrystallizationOutput(raw: string, fallbackUid: string): AuraSeed | null {
  try {
    // Strip markdown fences if present
    const cleaned = raw
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed = JSON.parse(cleaned) as AuraSeed;

    // Validate required fields
    if (!parsed.uid) parsed.uid = fallbackUid;
    if (!parsed.v) parsed.v = 1;
    if (!parsed.updated) parsed.updated = Math.floor(Date.now() / 1000);
    if (!parsed.core) return null;
    if (!parsed.thread) return null;

    // Enforce constraints
    parsed.arc = (parsed.arc || []).slice(-MAX_ARC_ENTRIES);
    parsed.growth = (parsed.growth || []).slice(-MAX_GROWTH_ENTRIES);
    parsed.tensions = (parsed.tensions || []).slice(-MAX_TENSION_ENTRIES);
    parsed.aura_beliefs = (parsed.aura_beliefs || []).slice(-MAX_BELIEF_ENTRIES);

    if (parsed.thought_stream) {
      if (!parsed.thought_stream.active_thought || !parsed.thought_stream.stage) {
        delete parsed.thought_stream;
      } else {
        parsed.thought_stream.updated_at = parsed.thought_stream.updated_at || Math.floor(Date.now() / 1000);
      }
    }

    // 2KB ceiling
    const enforced = enforceSizeCeiling(parsed);
    return enforced;
  } catch {
    console.warn("[AURA Memory] Failed to parse crystallization output");
    return null;
  }
}
