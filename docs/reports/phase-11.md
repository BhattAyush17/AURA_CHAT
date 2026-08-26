# AURA Phase 11 — Conversational Understanding Engine (CUE)

One layer interprets what a conversation means; everything else consumes it.
Before the Executive decides, `understand(ctx)` produces a single immutable
`ConversationUnderstanding` — literal meaning, conversational move, speaker
goal, expected response, implicit meaning, social signals, conversation state,
shared context, and confidence with alternatives. The Executive, the
StrategyPlanner, ClarificationPolicy, InitiativePolicy, MemoryPolicy,
ConfidenceManager, InformationBudget, SpeechBehaviorPlanner,
ObservableThinking, and ReflectionEngine all read from that one object.
Nothing else in the codebase infers conversation meaning.

Method: canonical-layer construction inside the existing Executive (no new
managers/planners/runtimes), telemetry extension only, deterministic gate
harness, and a 154-scenario human benchmark with a Conversation Understanding
Index.

---

## 1. Why this phase existed

Phase 9/10 built gates that understood turns: `isRejection`, `isHoldTurn`,
`isRetraction`, `isCorrection`, `isTrailingOff`, `isIrony`,
`isBackchannel`, `isGreeting`, `isFarewell` — six different consumers
(StrategyPlanner, ClarificationPolicy, InitiativePolicy, useSarvam) each
holding their own half-implementations of the same interpretation logic.
Three failure modes follow from that design:

1. **Duplicate detection drifted.** The StrategyPlanner's `isRejection`
   and the CUE's repair detection could disagree; nothing forced one
   reading of a turn.
2. **Meaning lived in the prompt path.** Raw interpretation reasoning
   (`understanding: literal=statement`) was pushed into the LLM prompt via
   confidence sources — the model saw CUE internals instead of decisions.
3. **No accountability.** Nobody could say "this turn meant X with
   confidence Y and here are the alternatives" — there was no
   measurement surface.

CUE is the single answer: one builder, one immutable object, one telemetry
trace, and two harnesses that hold it to account.

## 2. The one canonical object

`understand(ctx)` (ConversationUnderstanding.ts:447) builds and deep-freezes:

| Field | What it carries |
|---|---|
| `literal` | 15-class surface meaning: greeting, question, answer, story, opinion, correction, repair, goodbye, silence, thinking, trailing, retraction, request, backchannel, statement |
| `move` | 12-class evidence-weighted move (Ask/Answer/Comfort/Challenge/Clarify/Repair/Reflect/Explore/Observe/Continue/Close/Wait) |
| `speakerGoal` | seek-information, seek-comfort, express-uncertainty, repair, drop-thread, think-aloud, small-talk, close, teach, debate, share-excitement, complain, tell-story, test-aura, seek-validation, inform |
| `expected` | what AURA should do back: information, empathy, agreement, challenge, clarification, advice, listening, silence, follow-up |
| `implicit` | label + confidence + reasoning + alternatives (`not-fine`, `needs-empathy`, `seeking-reassurance`, `dissatisfied`, `withdrawing`, `fine`, `hidden-request`) |
| `social` | SocialSignal[] — sarcasm, irony, hesitation, withdrawal, excitement, playfulness, frustration, embarrassment, user-confidence, politeness, disengagement — each with confidence + evidence |
| `state` | opening, building, deepening, conflict, repair, reflection, topic-shift, ending |
| `shared` | openQuestion, repairPending, topicUnfinished, emotionUnresolved, branchActive + human-readable notes |
| `confidence` | value (0.35–0.95), full reasoning trace, ranked alternatives with probabilities |
| `context` | sttConfidence, wordCount, silenceMs, turnCount, memoryConflict, ambiguityTagged, engagement, vulnerability, tension, frustration |
| `raw` | original text, cleaned text, isQuestion |

Every node is `Object.freeze`d; the same object is embedded in the
`ExecutionPlan` (`plan.understanding`) so downstream telemetry and policies
share the exact interpretation the Executive used.

### Canonical ownership — the proof

```
$ rg -l isRejection|isBackchannel|isGreeting|isFarewell|isTrailingOff|isHoldTurn|isIrony|isCorrection|isRetraction src/executive/
→ src/executive/ConversationUnderstanding.ts   (only file)

$ rg -c "understand\(ctx\)" src/executive/ConversationExecutive.ts
→ 1                                            (exactly once per plan)
```

- `understand()` is invoked once per turn, at the top of
  `ConversationExecutive.plan()` (ConversationExecutive.ts:132); every
  policy below receives `u`.
- `StrategyPlanner` keeps its detector-free shape: strategy gates read
  `u.speakerGoal`/`u.state`/`u.social`/`u.literal` (e.g. Gate 6 now keys off
  `u.speakerGoal === "debate" || u.state === "conflict"` instead of raw
  behavior tags).
