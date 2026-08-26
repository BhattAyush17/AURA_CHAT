# AURA Phase 8.1 — Conversational Register & Linguistic Identity

Status: IMPLEMENTED — deterministic engine + Executive wiring + diagnostics + harness verified.
Run: `npx tsx scripts/test-register.ts` (ALL PASS), `npx tsx scripts/test-language.ts` (regression ALL PASS),
`npx tsx scripts/test-executive.ts` (8/8), `tsc --noEmit` 0 new errors, `eslint` clean.

---

## 1. Mission

Phase 8 made Language a deterministic Executive decision. Phase 8.1 makes Register the second.

- Language answers: *"What language should AURA speak?"*
- Register answers: *"How should AURA sound?"*

Both are Executive decisions. The LLM never infers either — it realizes them.

## 2. Architecture (extended, not duplicated)

```
ConversationContext (language + register + emotion + relationship inputs)
   ↓
LanguageState (momentum)  RegisterState (momentum, relationship-gated)   ← NEW: RegisterState.ts
   ↓                                     ↓
ExecutionPlan (language + register + relationship)
   ↓
translatePlanToPrompt (one concise deterministic directive per decision)
   ↓
LLM (expresses; never decides)
   ↓
TTS / speech (language-driven voice code, unchanged)
```

No new runtime, no new manager: `RegisterMomentumEngine` lives in the Executive exactly like
`LanguageMomentumEngine`. No `RegisterManager` / `RegisterEngine` / `ConversationStyleEngine`
/ `AdaptiveLanguageManager` / `SpeechStyleRuntime` were created.

## 3. RegisterState

File: `src/executive/RegisterState.ts`

```
register            — CASUAL | PROFESSIONAL | ACADEMIC | PLAYFUL | SUPPORTIVE | INTIMATE | NEUTRAL
confidence          — 0–1, margin-based, never a black box
stability           — 0–1, window agreement
establishedTurn     — when the current register was established
transitionReason    — why it changed (null = never changed)
confidenceReasons   — human-readable evidence (always populated)
momentumWindow      — 0–6, how many turns the decision rests on
```

### Detection (deterministic heuristics, no LLM)

Per-utterance signals: slang, contractions, greetings (formal/informal), politeness markers,
academic/analytical terms, laugh tokens, emoji, exclamations, supportive phrases, intimate
markers, first-person density, average sentence length. Confidence is margin-based
(winner vs runner-up), decayed for ≤2-word utterances, and ties resolve to NEUTRAL (0.2) so an
ambiguous turn never hijacks momentum.

### Momentum (mirrors LanguageState)

- Window = last 6 observations; ties favor the incumbent (inertia).
- A register flips only when it wins ≥3 of the last 6 turns (`FLIP_MAJORITY`).
- Verified against the spec's own examples:
  - `"Bro..."` once in a professional conversation → **stays PROFESSIONAL**.
  - One polite sentence in a casual conversation → **stays CASUAL**.
  - Gradual shift C,C,C,P,P,P,P → flips only at turn 7 with `transitionReason = "4/6 window agreement — PROFESSIONAL"`.

### Relationship ladder (register evolves with the relationship, not the topic)

`determineRelationshipStage({sessionTurn, hasPersonalHistory, trust})`:

| Stage | Turn / trust condition | Permitted registers |
|---|---|---|
| NEW | < 3 turns | NEUTRAL, PROFESSIONAL, ACADEMIC, SUPPORTIVE |
| ACQUAINTING | ≥ 3 | + CASUAL, PLAYFUL |
| COMFORTABLE | ≥ 10, or (history ∧ ≥5) | + INTIMATE (confidence capped 0.6) |
| INTIMATE | ≥ 20 ∧ trust ≥ 0.65 | INTIMATE full |

Gating is a single clamp: a register not permitted at the current stage is treated as NEUTRAL
with zero confidence — it can never build momentum. Intimacy must be earned:
`"I trust you, you matter to me"` at NEW → NEUTRAL; at COMFORTABLE → INTIMATE (capped).
The ladder only moves forward; turns + history + trust are the only inputs.

