# AURA Phase 9.1 — Executive Decision Audit

Question asked: not *"is the Executive running?"* but *"is the Executive making the correct
decisions — every turn?"*

Method: 20 curated turns driven through the real `ConversationExecutive.plan()` chain
(StrategyPlanner → ClarificationPolicy → ConfidenceManager → InitiativePolicy → plan).
Two measurement classes: **gate correctness** (does the Executive behave per its own
deterministic spec) and **human benchmark** (does it match what a human conversationalist
would decide). Harness: `scripts/test-executive-decisions.ts`.

---

## 1. Scorecard

| Measure | Result |
|---|---|
| **Decision Accuracy** | Gate correctness **11/15 (73%)** · Human comparison **1/5 (20%)** |
| **Decision Confidence** | Confidence is well-calibrated on gates (High only on strong STT/behavior; Medium in gray zone; Low on degraded STT) — but a repair/rejection turn is rated **High(0.90)** while the decision is wrong. Confidence measures hearing, not understanding. |
| **Reasoning** | Every decision carries a rationale (e.g. `strategy: Clarify | STT confidence 0.40 < 0.45`). Reasoning is transparent — and reveals *wrong* premises (e.g. `moderate vulnerability` on a rejection turn). |
| **Alternative Decisions** | The full ranked strategy ladder is visible per turn (e.g. `Clarify(10) Answer(0) Ask(0)`). When a turn scores zero everywhere, the planner falls to the `Observe` hard floor — alternatives exist but are not reasoned about (no "closest plausible" path). |
| **Human Comparison** | 4 of 5 benchmark turns are decided differently from a human. Details below. |

## 2. What the Executive gets right (gates pass)

Direct question → Answer; Hinglish question → Answer; degraded STT → Clarify (never guess);
frustration + command → Answer fast; frustration + weak input → Clarify gently; sharing →
Reflect; disagreement → Challenge; emotional peak → Encourage; long thread → Summarize;
long silence → Ask; gray-zone STT → Answer→Clarify with Medium confidence. The deterministic
machinery is real and behaves as designed.

## 3. Findings — deterministic bugs (gate failures)

1. **Punctuation breaks social detectors** — `isGreeting("Hello!")` is false (the `!` is in
   the word), `isFarewell("Bye, …")` false (the comma). Result: "Hello!" → **Clarify**,
   "Bye, talk to you later" → **Observe**. `StrategyPlanner.ts:109-119` normalizes neither
   word boundaries nor punctuation.
2. **Clarification fires on backchannels** — "Yeah yeah" is correctly read as Observe by the
   StrategyPlanner (Gate 1.5) but `ClarificationPolicy.ts:41` independently declares
   *"input is too short to disambiguate"* → clarify=true. The plan says both "no push" and
   "clarify first" in the same turn. The two policies are not ordered or reconciled.
3. **`clarification.required` never reaches the InitiativePolicy** — on hedged input and
   gray-zone STT the plan requires clarification yet initiative stays Continue/Observe.
   `InitiativePolicy.decide(ctx, strategy)` has no clarification input
   (`InitiativePolicy.ts:18`), so "clarify first" and "hold the thread" coexist.

## 4. Findings — human-benchmark failures (conversational cognition gaps)

| Turn | Human decides | Executive decides | Gap |
|---|---|---|---|
| "Actually... wait... let me explain." | Wait — yield the floor; the user is self-correcting | Observe (passes only because Observe≈no-push; not because "wait" is understood) | No HOLD detection |
| "No... that's not what I meant." | Repair — acknowledge misalignment, ask one question | **Comfort** (vulnerability 0.45 > 0.35) with **High** confidence, no clarification | No REJECTION/REPAIR detection; vulnerability heuristic misfires |
| "Hmm?" | Clarify/Ask — prompt for more, not a request | **Answer** (question-mark overrides ambiguity) | isQuestion treats any `?` as a question; ambiguity not considered |
| "Well... actually I meant the other one" | Follow the re-anchor (Reflect/Listen) | Observe | No self-repair detection |
| "And then I thought... you know..." | Wait or soft nudge | **Comfort** (vulnerability 0.4), no wait | Trailing-off not modeled; vulnerability heuristic misfires |

The user's two example turns are the two worst cases:

- **"Actually... wait... let me explain."** — the Executive has no mechanism that honors the
  word "wait" or mid-turn self-repair. It does not answer and does not clarify (good), but
  only by the `Observe` fallback, not by understanding the turn.
- **"No... that's not what I meant."** — the Executive answers this with Comfort. The user
  is correcting AURA's understanding and AURA's own executive responds as if the user is
  emotionally fragile. No component detects rejection or misalignment repair.

## 5. Root causes

- The Executive models **per-turn surface signals** (STT, emotion, behavior tags, length,
  question marks) but has **no conversational-state model**: no repair state, no
  rejection/acceptance of the *previous* turn, no hold/turn-taking signals, no awareness
  that this utterance responds to AURA's own last utterance.
- `isQuestion` is a pure syntax test; "Hmm?" has the same shape as "Where?".
- Emotion defaults leak: any vulnerability > 0.35 contributes Comfort even when the text is
  a rejection or a trailing thought.

## 6. Recommended fixes (Phase 10 candidates, deterministic — same pattern as RegisterState)

1. Normalize punctuation before social-detector matching (greeting/farewell/backchannel).
2. Add a deterministic **HOLD gate**: markers `wait`, `hold on`, `one sec`, `let me
   explain`, `let me think` → strategy Listen + initiative Wait, no clarification.
3. Add a deterministic **REJECTION/REPAIR gate**: markers `that's not what i meant`,
   `that's wrong`, `you misunderstood`, `no, i`, `i didn't say` → strategy Reflect/Clarify,
   initiative Ask, clarification required (the user's "Repair → Clarify → Restart" ladder).
4. Order the policies: StrategyPlanner decides first; ClarificationPolicy must not fire on
   turns the StrategyPlanner already classified as backchannel/continuation.
5. Pass `clarification.required` into InitiativePolicy so "clarify first" forces initiative
   Ask.
6. Gate the Comfort contribution on *why* vulnerability fired (behavior tags), so a
   rejection turn cannot read as fragility.

## 7. Verdict

The Executive is deterministic, explainable, and correct on standard turns — and
**structurally blind to turn-taking**: it cannot hold, cannot detect repair, cannot read a
rejection, and cannot distinguish "Hmm?" from a real question. Decision Accuracy against a
human baseline: **20%** on the cognition-sensitive turns, **73%** on standard gates.
The fix is small and fully deterministic (Section 6) — the same architectural pattern
already proven in Phases 8/8.1. Until then, the Executive decides *something* every turn,
but on conversational repair it decides the wrong thing confidently.
