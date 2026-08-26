# AURA Phase 9.2 — Conversation Cognition Audit

Question asked: **does AURA understand conversation, or does she simply respond?** Can she
read the room — ownership, topics, implicit questions, subtext, humor, irony, sarcasm,
agreement, disagreement, challenge, silence, awkwardness, repair, goals, social intentions,
hidden meaning?

Method: code audit of every deterministic conversation-cognition mechanism (frontend
executive layer + backend perception layer) plus empirical probes run through the real
perception functions (`detect_speech_act`, `detect_energy`, `SensingEngineL1`). Harness
evidence from Phase 9.1 (`scripts/test-executive-decisions.ts`) is reused for repair,
rejection, and ambiguity.

---

## 1. The Cognition Matrix

| # | Dimension | Verdict | Evidence |
|---|---|---|---|
| 1 | **Conversation ownership** | ❌ ABSENT | No model of who drives; initiative is per-turn, never accumulated across turns |
| 2 | **Topic maintenance** | ❌ ABSENT | No topic object anywhere; word-overlap over last 3 turns is used *only to score engagement* (`backend/core/emotion.py:135-142`) |
| 3 | **Thread switching** | ⚠️ AD HOC | "Redirection warranted" fires only on raw turn count (`src/executive/InitiativePolicy.ts:52`; `StrategyPlanner.ts:256`) — no topic signal |
| 4 | **Implicit questions** | ❌ ABSENT | `isQuestion` is syntax-only (9.1: "Hmm?" → Answer). Probe: "I am tired of waiting for this" → act **ASSERTION**, no request, no frustration detected |
| 5 | **Emotional subtext** | ⚠️ PARTIAL | `EmotionalStateRouter` (engagement/vulnerability/playfulness scorers, `emotion.py:114-198`) + `SensingEngine` (arc, warmth, tension, trust, temporal decay, `sensing.py:126-295`) + priority routing (`emotion.py:101`). Only conversation-aware layer. But keyword-pattern based → misfires (9.1: "No... that's not what I meant." → Comfort) |
| 6 | **Humor** | ⚠️ PARTIAL | JOKE act (`behavior.py:291`), playfulness scorer (`emotion.py:171`) — detects humor *markers*, comprehends nothing |
| 7 | **Irony** | ❌ ABSENT | No mechanism |
| 8 | **Sarcasm** | ❌ ABSENT — **reads as the opposite** | Probes below: sarcasm scores as AGREEMENT + trust |
| 9 | **Agreement** | ⚠️ PARTIAL | AGREEMENT act (`behavior.py:292`); probe shows sarcasm falsely lands here |
| 10 | **Disagreement** | ⚠️ PARTIAL | Challenge strategy exists (`StrategyPlanner`), gated on behavior tag whose supply is keyword-data-dependent; "no" doubles as a frustration keyword (`sensing_engine.py:7`) |
| 11 | **Challenge** | ⚠️ PARTIAL | Challenge strategy exists but is tag-gated, not reasoned |
| 12 | **Silence** | ✅ IMPLEMENTED | `SilenceStateMachine` (`behavior.py:370`) + frontend timing snapshot + InitiativePolicy silence → Ask (9.1 gate: long silence → Ask passes) |
| 13 | **Awkwardness** | ❌ ABSENT | No mechanism |
| 14 | **Repair** | ❌ ABSENT | 9.1 harness: "Actually... wait... let me explain." → Observe (by fallback, not understanding); "No... that's not what I meant." → **Comfort** |
| 15 | **Conversation goals** | ❌ ABSENT | No session goal/agenda; `ConversationContext.intent` is per-turn |
| 16 | **Social intentions** | ⚠️ PARTIAL | 5 coarse keyword acts — REQUEST/QUESTION/JOKE/AGREEMENT/ASSERTION (`behavior.py:288-294`) + content tags |
| 17 | **Hidden meaning** | ❌ ABSENT | No mechanism |

**Conversation Cognition Index: 25%** (4.25/17 — silence 1.0 + six partials × 0.5 + thread-switch 0.25). Only 1 of 17 dimensions has a real, dedicated mechanism.

## 2. Empirical probes — the sarcasm and implication blindness