- The old StrategyPlanner detector names are gone; the exported helpers
  (`isBackchannel`, `isGreeting`, `isFarewell`, `cleanText`) exist only for
  single-owner reuse from ConversationUnderstanding.

### Prompt discipline

The LLM prompt receives only the **chosen strategy**. Raw understanding never
appears:

- `translatePlanToPrompt` emits strategy, confidence label, initiative,
  tone, speech, memory policy — the decision, not the reasoning.
- Fixed in this phase: `ConfidenceManager` used to inject raw CUE reasoning
  strings (`understanding: literal=statement`) into the prompt-visible
  confidence sources; it now pushes one sanitized provenance line
  (`understanding: confident reading` / `uncertain reading`). The full
  reasoning stays in the `CONVERSATION_UNDERSTANDING` telemetry trace.
- The gate suite asserts, per scenario, that none of
  `literal|speakerGoal|implicit|move=` appear in the rendered prompt.

## 3. Detection vocabulary (all inside CUE)

Pattern sets were consolidated into ConversationUnderstanding.ts — the only
interpretation primitives in the codebase: GREETINGS, FAREWELLS,
CLOSING_MARKERS, BACKCHANNELS, REJECTION_PATTERNS, HOLD_PATTERNS,
RETRACTION_PATTERNS, CORRECTION_PATTERNS, INDIRECT_QUESTION_PATTERNS,
REQUEST_PATTERNS, DISAGREEMENT_PATTERNS, CONTRADICTION_PATTERNS,
IMPLICIT_HIDDEN_REQUEST, IMPLICIT_NOT_FINE, IMPLICIT_TIRED,
IMPLICIT_REASSURANCE, IRONY_PHRASES, HEDGE_WORDS, VALIDATION_MARKERS,
POLITENESS_MARKERS, TOPIC_SHIFT_MARKERS.

Notable behavior encoded this phase:

- **Indirect questions** ("I was wondering…", "just curious") and
  **requests** ("could you please…", "kindly", "help me", bare "please X")
  resolve before generic question detection.
- **Trailing** ("…you know…") is checked before correction, and never
  shadows a real question ("So… what do you think?" stays Ask).
- **Contradiction** ("but you said the opposite") and **disagreement**
  ("I disagree", "that's debatable") feed repair/Challenge semantics.
- **Tag questions** ("…, right?", "does that make sense?") are validation
  seeking, not information seeking — checked on the cleaned text so
  apostrophe/case artifacts cannot hide them.
- **Hedging** ("I think", "maybe") is suppressed for opinion/story tags —
  "I think that movie is overrated" is a claim, not uncertainty.
