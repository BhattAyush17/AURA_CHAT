# AURA Phase 12 — Social World Model (SWM)

AURA's internal, deterministic understanding of how the human world operates —
people, relationships, society, culture, work, family, friendship, identity,
failure, success, fear, hope, love, loneliness, conflict, trust,
responsibility, growth.

The SWM answers exactly ONE question:

> "What human forces are probably influencing this conversation?"

It never decides. It never generates prompts. It provides evidence — always
with confidence, reasoning, and alternative hypotheses. The Executive
consumes the evidence and decides; the LLM receives only the strategy that
results.

Method: a single immutable knowledge layer inside the existing Executive (no
new managers/planners/runtimes), deterministic gate harness, telemetry via
the plan's `socialUnderstanding`, and `tsc`/eslint/regression cleanliness.

---

## 1. Why this phase existed

Phase 11 gave AURA one canonical reading of *what the user meant*. But
meaning sits on top of context: "I don't think I deserve this promotion" is
not just an uncertain statement — it is probably imposter syndrome, fear of
expectations, and an identity transition happening at once. AURA read the
words; it did not yet read the life.

The failure mode this phase closes: an assistant that answers the literal
turn but misses the human force behind it. The constraint this phase
honors: knowledge must never cross into deciding. The risk in every world
model is that it becomes a quiet authority. This one is built as evidence
with a confidence, a reasoning trace, and alternatives — and it is verified
to be unable to override a conversational gate.

## 2. The one immutable object

`deriveSocialUnderstanding(ctx, u)` (SocialWorldModel.ts:282) is the ONLY
place social meaning is inferred. It consumes the canonical understanding
`u` (never re-detecting conversation phenomena) and deep-freezes:

| Field | What it carries |
|---|---|
| `humanNeeds` | belonging, competence, autonomy, recognition, purpose, security, connection, achievement, rest, growth, identity |
| `socialPressures` | family expectations, social comparison, career, financial, reputation, peer, marriage, cultural norms |
| `relationshipDynamics` | generational conflict, trust building/breaking, conflict escalation, reconciliation, attachment loss, boundary setting, distance, romance |
| `lifeContext` | career/education transitions, parenthood, aging, marriage, identity transition, relocation, retirement, grief |
| `communicationNorms` | indirect requests, saving face, white lies, conflict avoidance, humor-as-relief, storytelling, silence, repair rituals, greetings |
| `motivation` | procrastination, avoidance, self-defense, apology, status, sacrifice, career change, guilt |
| `constraints` | time, responsibility, health, geography, technology |
| `risks` | imposter syndrome, burnout, loneliness, identity crisis, fear of rejection, perfectionism, financial stress, relationship breakdown, lingering grief |
| `growthOpportunities` | reflection, apology openings, trust rebuilding, boundary work, courage moments, recovery |
| `confidence` | value (0.35–0.9) + reasoning trace |
| `reasoning` | flat trace of every influence with its confidence |
| `raw` | original text + cleaned text |

Every `SocialInfluence` carries `name`, `domain`, `confidence`, `reasoning`
(≥1 line), and `alternatives` (competing hypotheses within the domain).
Per-domain top-3 cap; `allInfluences(s)` flattens across domains sorted
descending.

### Sources of evidence (in priority order)

1. **Phrase detectors** — 60+ probabilistic detectors, base 0.55–0.85.
   Phrases, not rules: "i don t deserve" points at imposter syndrome; it
   does not declare it. Specificity scales with hit count.
2. **Emotion-knowledge rules** — WHY emotions appear: shame → reputation
   pressure, jealousy → social comparison, nostalgia → need for connection,
   guilt → apology motive (future-facing, unlike regret), defensiveness →
   self-defense.
3. **CUE-signal hooks** — consume the Phase 11 understanding, never
   re-detect: hidden-request → indirect-request, not-fine → white-lie,
   seek-validation → validation-seeking, sarcasm+pressure → humor-as-relief,
   greeting/story/silence/Repair → ritual reads, empathy-seeking → grief,
   early disclosure → trust-building.
4. **State inference** — reflection → identity work; empathy-seeking →
   connection need; complaints → unrecognized work; trust damage inside a
   close relationship → breakdown risk.

Confidence is modulated by hearing quality (stt < 0.6 → ×0.9), reading
confidence (uConf ≥ 0.7 → +0.05), and relationship stage
(INTIMATE/COMFORTABLE → +0.02), clamped to 0.35–0.9.

### Anti-duplication contract

Perception owns observations. ConversationUnderstanding owns conversational
interpretation. **SocialWorldModel owns social interpretation and consumes
the understanding.** Executive owns decisions. No SocialManager /
WorldManager / SocietyEngine / CultureEngine / EmotionEngine /
ReasoningEngine / PsychologyRuntime / RelationshipRuntime / BehaviorRuntime
exist. SWM is one file, one builder, one exported surface
(`deriveSocialUnderstanding`, `allInfluences`, types).

## 3. How the Executive consumes it

`ConversationExecutive.plan()` derives the social reading once per turn
(ConversationExecutive.ts:136), records the top influence in the rationale
(`social: imposter-syndrome (conf 0.81)`), embeds the frozen object in the
plan (`plan.socialUnderstanding`), and passes it to Gate 10 of the
StrategyPlanner.

