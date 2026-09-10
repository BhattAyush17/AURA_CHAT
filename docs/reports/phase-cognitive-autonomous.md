# AURA — PHASE 2: GLOBAL AUTONOMOUS CONVERSATION (Initiative / When-to-Speak)

**Date:** 2026-08-31
**Predecessor:** `backend/core/intelligence/action_schema.py` Phase 1 (cognitive fast-path integrity)
**Scope:** Provider-independent, global `AutonomousConversation` module that decides **whether / when / how**
AURA continues conversation — answer, continue, ask, reflect, proactively return, or stay silent — driven by the
complete conversational situation, not a forced "keep talking" rule. One decision consumed by OpenRouter, Sarvam
and Gemini.
**Protected (untouched):** Music single-authority, Atmosphere, Memory architecture, Social Cognition, Telemetry,
Adaptive Attention, OpenRouter/Sarvam/Gemini provider _contracts_, YouTube/yt-dlp, playback state, identity model.
**Git policy:** no `add`/`commit`/`reset`/`push`. Pre-existing dirty tree = **220 modified tracked files**; stays
exactly **220** (verified). Only new _untracked_ source added.

---

## 1. Executive verdict

**The decision to speak (or stay silent) is now computed once, globally, from the turn's real signals, and reaches
every provider through the single shared cognitive block — with silence as a first-class decision.**

| Requirement                                                   | Verdict                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| One global module, no provider-local copies                   | 🟢 `src/runtime/autonomousConversation/` — single engine                                                     |
| Consumes existing cognitive signals (no re-implementation)    | 🟢 engine reads `plan`, `understanding`, `emotion`, `memory`, `timing`, `socialDecision`, initiative metrics |
| Silence (WAIT) is a valid decision                            | 🟢 `WAIT` drives `shouldSpeak=false`; tested reachable                                                       |
| Curiosity separated from forced questioning                   | 🟢 `EXPLORE`/`FOLLOW_UP` (curiosity) ≠ `ASK` (justified, low-fatigue)                                        |
| Closure respected                                             | 🟢 goodbye/close → graceful `WAIT`, no restart                                                               |
| Timing is a signal, never a fixed "speak after X sec" trigger | 🟢 engine returns `silence_value`; no fixed-timer speak                                                      |
| Relevant memory ≠ interesting memory                          | 🟢 `memory_opportunity` gated by `memory_interesting_only`; interesting-only is never surfaced               |
| Explicit anti-leak contract                                   | 🟢 prompt block rewords to "never refer to how you reached a decision"; no scores/policy/flag words          |
| Feedback loop (post-response)                                 | 🟢 `recordOutcome()`; bounded store (cap 24)                                                                 |
| All 18 deterministic scenarios                                | 🟢 18/18 spec + 12 A–L + 3 extended = **33 passed**                                                          |
| All 14 documented actions reachable                           | 🟢 dead-branch audit: 14/14 reachable                                                                        |
| Latency budget                                                | 🟢 `~0.0006 ms/eval` (200k evals in ~125ms)                                                                  |

---

## 2. Files changed

**New (untracked) source — `src/runtime/autonomousConversation/`:**

- `types.ts` — `AutonomousAction` (14 values incl. `PROACTIVELY_ENGAGE`, `PROACTIVELY_RETURN`, `REFLECT`,
  `WAIT`); `AutonomousOpportunity` (incl. `memory_interesting_only`, `interruption_cost`, `urgency`);
  `AutonomousConversationDecision` (incl. `permission: allowed|discouraged|prohibited`, `utteranceCategory`,
  `urgency`, `interruptionCost`, `reason`); `AutonomousInput` (incl. `userInterrupted`, `auraJustSpoke`,
  `lastUserGaveShortAnswer`, `memoryInterestingButNotRelevant`, `frustration`); `AutonomousOutcome` (feedback).
- `AutonomousConversationEngine.ts` — pure `evaluateAutonomous()` + singleton `getAutonomousConversationEngine()`.
  Step-ordered decision: interruption-suppress → just-spoke guard → closure → repair→`CLARIFY` →
  frustration→`REFLECT`/`ACKNOWLEDGE` → vulnerability→`ACKNOWLEDGE` → repeated-short-answer→low-key →
  answer→`FOLLOW_UP` (justified) → relevant-memory→`RECALL`/`PROACTIVELY_RETURN` (gated interesting-only) →
  continuity→`CONTINUE` → proactive (strong+confident) → curiosity/`EXPLORE`/`FOLLOW_UP` → justified `ASK` →
  `OFFER` → low-confidence→`WAIT` → fallback `RESPOND_ONLY`. `permission`, `categoryFor`, `prospectiveConfidence`
  helpers; `recordOutcome()` feedback store (off pure path, cap 24).
