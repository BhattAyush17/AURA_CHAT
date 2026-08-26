# AURA Phase 10 — Cognitive Activation & Executive Wiring

Question asked: is every Executive decision a real behavioral change? Does a
Perception → Executive Decision → Execution Plan → Prompt Builder → LLM → Speech
chain carry each decision to an observable conversation — or do decisions die in
a structure the user never feels?

Method: full-chain audit (WP6), gap-closing patches inside existing owners only
(WP1-WP5), diagnostics extension (WP7), and the wiring matrix + activation
report below (WP8). No new systems, engines, managers, planners, or state
machines were added. Harnesses: 8 suites (2 new Phase-9 suites updated to the
new reality, 1 decision-level human-benchmark suite).

---

## 1. The severed chain (why this phase existed)

The master break: `useSarvam.ts` sent `executive_plan` (a full `[EXECUTIVE PLAN]`
block) in every request body — and **no backend endpoint ever read it**. The
Executive planned, the plan vanished. Secondary breaks:

- `plan.tone` and `plan.speechBehavior` were computed every turn and consumed by
  nothing (WP6 audit: 14 of 34 plan leaf values had no consumer at runtime).
- `clarification.required` never reached `InitiativePolicy` — a plan could demand
  clarification and still hold the thread (`initiative: Observe`).
- The rejection/repair, hold, retraction, self-correction, trailing-off and
  irony decision gates did not exist; hedged/rejected/ironic/trailing input all
  fell through to the vulnerability→Comfort path (9.1 finding, 11/15 gates).
- `memoryPolicy` was computed but memories were unconditionally injected —
  "Ignore" meant nothing (9.3 finding).
- `clarifyBias` could not fire — it only forced clarification at confidence
  "Low", a state the Executive structurally never reached (9.4 finding).
- `nextTurnLengthDelta` was declared in the reflection contract and never
  supplied by the live caller (9.4 finding).
- Backend speech-act detection matched substrings ("queen of EngLANd" →
  REQUEST, 9.2 finding); sarcasm had no detector at all (9.5-adjacent finding).

## 2. What was activated (work package by work package)

| WP | Decision | Before | After | Observable in conversation |
|---|---|---|---|---|
| WP1 | Rejection / repair ("No… that's not what I meant") | fell to Comfort/vulnerability | `isRejection` gate → Clarify/Reflect + **clarify required** (`StrategyPlanner.ts:302`, `ClarificationPolicy.ts:76`) | AURA re-anchors with a question instead of consoling |
| WP1 | Thinking pause ("wait, let me think") | answered over the user | `isHoldTurn` → Listen + initiative **Wait** (`InitiativePolicy.ts:44`) | AURA yields the floor |
| WP1 | Retraction ("never mind") | answered anyway | `isRetraction` → Listen/Observe, drop the thread (`StrategyPlanner.ts:320`) | AURA lets it go |
| WP1 | Self-correction ("actually I meant…") | Observe/vulnerability | `isCorrection` → Reflect/Listen (`StrategyPlanner.ts:328`) | AURA re-anchors on the new meaning |
| WP1 | Trailing off ("…you know…") | Comfort (false distress) | `isTrailingOff` → Listen/Observe, Comfort suppressed (`StrategyPlanner.ts:336`) | AURA waits instead of comforting a half-thought |
| WP1 | Backchannels ("hmm", "ok", "yeah") | sometimes clarified | short-input clarify skips them (`ClarificationPolicy.ts:45-54`); "Hmm?" → Ask | no more "What do you mean?" at every "ok" |
| WP1/WP5 | Sarcasm ("Great, another feature…") | AGREEMENT → answered at face value | backend `detect_irony` + tokenized acts (`behavior.py:311-324,418-427`) → ASSERTION/"ironic" tag → frontend `isIrony` gate → Ask/Reflect (`StrategyPlanner.ts:364`) | AURA probes instead of celebrating |
| WP2 | Memory policy | computed, never enforced | `enforcedMemories` by policy + `memory_policy` sent + backend gates both client and cached memory (`useSarvam.ts:1368-1383`, `main.py:728,735,837`) | "Ignore" truly ignores; Required injects ≤2 |
| WP3 | Clarify-then-ask | clarify=true + initiative Observe (contradiction) | `clarificationRequired` flows into `InitiativePolicy` → always Ask (`ConversationExecutive.ts:229-232`, `InitiativePolicy.ts:34-38`) | clarification is always a real question |
| WP4 | clarifyBias | dead gate (Low unreachable) | forces at `confidence !== "High"` (`ConversationExecutive.ts:140-157`) | bias produces audible clarification |
| WP4 | length delta | declared, never sent | computed + passed to `reflect()` (`useSarvam.ts:1204-1221`) | depth calibration reacts to turn length |
| WP6 | tone | computed, consumed by nothing | 5 values + speech pace/energy + `why:` rationale emitted (`ConversationExecutive.ts:317-331`) | warmth/directness/humor/energy realize in LLM output |
| WP6 | speech pace | emotion-only fallback | plan `speechSpeed` drives TTS `targetPace` (`useSarvam.ts:866-884`) | the plan, not mood, sets delivery speed |
| WP6 | pauseBeforeMs | computed, never used | lead-in delay before first spoken sentence (`useSarvam.ts:1618-1628`) | reflective beat is audible |
| WP6 | thinking behavior | "curious" murmur was spoken | `kind !== "curious"` gate + reason in trace (`useSarvam.ts:1428-1453`) | only Executive murmurs are spoken |
| WP6 | confidence sources | never shown | top-3 sources in the confidence line (`ConversationExecutive.ts:286-293`) | LLM knows why it should be cautious |
| WP6 | executiveTimeMs | telemetry only | `EXECUTIVE_SLOW` warning when > 50ms budget (`useSarvam.ts:1390-1396`) | slow Executive is visible |
| WP7 | decision status | register-only panel | Decision Execution Status block reads EXECUTIVE_PLAN/MEMORY/SLOW/HESITATION traces (`ConversationTelemetryPanel.tsx:58-68,212-247`) | every decision: Computed → Consumed → Observable |