| Utterance (real meaning) | Act | Energy | L1 emotion |
|---|---|---|---|
| "great, another feature that works perfectly" (sarcastic complaint) | **AGREEMENT** | neutral | frustration 0.25 |
| "oh sure, because THAT always goes well" (sarcasm) | **AGREEMENT** | neutral | **trust 0.25** |
| "wow, what a surprise. amazing." (sarcasm) | **QUESTION** | high | engagement 0.5 |
| "I am sooo excited to restart this app again" (frustrated resignation) | ASSERTION | neutral | *nothing* |
| "Yeah right, and Im the queen of England" (sarcasm) | **REQUEST** | neutral | *nothing* |
| "I am tired of waiting for this" (implicit complaint/ask) | ASSERTION | low | *nothing* |
| "you know what, never mind" (retraction) | **QUESTION** | neutral | frustration 0.25 |

Three failure modes visible:

1. **Sarcasm flips to the opposite reading** — "works perfectly" + "great" → AGREEMENT + trust.
   AURA would agree warmly with the insult.
2. **Substring false positives** — "queen of **EngLANd**" → REQUEST (marker `la`); "you know
   **what**" → QUESTION. The keyword matcher is a bare substring test (`behavior.py:296-299`).
3. **Implication blindness** — "tired of waiting" carries a complaint and a request; the
   perception layer returns nothing, the Executive reads ASSERTION/neutral, and the
   StrategyPlanner decides Observe — exactly what Phase 9.1 found for ambiguous turns.

## 3. Findings

1. **Cognition is delegated, not implemented.** The only thing that can actually understand
   a conversation is the LLM, via `conversation_history` in the prompt. The deterministic
   layer perceives per-turn features (emotion, length, punctuation, markers) and decides
   with them — but *never consults the model for its decisions* (Phase 9.1: plan() runs
   before any LLM reply). Result: the layer that decides has no conversation understanding;
   the layer that understands has no say.
2. **The only session-level state is emotional.** `EmotionalStateRouter.active_state`
   (frustration/withdrawal priority, `emotion.py:101`) and `SensingEngine` temporal decay
   are the sole cross-turn cognition. There is no session memory of topic, goal, agreement
   history, or turn ownership — despite ReflectionEngine claiming "thread continued
   naturally" (`ReflectionEngine.ts:96`), "thread" is just turn-count.
3. **Repair and rejection are invisible** (Phase 9.1 evidence): the two turns the user
   flagged as most important produce the two worst decisions (Comfort on rejection,
   Observe-by-accident on self-repair).
4. **Silence is the one implemented, working dimension** — an end-to-end chain
   (silence machine → timing snapshot → initiative gate) that Phase 9.1 confirmed passes.

## 4. Root cause

The perception → decision pipeline models **how the user says something** (speed, length,
punctuation, emotion) but not **what the conversation is doing** (topic, goal, repair,
agreement arc, who holds the floor). The 17 cognition dimensions collapse into 5 keyword
acts and 1 stateful emotion router — everything else is assumed to be handled by the LLM,
which is never asked.

## 5. Recommended fix (Phase 10 candidate — same deterministic pattern as RegisterState)

Build a `ConversationState` layer owned by the Executive, fed by the existing perceptions,
that adds the missing dimensions as deterministic state:

- **Topic stack** (push/pop on content shifts via keyword-vector overlap) → powers
  topic-maintenance and thread-switch decisions.
- **Goal agenda** (session-level intent accumulation: what is the user trying to do?) →
  powers implicit-question detection ("tired of waiting" while a task is pending → Clarify).
- **Repair state** (rejection/self-repair markers → HOLD/REPAIR gates, per 9.1 §6).
- **Ownership counter** (who held the floor for the last N turns → initiative asymmetry).
- **Sarcasm/irony guard** (contradiction between positive markers and frustration/negative
  context → flip reading, never AGREEMENT/trust) and **word-boundary fixes** for the
  substring false positives (`behavior.py:296-299`).

## 6. Verdict

AURA responds; she does not yet read the room. She has one implemented cognition
dimension (silence) out of seventeen, and the three most valuable ones — repair, implicit
meaning, sarcasm — are not just absent but **inverted**: sarcasm reads as trust, rejection
reads as fragility. The deterministic machinery that works (silence chain, register,
emotional routing) proves the pattern; the missing 16 dimensions are the same pattern,
unbuilt.