- **Implicit meaning** is always derived with confidence + reasoning +
  alternatives: hidden requests ("it's really hot"), not-fine
  ("I'm fine" contradicted by vulnerability), reassurance ("I don't know
  what to do anymore"), dissatisfaction behind irony.
- `isQuestion` strips leading fillers ("Ugh, why does this…") and excludes
  exclamations ("What a surprise…") before the wh-word rule.
- **Silence** is a real move (Wait — do not fill it); **retraction**
  ("never mind") maps to the `drop-thread` goal.

## 4. Confidence — a fused number with a safety gate

`ConfidenceManager` fuses perception and understanding:

```
fused = perceptual × 0.85 + understanding.confidence × 0.15   (stt ≥ 0.6 only)
```

The fold-in is **skipped below stt 0.6**: a confident READING must never
rescue a broken HEARING (perceptual floor, ConfidenceManager.ts:53-58). The
sanitized provenance line keeps the fusion visible in the prompt; the full
reasoning + alternatives go to telemetry.

## 5. Telemetry (extension only)

`CONVERSATION_UNDERSTANDING` is pushed from useSarvam.ts:1372 after every
plan — move, literal, goal, expected, implicit label, state, confidence,
reasoning (top 4), alternatives, social signals with confidence, shared
notes, chosen strategy. The existing `ConversationTelemetryPanel` gained one
"Phase 11 — Conversation Understanding" block reading that trace (no new
panel, no new persistence).

## 6. Verification — deterministic gate suite

`scripts/test-understanding.ts` — 31 categories / 31 scenarios / **354
assertions, all passing**, covering every literal class, every move class,
goals, expected responses, implicit labels, states, shared-context flags,
memory-conflict, degraded STT behavior, confidence alternatives, and the
full execution ladder per scenario:

```
perception → understand(ctx) → StrategyPlanner.plan(ctx, u)
          → Executive.plan(ctx) → translatePlanToPrompt(plan)
```

Assertions include: the Executive's `lastUnderstanding` deep-matches
`understand()`; `plan.understanding` is the same interpretation;
`planner.primary === plan.strategy.primary` (strategy is a pure function of
understanding); prompt-leak scan; full immutability (frozen object graph);
`understand()` runs in **0.024 ms/call** (2,000-call loop) — two orders of
magnitude inside the 50 ms Executive budget.

## 7. Verification — human benchmark & Conversation Understanding Index

`scripts/test-understanding-benchmark.ts` — **154 curated real-conversation
scenarios**, each annotated with a human conversationalist's ground truth
(move, goal, expected, state, implicit, accepted strategy, social signal
presence/absence).

| Metric | Result |
|---|---|
| Move accuracy | 100% (154/154) |
| Speaker goal accuracy | 100% (154/154) |
| Expected response accuracy | 100% (114/114) |
| State accuracy | 100% (37/37) |
| Implicit meaning accuracy | 100% (152/152) |
| Strategy accuracy | 100% (15/15) |
| Social: sarcasm F1 | 100% (tp=7, fp=0, fn=0) |
| Social: hesitation F1 | 100% (tp=6, fp=0, fn=0) |
| Social: withdrawal F1 | 100% (tp=1, fp=0, fn=0) |
| Human agreement (strict, full surface) | 100% (154/154) |
| **Conversation Understanding Index** | **100 / 100** |

Confidence calibration (decision correctness vs. confidence bin):

| Bin | Accuracy |
|---|---|
| 0.40–0.55 | no samples — the evidence-weighted formula floors near 0.5 by design; CUE refuses confident-sounding guesses but its floor is honest |
| 0.55–0.70 | 100% (2/2) |
| 0.70–0.85 | 100% (31/31) |
| 0.85–1.00 | 100% (121/121) |

The empty lowest bin is a documented design property: understanding
confidence is a softmax over evidence weights, so genuinely ambiguous turns
compress into the 0.55–0.70 range rather than wandering below 0.5.

## 8. Regression

All harnesses green after the CUE construction:

- test-understanding.ts — 354/354 (new)
- test-understanding-benchmark.ts — 154/154, CUI 100/100 (new)
- test-executive-decisions.ts — GATE SUITE PASS
- test-executive.ts, test-language.ts, test-register.ts, test-perception.ts — ALL PASS
- test-memory-system.ts — 40/40
- test-psyche-routing.ts — 8/8
- test-memory-influence.ts, test-reflection.ts, test-relationship.ts — PASS

`tsc --noEmit` at the documented baseline of exactly 4 pre-existing errors
(`src/runtime/validation/*Validator.ts` → missing `IntegrationTelemetry`
module); eslint clean on all touched files.

## 9. Fixed in this phase

- Prompt leak: raw CUE reasoning strings removed from prompt-visible
  confidence sources (kept in telemetry).
- StrategyPlanner Gate 6 re-derived disagreement from behavior tags — now
  consumes `u.speakerGoal`/`u.state` (canonical ownership).
- Silence produced no move evidence (fell to "Answer") — now Wait.
- Retraction produced goal `repair` — now `drop-thread` (the union member
  was previously unreachable).
- Trailing off shadowed questions and lost to corrections — reordered +
  question-excluded.
- Validation markers ("right?", "was that the right…") never fired against
  cleaned text — now matched on clean + lowercased raw.
- "What a surprise…" counted as a question; "Ugh, why…" did not — isQuestion
  filler-strip and exclamation exclusion.
- Hidden-request coverage gaps ("I'm so hungry", "it's so dark") closed.
- Teaching asks ("teach me…") now set goal `teach` → expected `information`.
- Restored the aura-memory seed bridge functions (`auraSeedToLegacy` /
  `legacyToAuraSeed` / `createDefaultSeed`) deleted in the working tree,
  breaking `test-memory-system.ts` (40/40 restored).

## 10. What the Executive consumes (before → after)

| Policy | Before | After |
|---|---|---|
| StrategyPlanner | own detectors (isRejection, isIrony…) | `u.literal`, `u.speakerGoal`, `u.state`, `u.social`, `u.raw.isQuestion` only |
| ClarificationPolicy | own heuristics | `u.move`, `u.speakerGoal`, `u.context` flags |
| InitiativePolicy | own regexes | `u.literal` (goodbye/thinking), `u.move` |
| MemoryPolicy / InformationBudget | raw input reads | `u` context + move |
| ConfidenceManager | raw inputs | `u.context.sttConfidence`, `u.confidence.value`, `u.speakerGoal` (fused) |
| SpeechBehaviorPlanner | emotion only | `u.social` (hesitation → thinking pauses) |
| ObservableThinking | own question regex | `u.raw.isQuestion`, `u.move` |
| ReflectionEngine | own turn reading | `plan.understanding` (move + expected) |

Nothing below the Executive interprets the conversation. The LLM receives
only the chosen strategy. AURA finally knows — deterministically, measured —
what the user meant, what to do back, and how sure it is.