- `formatAutonomousBlock.ts` — `[AUTONOMOUS CONVERSATION]` block with anti-leak line.
- `index.ts` — public exports (`evaluateAutonomous`, `getAutonomousConversationEngine`, `formatAutonomousBlock`,
  types).

**Tracked edits (all within pre-existing 220 modified baseline):**

- `src/runtime/RuntimeManager.ts` — builds `AutonomousInput` from existing signals (`ctx.emotion`,
  `ctx.memory`, `ctx.timing`, `socialDecision`, `plan`, initiative metrics, and new derivations: `frustration`,
  `userInterrupted` from `ctx.input.wasInterruption`, `auraJustSpoke=false` (no signal in this runtime path),
  `lastUserGaveShortAnswer` from last user turn ≤2 words, `memoryInterestingButNotRelevant` from relevance
  maxima <0.55 & no personal history). Stores `lastAutonomousDecision`, appends `formatAutonomousBlock(...)` to
  the same cognitive string every provider sends, appends to `buildInitialCognitiveSnapshot` when a live decision
  exists, exposes `getLastAutonomousDecision()`.

---

## 3. Architecture: before → after

**Before:** proactive/initiative handling was ad-hoc per provider (Gemini discarded `processCognitiveTurn`'s return;
OpenRouter/Sarvam had no unified when-to-speak branch beyond a presumed "keep talking" heuristic). No global,
signal-driven, silence-tolerant decision.

**After:**

```
ctx (emotion/memory/timing) ─┐
plan (initiative/strategy)  ─┤
understanding (literal/move/ ├─▶ evaluateAutonomous(input) ──▶ AutonomousConversationDecision
  speakerGoal/expected/shared)│   (14-action vocab, permission, urgency,
socialDecision              ─┤    interruptionCost, utteranceCategory)
initiative metrics          ─┘        │
                                      ▼
                     formatAutonomousBlock(decision) ──▶ appended to SAME cognitive string
                                      ▼
              OpenRouter  ·  Sarvam  ·  Gemini(buildInitialCognitiveSnapshot)
              → identical, provider-independent autonomous direction
```

One decision, one prompt block, three consumers. Providers never re-derive initiative.

---

## 4. The 18 scenario coverage (deterministic, `scripts/test-autonomous.ts`)

| #   | Required scenario                              | Action asserted                                           | PASS |
| --- | ---------------------------------------------- | --------------------------------------------------------- | ---- |
| 1   | Factual answer → no forced question            | `RESPOND_ONLY`, no `FOLLOW_UP`                            | ✅   |
| 2   | Emotional disclosure → empathetic              | `ACKNOWLEDGE`                                             | ✅   |
| 3   | Frustrated user → no dismissive response       | `REFLECT`/`ACKNOWLEDGE`, not `ASK`/`RESPOND_ONLY`, speaks | ✅   |
| 4   | Detailed engaged user → continuation           | `CONTINUE`/`PROACTIVELY_ENGAGE`, initiative>0.3           | ✅   |
| 5   | Short "yeah" → no forced question              | not `ASK`/`PROACTIVELY_ENGAGE`                            | ✅   |
| 6   | Repeated short answers → decreasing initiative | `OBSERVE`/`ACKNOWLEDGE`; initiative < engaged case        | ✅   |
| 7   | User asks AURA → direct answer                 | `RESPOND_ONLY`                                            | ✅   |
| 8   | Missing info genuinely required → ask/clarify  | `CLARIFY`                                                 | ✅   |
| 9   | Conversation closure → graceful stop           | `WAIT`, category `WAIT`                                   | ✅   |
| 10  | Strong topic continuity → natural continuation | `CONTINUE`                                                | ✅   |
| 11  | Relevant memory → contextual use               | `RECALL`/`PROACTIVELY_RETURN`, `memoryOpportunity=true`   | ✅   |
| 12  | Merely-interesting memory → no injection       | `memoryOpportunity=false`, no RECALL/PROACTIVELY_RETURN   | ✅   |
| 13  | Music context → incorporates state, agnostic   | decision unchanged by music flag alone, deterministic     | ✅   |
| 14  | User interruption → initiative suppressed      | `WAIT`, shouldSpeak=false                                 | ✅   |
| 15  | AURA just spoke → no immediate re-initiation   | `WAIT`, shouldSpeak=false                                 | ✅   |
| 16  | Opportunity + low confidence → wait            | `WAIT`, shouldSpeak=false                                 | ✅   |
| 17  | All three providers receive identical state    | deep-equal decision, no `provider` input consumed         | ✅   |
| 18  | No internal metadata leaks                     | block lacks any score/flag/policy/`initiative=` token     | ✅   |