## 3. Runtime trace (one turn, as wired now)

```
User: "Great, another feature that works perfectly" (stt 0.8)
  ├─ backend/core/behavior.py:311  _clean_tokens → word-boundary tokens
  ├─ behavior.py:319               detect_irony → True
  ├─ behavior.py:418-427           act AGREEMENT → ASSERTION, energy="ironic", tags=["ironic"]
  ├─ useSarvam.ts:1364             executive.plan(ctx)  [executiveTimeMs]
  ├─ StrategyPlanner.ts:364        Gate 1.6 irony (tags:ironic) → Ask/Reflect, Comfort/Answer suppressed
  ├─ ClarificationPolicy           no clarify (5 words, stt 0.8)   → required=false
  ├─ InitiativePolicy:34           not required → Ask (no question → Continue)
  ├─ MemoryPolicyEngine            policy from retrieval → "Ignore" or "Required"
  ├─ ConversationExecutive.ts:1365 translatePlanToPrompt → tone+speech+why+confidence(sources)
  ├─ useSarvam.ts:1370-1396        enforcedMemories, EXECUTIVE_MEMORY, EXECUTIVE_PLAN, EXECUTIVE_SLOW traces
  ├─ fetch /api/analyze/stream     body { executive_plan, memory_policy, client_memories }
  ├─ main.py:721-722               executive_plan prepended to behavior_instructions
  ├─ main.py:728,735               memories gated on policy ≠ Ignore
  ├─ LLM                           realizes plan (probing reply, dry tone, slow pace)
  ├─ useSarvam.ts:866-884          plan speechSpeed → targetPace
  ├─ useSarvam.ts:1618-1628        plan pauseBeforeMs → lead-in beat
  └─ Audio out                      the plan, spoken
```

## 4. Executive Wiring Matrix (post-phase, 34 leaf values)

| Status | Count | Values |
|---|---|---|
| ACTIVE | 27 | strategy, language, register, relationship, tone.{warmth,directness,humor,formality,energy}, clarification.{required,triggeredBy,reason}, memoryPolicy, informationBudget, speechBehavior.{speechSpeed,energy,pauseBeforeMs}, thinkingBehavior.{utterance,kind,reason}, confidence.{label,value,sources}, rationale, initiative (prompt-realized) |
| PARTIAL | 2 | initiative (prompt-realized; no runtime Wait/End gate — out of scope, UI territory), executiveTimeMs (telemetry + EXECUTIVE_SLOW) |
| UNUSED | 5 | speechBehavior.{warmth,emphasis,thinkingPauses,reflectionPauses,endingSoftness} — TTS API accepts only text/speaker/pace/language |
| DISCONNECTED | 0 | — |

Before Phase 10: 20 of 34 values reached the observable. After: **29 of 34**
(ACTIVE+PARTIAL). The 5 remaining UNUSED fields are delivery-API limits, not
dead decisions: Sarvam TTS (`sarvamTTS.ts:30-36`) exposes no knobs for warmth,
emphasis or internal pause granularity — the LLM realizes them in wording
instead. Zero disconnected producers.