**Gate 10** (StrategyPlanner.ts) maps the top-3 influences to strategy
scores through one explicit table — the Executive's judgment, not the SWM's:

- imposter-syndrome → Encourage +4 / Reflect +2 ("support before facts")
- burnout → Comfort +4 ("depleted — comfort before solutions")
- loneliness → Comfort +4 ("presence and gentle invitation")
- grief-lingering / attachment-loss → Comfort +4 ("witness before advise")
- trust-break → Reflect +3 ("do not rush repair")
- need-achievement / courage-moment → Encourage +3 ("celebrate it")
- conflict-escalation → Reflect +2 ("de-escalate with reflection")
- … 30+ mapped influences total

The SWM itself is never asked to score a strategy. It returns names; the
Executive owns the weights.

### The SWM never decides — proven two ways

1. **Early gates return first.** Repair (Gate 1.2), greeting, goodbye,
   degraded STT, thinking, retraction, correction, trailing, backchannel —
   all decide before Gate 10 exists. A repair is never re-read as fragility.
2. **The harness checks it.** For every conversational gate input
   (greeting, farewell, repair, confrontation, question, backchannel),
   `planner.plan(ctx, u)` without social evidence and
   `planner.plan(ctx, u, s)` with it must produce the same primary strategy.

## 4. Prompt discipline

The LLM prompt receives only the chosen strategy. The gate suite asserts,
per scenario, that none of `humanNeeds`, `social evidence`, `social: `,
`imposter-syndrome`, `generational-conflict`, `loneliness`, or `evidence: `
appear in the rendered prompt. The full social reasoning lives in
`plan.socialUnderstanding` (and therefore telemetry), never in the prompt.

## 5. Verification — deterministic gate suite

`scripts/test-social-world-model.ts` — 14 scenarios / **313 assertions,
all passing**, covering:

- Charter scenarios: promotion deservingness → imposter-syndrome + support
  strategy; "my parents don't understand me" → generational conflict +
  family expectations → validate-then-explore; loneliness → Comfort; grief;
  guilt/apology; achievement (need-achievement + career-transition →
  Encourage); white-lie via the not-fine CUE hook; indirect request; burnout;
  trust break; financial stress; career transition.
- **SWM never decides**: repair → Clarify even under vulnerability; debate
  → Challenge even with social evidence; gate-immune battery.
- Canonical ownership: `plan.socialUnderstanding === exec.lastSocialUnderstanding`
  (the plan embeds the exact object the Executive derived);
  `planner.plan(ctx, u, s).primary === plan.strategy.primary`.
- Prompt-leak scan; full immutability (frozen object graph).
- Structural contract: every influence has valid domain, confidence in
  [0.35, 0.9], reasoning present, alternatives array, no duplicate names,
  `allInfluences` sorted descending.
- Determinism: same input → identical serialized read, fresh objects.
- Confidence modulation: stt 0.9 → 0.60 vs stt 0.4 → 0.54 for the same text.
- Performance: `deriveSocialUnderstanding()` at **0.031 ms/call** (2,000-call
  loop) — well inside the 50 ms Executive budget.

## 6. Regression

All harnesses green after the SWM construction:

- test-social-world-model.ts — 313/313 (new)
- test-understanding.ts — 354/354
- test-understanding-benchmark.ts — 154/154, CUI 100/100
- test-executive-decisions.ts — GATE SUITE PASS (15/15)
- test-executive.ts, test-language.ts, test-register.ts, test-perception.ts — ALL PASS
- test-memory-system.ts — 40/40
- test-psyche-routing.ts — 8/8
- test-memory-influence.ts, test-reflection.ts, test-relationship.ts — PASS

`tsc --noEmit` at the documented baseline of exactly 4 pre-existing errors
(`src/runtime/validation/*Validator.ts` → missing `IntegrationTelemetry`
module); eslint clean on all touched files.

## 7. Fixed in this phase

- One gate regression: `express-uncertainty` fed `need-recognition`,
  re-reading a hedged idea ("I think maybe we should change the plan") as a
  recognition cry and flipping Clarify → Reflect. Dropped the arm — hedged
  turns are clarification moments, not social evidence.
- Dead CUE hook: a `grief-life-stage` hook referenced a non-existent
  `u.emotionSense` field and never matched. Rebuilt on
  empathy-seeking + story/statement + Comfort/Reflect.
- Detector gaps: "I feel *so* lonely", "I'm *so* exhausted",
  "I don't (think I) deserve", "I got *the* promotion" — common
  speech variants now matched.

## 8. What the Executive consumes (before → after)

| Layer | Before | After |
|---|---|---|
| StrategyPlanner | conversation gates only (Phase 11) | + Gate 10: top-3 social influences → explicit evidence weights |
| ExecutionPlan | `understanding` embedded | + `socialUnderstanding` embedded (same frozen object the Executive derived) |
| Rationale | strategy/confidence/memory/budget/initiative/speech/register | + `social: <top-influence> (conf x.xx)` |
| LLM prompt | strategy only | still strategy only — SWM never leaks |
| Telemetry | CONVERSATION_UNDERSTANDING trace | plan carries the social read |

The SWM never decides. It explains. The Executive decides. The LLM
expresses. The user experiences AURA as understanding people — not just
words.