Plus extended checks: WAIT is first-class and drives `shouldSpeak=false`; decision carries
permission/urgency/interruptionCost/utteranceCategory; feedback loop records+clears outcomes.

**A–L regression scenarios (retained, `scripts/test-autonomous.ts`):**

| Label | Behavior asserted                                                 | PASS |
| ----- | ----------------------------------------------------------------- | ---- |
| A     | Factual answer → direct, no forced question                       | ✅   |
| B     | Basic continuation keeps participation, not silence               | ✅   |
| C     | Engagement + relevance → proactive, not passive                   | ✅   |
| D     | Curiosity ≠ forced questioning (high fatigue → no ASK/FOLLOW_UP)  | ✅   |
| E     | Closure (goodbye) → WAIT, no restart                              | ✅   |
| F     | Ambiguous continuation → no forced question                       | ✅   |
| G     | Curiosity without a social opening → no forced question           | ✅   |
| H     | Relevant memory + curiosity → RECALL (low fatigue, no continuity) | ✅   |
| I     | Music context → relevance-only, no forced initiative              | ✅   |
| J     | Determinism → identical input, identical decision                 | ✅   |
| K     | Long pause with space sought → WAIT, no auto-speak after timer    | ✅   |
| L     | Provider parity → one engine, no provider input consumed          | ✅   |

**Result: 33 passed, 0 failed** (18 spec scenarios + 12 A–L + 3 extended).

---

## 5. Dead-branch audit + latency (`scripts/audit-autonomous-reach.ts`)

50k random-input stress probe + targeted scenario probes over the full input space:

- All **14** documented actions reached ✓ (no dead branch).
- No undocumented/placeholder action emitted.
- **Latency: `0.0006 ms/eval`** (200,000 evals ≈ 125ms) — far below per-turn budget; negligible TTFB impact.

---

## 6. Provider parity

OpenRouter (`useProvider.ts:1060`) and Sarvam (`useSarvam.ts:1164`) already call `processCognitiveTurn(...)`;
Gemini (`useLiveNext.ts:139`) calls it and, per Live's one-shot-session design, receives the autonomous direction
via `buildInitialCognitiveSnapshot`'s appended block when a live decision exists. The decision itself is computed
once in `RuntimeManager` — no provider owns or re-derives it. Parity is structural, not duplicated logic.

---

## 7. Verification suite

| Command                                     | Result                                      |
| ------------------------------------------- | ------------------------------------------- |
| `npx tsc --noEmit`                          | ✅ 15 pre-existing / **0 new**              |
| `npx eslint` (module + RuntimeManager)      | ✅ clean                                    |
| `npx tsx scripts/test-autonomous.ts`        | ✅ 33/33 (18 spec + 12 A–L + 3 extended)    |
| `npx tsx scripts/audit-autonomous-reach.ts` | ✅ 14/14 reachable, 0.0006ms/eval           |
| `npm run build`                             | ✅ ~11.3s (chunk-size warning pre-existing) |
| `[AUTONOMOUS CONVERSATION]` in bundle       | ✅ present                                  |
| `git diff --check`                          | ✅ clean                                    |
| `git status` modified tracked count         | ✅ 220 (unchanged)                          |

---

## 8. Known limitations / left open

- **Gemini Live** inherently can't fold a _per-turn_ decision into a one-shot session instruction; it receives the
  block only via the initial snapshot when a live decision exists. Documented, provider-neutral limitation.
- **`auraJustSpoke`** is passed as `false` — the runtime's `processCognitiveTurn` path has no live "did AURA just
  speak" signal. The engine still guards re-initiation via internal just-spoke logic and silence thresholds; a
  future caller can supply the true flag.
- **`lastUserGaveShortAnswer` / `memoryInterestingButNotRelevant`** are derived heuristically (last user turn ≤2
  words; relevance max <0.55 without personal history). Thresholds are conservative and deterministic.
- Full frontend STT/TTS and real audio still require live devices (per `README.md` "Known Limitations"); autonomy
  verification is via the pure-engine deterministic suite.

---

## 9. Protected-areas & git-safety verification

- Music single-authority layout, Atmosphere (`AtmosphereContext.js` tracked file untouched; only imported as a
  type), Memory architecture, Social Cognition, Telemetry, Adaptive Attention, and provider contracts were **not**
  modified by this task.
- No provider-local autonomous copies were added; all three consume the one global decision.
- Modified tracked count remained **220** (0 added); new untracked files are only the Phase-2 module
  (`src/runtime/autonomousConversation/`), the two local test/audit scripts, and this report.
- No commits, no staging, no pushes.