## 4. Prompt Builder

`translatePlanToPrompt` now emits (alongside the existing language line):

```
register: CASUAL (confidence 0.81, stable since turn 3) — respond in relaxed, conversational
    language — contractions, short sentences, light slang, no formality
relationship: ACQUAINTING — getting to know each other — warm, still discovering
```

One concise deterministic instruction per decision. No heuristics in the prompt. The LLM
realizes; it does not infer.

## 5. Confidence Explanation

Every confidence value in **both** engines is explainable:

- `LanguageState` extended with `transitionReason`, `confidenceReasons`, `momentumWindow`
  (e.g. `"72% Hindi tokens", "Hindi discourse markers: yaar, haan", "stable for 8 turns"`).
- `RegisterState` populated per observation (e.g. `"slang/colloquial markers: bro (1)"`,
  `"informal greeting \"hey\""`, `"relationship gating: INTIMATE permitted at COMFORTABLE"`,
  `"stable for 5 turns"`, `"transition: 3/6 window agreement — CASUAL"`).

Harness asserts reasons are non-empty and human-readable for both engines.

## 6. Runtime Diagnostics

Extended the existing `ConversationTelemetryPanel` (no new panel). A "Conversational Identity"
card now shows the latest `EXECUTIVE_REGISTER` trace: Conversation Language, Conversation
Register, Language/Register Confidence, Language/Register Stability, Momentum Window,
Transition Reason, Confidence Explanation, Relationship Stage, Current Executive Decision.
`useSarvam.ts` pushes the trace every turn from the canonical plan.

## 7. Executive Validation Chain

```
Language (momentum) → Register (momentum, gated) → ExecutionPlan → Prompt → LLM → Speech
```

Verified end-to-end in `scripts/test-register.ts`: detected register → conversation register →
prompt directive → plan consistency (`plan.register === executive state`) →
relationship matches the deterministic ladder. No component independently infers register;
the Executive is the single owner.

## 8. Human Validation (required before closing the phase)

Run at least 100 real conversational turns across the full matrix. For every turn record:
Detected Language, Detected Register, Language Confidence, Register Confidence, Conversation
Language, Conversation Register, Prompt Directive, TTS Output, Observed Response, Expected
Response, and "Did AURA naturally mirror the user's communication style? YES / NO (+ why)".

| Scenario | Target turns | What to watch |
|---|---|---|
| Pure English | 10 | stays PURE_ENGLISH, no Hindi leakage |
| Pure Hindi | 10 | stays PURE_HINDI |
| Hinglish | 10 | balance mirrored, technical terms kept as spoken |
| Formal English | 8 | PROFESSIONAL/ACADEMIC respected |
| Academic English | 8 | ACADEMIC, no slang |
| Professional interview | 10 | register survives brief "Bro" type slips |
| Casual friends | 12 | CASUAL from turn 3+, no flip on one polite line |
| Late-night conversation | 8 | casual/low-energy, no formality creep |
| Emotional support | 10 | SUPPORTIVE, warmth before information |
| Technical discussion | 8 | ACADEMIC/PROFESSIONAL, language keeps English terms |
| Playful banter | 8 | PLAYFUL matched, never forced |
| Relationship progression | 8+ | NEW → ACQUAINTING → COMFORTABLE; intimacy only after earned |

Success: the user never consciously notices adaptation — they feel "she's speaking the way I
speak", not "she's changing personalities".

## 9. Final Validation

1. **Does Language remain deterministic?** YES — unchanged momentum engine; now with explainable confidence.
2. **Does Register remain deterministic?** YES — heuristics + momentum + relationship ladder; harness-verified.
3. **Does the Executive own both?** YES — both engines live inside `ConversationExecutive`, both in `ExecutionPlan`.
4. **Does the LLM merely express them?** YES — two directive lines; the LLM never receives heuristics.
5. **Does adaptation feel invisible?** PENDING — needs the 100-turn human matrix (Section 8).
6. **Would two humans naturally converse this way?** PENDING — same human gate.

Language + register together form the Conversational Identity Layer. Language tells AURA what
words to use; register tells AURA who she is in that conversation.