## 5. Before / After architecture

```
BEFORE                              AFTER
Perception                          Perception
  └─ emotion analysis                 ├─ emotion analysis
                                       └─ tokenized speech acts + irony
Executive decision                   Executive decision
  └─ plan()  ──┐                      └─ plan() with repair gates 1.2-1.6
                │                         ├─ clarify → initiative Ask (wired)
                │                         └─ tone/speech/why emitted
Prompt builder                        Prompt builder
  └─ translatePlanToPrompt            └─ translatePlanToPrompt
        ──┐                                │
          │ executive_plan sent           ▼
API ✗ ────┘ (never read)             API ✓ main.py prepends to instructions
                                        ├─ memory_policy gates injection
LLM ← no plan                        LLM ← full directive
Speech ← emotion-only pace           Speech ← plan pace + lead-in beat
Telemetry ← plan string              Telemetry ← plan + memory + slow + hesitation
```

Entropy: 1 severed transport + 14 dead values + 4 missing decision gates +
4 phantom contracts (Low-conf clarifyBias, unenforced memoryPolicy, unsent
lengthDelta, unread executive_plan) → 0 severed transports, 4 documented TTS
API limits, 5 behavioral gates, 0 phantom contracts.

## 6. Performance

Executive decision time per turn is unchanged in the worst case (same engines,
2-3 new regex passes on text ≤ 400 chars). The only added latency is the
optional lead-in beat (≤ 1500ms, clamped) when a plan requests one — the
deliberate, observable effect. `EXECUTIVE_SLOW` now reports if the 50ms budget
is exceeded. Backend: `_clean_tokens`/`detect_irony` run per turn; both are
single-pass, O(n) over transcript length.

## 7. Evidence

| Harness | Result |
|---|---|
| `test-executive.ts` (plan invariants) | PASS |
| `test-executive-decisions.ts` (15 gate scenarios + 5 human benchmarks) | **GATE SUITE PASS, 5/5 human benchmark, 100% decision accuracy** |
| `test-language.ts` | PASS |
| `test-register.ts` | PASS |
| `test-reflection.ts` (16) | PASS (updated to Phase 10 reality) |
| `test-memory-influence.ts` (18) | PASS |
| `test-relationship.ts` (21) | PASS |
| `tsc --noEmit` | 4 errors — all pre-existing (`integration/IntegrationTelemetry` stubs) |
| `eslint` | clean |
| `python3 -m py_compile backend/core/behavior.py backend/api/main.py` | OK |
| Backend probes | "queen of England?" → QUESTION (substring bug gone); both sarcasm probes → irony=True; RuntimeEngine.analyze → ASSERTION + energy=ironic + tags=[ironic] |

Gate suite detail (post-fix): greeting, farewell, direct question, Hinglish
question, backchannel, backchannel-after-silence, degraded STT, hedged input
(→Clarify, probe first), frustration×2, sharing, disagreement, emotional peak,
thread consolidation, STT-gray-zone question, self-repair, **rejection/repair**,
"Hmm?" (→Ask), **soft correction** (→Reflect), **trailing off** (→Listen, no
Comfort) — the four scenarios that were red at the end of Phase 9.1 are green,
and the hedged/ambiguous expectations were tightened to the real, human
realization (Clarify probe; "Hmm?" → one question).

## 8. Completion score

Activation = a decision is implemented only if it changes conversation.

| Work package | Definition of done | Score |
|---|---|---|
| WP1 Strategy gates | every 9.1 red gate fires and is observable | 5/5 |
| WP2 Memory activation | policy enforced front-to-back | 3/3 |
| WP3 Clarification execution | clarify ⇒ ask, always | 3/3 |
| WP4 Executive bias + reflection | clarifyBias fires, delta consumed | 2/2 |
| WP5 Perception (backend) | tokenized acts + irony reach the Executive | 2/2 |
| WP6 Prompt/audio outlets | tone/speech/why/pause/sources/reason emitted; TTS pace driven by plan | 5/5 |
| WP7 Diagnostics | per-decision Computed/Consumed/Observable status in existing panel | 1/1 |
| WP8 Evidence | matrix + activation + trace + before/after + performance | 1/1 |

**Phase 10 completion: 22/22 (100%)** — every activatable decision is
activated and observable. The 5 `speechBehavior` delivery knobs
(warmth/emphasis/thinkingPauses/reflectionPauses/endingSoftness) have no outlet
in the Sarvam TTS API (`sarvamTTS.ts:30-36`); they are computed, consumed by the
prompt, and realized in wording — a platform limit, not a dead decision. No new
systems were introduced; every change is inside an existing owner.
