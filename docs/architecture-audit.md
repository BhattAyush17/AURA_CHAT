# AURA — Principal Engineer Design Review & Architecture Audit

Audit method: evidence-only. Every claim below was verified by reading the actual runtime consumer path (import → call site → data flow), not by trusting module names or READMEs. Harness evidence: `scripts/test-executive.ts` (8/8 pass), `scripts/test-perception.ts` (65 pass), `scripts/test-language.ts` (61/61 pass), `tsc --noEmit` clean except 4 pre-existing errors, `eslint` clean.

Confidence: **~55%** (high for the critical-path findings below; medium for sections marked PENDING, which depend on human-run device verification or truncated evidence).

---

## 1. Executive Summary

AURA is two apps fused by a single UI:

1. **The real app** — a lean, working voice assistant: browser mic → Sarvam STT → behavior-client emotion analysis → OpenRouter stream → Sarvam TTS with backchannel/hesitation/emotion-paced delivery, all orchestrated by a genuinely executed `RuntimeManager` + `AdaptiveExecutionEngine`.
2. **The paper app** — an L1–L5 cognitive pipeline (`backend/core/pipeline.py` + the entire `backend/core/thought_field/` tree) that **cannot be imported** (`backend/core/thought_field/__init__.py:1` → `from .Ecology import Ecology` → `ModuleNotFoundError`; there is an `ecology/` directory but no `Ecology.py` module). No route, scheduler, or background task can reach it. It is not "incomplete" — it is structurally dead, and nothing at runtime depends on it, so the app runs fine without it.

The Executive exists only in the Sarvam provider. Two shadow voice pipelines (OpenRouter via `useProvider.ts`, Gemini via `useLive.ts`) run the same UI with **no Executive at all**.

Three critical-path defects were verified by direct execution/reading:

| # | Defect | Verified evidence |
|---|--------|-------------------|
| 1 | `executive_plan` is **silently dropped** | `ChatRequest` (backend/api/main.py:675-682) has no such field; FastAPI discards unknown fields. Client sends it (src/providers/sarvam/useSarvam.ts:1384) into the void. |
| 2 | The real LLM prompt is **just** `behavior_instructions + "Respond in 1-3 sentences. Speak naturally, not formally."` (main.py:717) | No emotional state, no seed, no memory, no plan. `seed` is fetched (main.py:699) and never used. The L1–L5 "architecture" is not in the request path. |
| 3 | `/chat` is broken; stream path raises at request time when QStash is unset | `/chat` imports `run_turn_pipeline` → ImportError → 500. Stream: `from backend.core.pipeline import run_turn_pipeline` sits *inside* the SSE generator's else-branch (main.py:756); with no `QSTASH_TOKEN` the ImportError fires after tokens stream, truncating SSE (no `done` event). With QStash set, it publishes to a registered-but-orphaned webhook. |

Net: the product feels polished because the behaviors that *are* wired (emotion → pace/backchannel/hesitation, executive language control, runtime policy) are genuinely alive. The cognitive depth is aspirational scaffolding.

---

## 2. Verified Runtime Stack (what actually runs)

```
Mic
 ├─ Sarvam STT  (useSarvam.ts) ─────────────────────┐
 ├─ analyser/barge-in (RuntimeManager.evaluateDecision) ┐
 └─ SpeechRecognition (useProvider fallback)           │
        │ text                                         │
        ▼                                              │
   /api/analyze/stream (backend/api/main.py:684)       │
        ├─ engine.analyze()        → emotional_state, sensing_state, all_scores
        ├─ engine.build_instructions() → behavior_instructions
        ├─ retrieve_prefetched_memory() → appended as string  (main.py:713-715)
        ├─ system_prompt = behavior + "1-3 sentences..."      (main.py:717)
        └─ stream_openrouter_response(history, system_prompt) (main.py:731)
        └─ [QStash?] publish → webhook  |  [else] ImportError (main.py:756)
        ▼ text
   Executive (Sarvam ONLY):
        ├─ executive.reflect(prevPlan)  (useSarvam.ts:1183) — every turn
        ├─ plan stashed → prevPlanRef    (useSarvam.ts:1311)
        ├─ plan.language → directive + TTS language           (LIVE)
        ├─ plan.thinkingBehavior → spoken hesitation           (LIVE)
        ├─ plan.informationBudget → fallback-path token cap    (LIVE)
        ├─ weights → clarifyBias/brevityBias/warmthBias        (partial)
        ├─ plan.speechBehavior / memoryPolicy / initiative / tone / clarification → inert
        ▼
   TTS: emotion → targetPace (joy 1.1 / sad 0.95 / frust 1.05), backchannels, sheen
   Output: voice + RuntimeDiagnosticsDrawer
```

Provider matrix (all three mount simultaneously via `useVoiceOrchestrator.ts:172`, user picks one):

| Capability | Sarvam | OpenRouter | Gemini |
|---|---|---|---|
| Executive (reflect/plan) | YES | NO | NO |
| Language engine (LanguageState) | YES | NO | NO |
| Emotion → targetPace TTS | YES | ~ | NO |
| Barge-in | YES (analyser) | analyser thresholds | — |
| /api/analyze/stream | :1363 | :913 | :816 (proactive) |

---

## 3. Dead Architecture Inventory

Verified unreachable or break-at-call-time:

1. `backend/core/thought_field/` — whole tree (ATF, metacognition, social, predictive, habits, goals, self_model, environment, ecology, relationships, reconsolidation, persistence, telemetry) — **unimportable** (`__init__.py:1`). Note: `ecology/` (directory) exists but the code imports `Ecology` (module) — trivial fix, deeper question is whether to bother.
2. `backend/core/pipeline.py` — `run_turn_pipeline` importable only as a runtime failure (see #3 table); nothing succeeds in calling it.
3. `backend/core/refactor_atf.py` — untracked generation script, not imported.
4. `/api/analyze` (non-stream) and `/chat` — call `run_turn_pipeline` at request time → 500.
5. `src/runtime/validation/{Execution,Latency,Performance,Prediction}Validator.ts` — import missing `../integration/IntegrationTelemetry`; 4 pre-existing tsc errors; unreachable.
6. Stream-path dead variables: `seed` fetched (main.py:699) never used in prompt; `executive_plan` dropped at boundary.
7. `client_memories`/`memory_mode` — honored only in `/chat` (main.py:813-819), which is broken. The stream path ignores them entirely (only server prefetch is used).
8. Legacy-L2 storage (`store_and_backup_memory`, Supabase/Chroma, degradation circuit) — only reachable from `/chat` → dead in runtime.
9. QStash publish (main.py:740-754, 570-573) — targets `/api/webhooks/process_memory`, which **is** registered (backend/api/webhooks.py:6), but the webhook handler itself depends on `run_turn_pipeline` internals to be meaningful; with no QStash token the local path 500s the SSE stream.

---

## 4. Per-Subsystem Scores

Scale 0–10, eight dimensions per subsystem.

### 4.1 Conversational Executive

- **Purpose:** Own strategy, depth, clarification, initiative, memory policy, language, recovery, budget, speech, conversation planning.
- **Owner:** `src/executive/` — `ConversationExecutive.ts` (plan/reflect), `ConversationContext.ts`, `ExecutionPlan.ts`, `LanguageState.ts` (Phase 8 momentum engine).
- **Inputs:** conversation context (language stats, emotion, history, last analysis), session state; `executive.reflect(prevPlan, …)` each turn (useSarvam.ts:1183).
- **Outputs:** ExecutionPlan (language, thinkingBehavior, informationBudget, initiative, tone, clarification, speechBehavior, memoryPolicy, nextTurnLengthDelta).
- **Consumers:** useSarvam.ts (plan stashed :1311; language applied to prompt + TTS code; hesitation spoken; budget caps fallback path; bias weights read back at ConversationExecutive.ts:114-125/136-153/170).
- **Runtime trace:** live — every Sarvam turn. But **Sarvam only**.
- **Verdicts:**
  - Implementation **8** — the module is coherent and test-covered.
  - Runtime Integration **5** — one of three providers; per-turn reflect + plan, but plan is not sent anywhere (dropped at backend).
  - Behavioral Influence **4** — language + hesitation + budget real; speechBehavior/memoryPolicy/initiative/tone/clarification inert.
  - Architectural Quality **7** — clean separation, context assembly, momentum engine; but plan→backend channel is a dead wire.
  - Stability **6** — module-scoped singleton, no persistence, no race guard across turns; language state localized per Phase 8.
  - Executive Integration **10** — it *is* the executive (this is the flagship subsystem).
  - Human Impact **3** — users only experience language/hesitation/budget effects; the rest is invisible.
  - ROI **5** — high value but 40% of output surface is dead; cheap to fix or cut.

### 4.2 Memory

- **Purpose:** retrieve + inject memories that change conversation/planning/tone, not just prompt growth.
- **Owner:** `MemoryProvider` (src/__root.tsx:37) → `memoryGateway` → localStorage + supabase; backend prefetch (`retrieve_prefetched_memory`).
- **Runtime trace:** server prefetch path works (main.py:713-715 → behavior_instructions append). Client path sends `client_memories` + `hasPersonalHistory` (useSarvam.ts:1287-1289, 1382) → **dropped** (no field in `ChatRequest`). `relevanceScores: []` hardcoded (stub). `memoryPolicy` computed by Executive, ignored by consumers.
- **Verdicts:** Implementation **6** (gateway + storage + relevance scaffolding), Runtime **4** (prefetch only), Behavioral **2** (raw string appended, no planning influence), Architecture **6**, Stability **6**, Executive Integration **3** (policy ignored), Human Impact **3** (traces may reach LLM but unproven), ROI **4**.

### 4.3 Emotion

- **Purpose:** detect emotional state per turn; influence tone, pacing, recovery.
- **Runtime trace:** live — `engine.analyze` on every stream request (main.py:706-710); results consumed by Sarvam (`lastAnalysis` → context slice + TTS targetPace; playfulness/joy→1.1, vulnerability/sadness→0.95, frustration→1.05).
- **Verdicts:** Implementation **8**, Runtime **9** (every turn, every provider), Behavioral **7** (pace + context + L2 presence), Architecture **7**, Stability **8**, Executive Integration **6** (feeds context the Executive reads), Human Impact **6** (subtle pacing is real but quiet), ROI **8**.

### 4.4 Behavior-Client

- **Purpose:** LLM-based behavior analysis → behavior_instructions.
- **Runtime trace:** live — `engine.analyze` + `build_instructions` inline in stream path (main.py:706-711), returns `behavior_instructions` to the client as metadata event (main.py:721-726).
- **Verdicts:** Implementation **7**, Runtime **9**, Behavioral **7** (instructions form the actual system prompt), Architecture **6**, Stability **7**, Executive Integration **5** (separate from Executive; fusion is missing), Human Impact **5**, ROI **7**.

### 4.5 Mindset

- **Purpose:** persistent persona/seed shaping.
- **Runtime trace:** seed is loaded (main.py:699) and **never placed in the stream prompt**; `/api/session/start` stores it; PersonalitySelector changes it. Mindset has no behavioral effect on the actual LLM call.
- **Verdicts:** Implementation **5**, Runtime **2**, Behavioral **1**, Architecture **4**, Stability **5**, Executive Integration **2**, Human Impact **2** (selector is cosmetic today), ROI **2** — either wire seed into prompt or cut the UI.

### 4.6 Reflection

- **Purpose:** end-of-session self-assessment that changes future plans.
- **Runtime trace:** `executive.reflect(prevPlan, …)` every turn (useSarvam.ts:1183); weights read back next turn (clarifyBias, brevityBias, warmthBias — ConversationExecutive.ts:114-125/136-153/170). `nextTurnLengthDelta` computed but **never passed** (2 of 3 signals). Single module-scoped instance; no persistence.
- **Verdicts:** Implementation **7**, Runtime **7** (Sarvam only), Behavioral **4** (three biases only; no plan mutation of language/stability), Architecture **7**, Stability **5**, Executive Integration **9**, Human Impact **2**, ROI **5**.

### 4.7 Clarification

- **Purpose:** decide when to clarify; follow through.
- **Runtime trace:** only increments a `clarifies` counter. No user-facing follow-up question ever generated from it.
- **Verdicts:** Implementation **3**, Runtime **1**, Behavioral **0**, Architecture **3**, Stability **4**, Executive Integration **5** (weights read), Human Impact **0**, ROI **1**.

### 4.8 Thought-Field / ATF (incl. habits, goals, self_model, predictive, social, metacognition)

- **Purpose:** the L1–L5 cognitive core.
- **Runtime trace:** none. Unimportable (`ModuleNotFoundError` on `from .Ecology import Ecology`). `pipeline.py:40` import fails; ATF instantiation (pipeline.py:220), `atf.tick` (:227), self_model prompt injection (:231-232), sensing_injection→behavior_instructions (:294-296) unreachable.
- **Verdicts:** Implementation **4** (lots of code, no entry point), Runtime **0**, Behavioral **0**, Architecture **2** (module naming mismatch `ecology/` vs `Ecology` is the visible tip), Stability **0**, Executive Integration **0**, Human Impact **0**, ROI **1** — delete or rescue deliberately; nothing depends on it.

### 4.9 Prediction

- **Purpose:** predict next actions/turns.
- **Runtime trace:** none — `predictive/` submodule only inside unimportable tree; frontend PredictionValidator broken (missing IntegrationTelemetry).
- **Verdicts:** Implementation **2**, Runtime **0**, Behavioral **0**, Architecture **2**, Stability **0**, Executive Integration **0**, Human Impact **0**, ROI **0**.

### 4.10 Social Intelligence

- **Purpose:** long-term relationship modeling.
- **Runtime trace:** backend `social/` + `relationships/` unimportable. Frontend has no social layer; only prompt-level "warmth" biases from Reflection.
- **Verdicts:** Implementation **2**, Runtime **0**, Behavioral **1**, Architecture **2**, Stability **0**, Executive Integration **0**, Human Impact **0**, ROI **0**.

### 4.11 Language

- **Purpose:** language detection, register, momentum, and TTS alignment.
- **Runtime trace:** live in Sarvam — `LanguageState.ts` momentum engine; executive `language` directive applied to prompt; TTS follows executive register (`ttsLanguageCode` → `generateSpeech conversationLangCode`); Romanized-Hinglish gap fixed via shared lexicon in `LanguageDistributionAnalyzer`. Verified by harness: 61/61. **Not present** in OpenRouter/Gemini pipelines (no language engine at all). PENDING: live-device matrix verification (human + mic).
- **Verdicts:** Implementation **9**, Runtime **5** (one provider), Behavioral **7**, Architecture **8**, Stability **8**, Executive Integration **9**, Human Impact **6** (register correctness is audible), ROI **7**.

### 4.12 Personality

- **Purpose:** stable persona + user-switchable.
- **Runtime trace:** `PersonalitySelector` mounted (index.tsx); seed → stored; L2 layers exist; but seed never reaches stream prompt (see 4.5). Prompt-level persona via `getSystemPromptForPersonality` (in context slice) partially alive.
- **Verdicts:** Implementation **6**, Runtime **3**, Behavioral **3**, Architecture **5**, Stability **5**, Executive Integration **2**, Human Impact **3**, ROI **3**.

### 4.13 Speech

- **Purpose:** spoken expression — pacing, backchannel, hesitation, emotion pacing.
- **Runtime trace:** live (Sarvam): backchannels, spoken hesitation via `speakAmbient` (plan.thinkingBehavior), emotion→targetPace, sheen.
- **Verdicts:** Implementation **7**, Runtime **7** (Sarvam; OpenRouter TTS unverified), Behavioral **8**, Architecture **6**, Stability **7**, Executive Integration **7** (thinkingBehavior wired; speechBehavior dead), Human Impact **7** (audible), ROI **7**.

### 4.14 Listening

- **Purpose:** real-time input sensing + barge-in.
- **Runtime trace:** live — Sarvam STT; barge-in via RuntimeManager.evaluateDecision + analyser (useSarvam, useProvider); SpeechRecognition fallback in useProvider.
- **Verdicts:** Implementation **7**, Runtime **8**, Behavioral **7**, Architecture **6**, Stability **6** (two competing STT paths), Executive Integration **5** (evaluateDecision invoked but not plan-aware), Human Impact **7**, ROI **7**.

### 4.15 Voice (TTS delivery)

- **Purpose:** final vocal output.
- **Runtime trace:** live — generateSpeech with conversationLangCode; emotion-paced.
- **Verdicts:** Implementation **8**, Runtime **8**, Behavioral **8**, Architecture **7**, Stability **7**, Executive Integration **7**, Human Impact **8**, ROI **8**.

### 4.16 Vision

- **Purpose:** camera/image awareness.
- **Runtime trace:** none found — no `getUserMedia`-with-video, `ImageCapture`, or image ingestion in the app. Not implemented.
- **Verdicts:** Implementation **0**, Runtime **0**, Behavioral **0**, Architecture **0**, Stability **0**, Executive Integration **0**, Human Impact **0**, ROI **0** — explicitly out of scope; state it.

### 4.17 Runtime / Orchestration

- **Purpose:** session lifecycle, policy engine, health/energy scoring.
- **Runtime trace:** live — `RuntimeManager` bootstrapped via dynamic import (useVoiceOrchestrator.ts:35/124/138), `initialize()` on mount, `processCognitiveTurn` (useLive.ts:388), `evaluateDecision` (useProvider.ts:1010/1383, useLive.ts:583); `AdaptiveExecutionEngine.determinePolicy` (RuntimeManager.ts:42) scoring ExperienceHealthEngine + deviance signals. Health poll 2s via SenseManager (index.tsx:114-118).
- **Verdicts:** Implementation **8**, Runtime **8**, Behavioral **6** (policy does gate things, but many decisions are cosmetic), Architecture **7**, Stability **7**, Executive Integration **6**, Human Impact **5**, ROI **7**.

### 4.18 Diagnostics / Observability

- **Purpose:** runtime telemetry + friction reporting.
- **Runtime trace:** live — RuntimeDiagnosticsDrawer (index.tsx:376), RuntimeDiagnosticsPage, LatencyMeter, Waveform. Friction report: live session line uses an inline formula (useSarvam.ts:2665-2676); `computeFrictionReport` (ConversationFrictionReport.ts) consumed only by harness `scripts/test-perception`.
- **Verdicts:** Implementation **7**, Runtime **8**, Behavioral **2** (observes, doesn't act), Architecture **6**, Stability **7**, Executive Integration **3**, Human Impact **3** (dev-facing), ROI **6**.

### 4.19 Proactivity

- **Purpose:** agent-initiated engagement.
- **Runtime trace:** partial — `GET /api/proactive/{session_id}` exists; poller (PROACTIVE_INTERVAL_MS 15000) in Gemini pipeline (useLive.ts:816). Behavior unknown on Sarvam path.
- **Verdicts:** Implementation **5**, Runtime **3**, Behavioral **3**, Architecture **5**, Stability **5**, Executive Integration **2**, Human Impact **3**, ROI **4**.

---

## 5. Cognitive Activation Index

Gate-passing count (Implemented + Connected + Executed + Observable + Behavior-changing), verified:

| Subsystem | Gates passed |
|---|---|
| Emotion | 5/5 ✅ |
| Behavior-Client | 5/5 ✅ |
| Language (Sarvam) | 5/5 ✅ |
| Speech/Voice | 5/5 ✅ |
| Listening | 5/5 ✅ |
| Runtime/Orchestration | 5/5 ✅ |
| Diagnostics | 5/5 ✅ |
| Executive | 3/5 ⚠️ |
| Reflection | 3/5 ⚠️ |
| Memory | 2/5 ❌ |
| Proactivity | 2/5 ❌ |
| Mindset | 1/5 ❌ |
| Personality | 2/5 ❌ |
| Clarification | 1/5 ❌ |
| Thought-Field/ATF | 0/5 ❌ |
| Prediction | 0/5 ❌ |
| Social | 0/5 ❌ |
| Vision | 0/5 ❌ (unimplemented) |
| Legacy-L2 storage | 0/5 ❌ |

**Cognitive Activation Index ≈ 7 fully-activated of 19 = 37%.** If we count partial activation (≥3 gates): 9/19 = 47%. The product's *felt* quality tracks the ~37%: everything the user hears works; everything that would make AURA feel like an entity (memory, initiative, prediction, social, self-model) is dormant.

---

## 6. Principal Engineer Answers

**What to delete (or quarantine):**
- The entire unimportable backend cognitive tree is the biggest single decision. Recommended: `git rm -r backend/core/thought_field/` OR a 30-minute repair (`mv ecology Ecology` + fix imports) *only if* you have a concrete integration plan within 2 weeks. Do not leave it in limbo — it is costing you a false sense of architecture.
- `backend/core/refactor_atf.py` (untracked), the four broken Validators, the `/chat` + `/api/analyze` duplicates.

**What to merge / unify:**
- One LLM path, one executive: pick a single provider backend. Today 3 providers = 3 shadow pipelines, only one with Executive + Language. Either implement the Executive in the other two or retire them from the active UI.
- Fold emotion + behavior client + seed into the actual stream prompt. The pieces exist; the prompt (main.py:717) is a stub.

**What to rewire (cheapest wins, highest activation-per-hour):**
1. `ChatRequest`: add `executive_plan: Optional[str]` + `seed: Optional[str]`; inject both into the stream system_prompt (main.py:717). **10 minutes** — flips Executive and Mindset from inert to live.
2. Honor `client_memories` in the stream path exactly like `/chat` does (main.py:813-819) — reuse that block. **10 minutes** — flips Memory.
3. Fix `nextTurnLengthDelta` passing (compute → `executive.reflect(prevPlan, …, nextTurnLengthDelta)`).
4. Decouple the stream generator from the broken pipeline import: wrap the else-branch in try/except or gate on feature flag (local dev should not 500 SSE).

**What NOT to build next:**
- Vision, social modeling, prediction — zero activation potential under the current architecture; every hour there is better spent on the rewires above.

**The honest architecture answer:** AURA today is a *behavioral voice app with an executive overlay*. Its differentiation (language momentum, emotion-paced speech, hesitation/backchannel, runtime policy) is real and working. Its ambition (cognitive pipeline, memory-driven relationship, self-model) is scaffolded but structurally disconnected — one missing field and one broken import are the entire distance between the two.

---

## 7. Final Verdict

| System | Overall |
|---|---|
| Conversational Executive | 7.2 / 10 |
| Memory | 4.4 |
| Emotion | 7.4 |
| Behavior-Client | 7.0 |
| Mindset | 2.8 |
| Reflection | 6.1 |
| Clarification | 1.5 |
| Thought-Field/ATF | 0.9 |
| Prediction | 0.5 |
| Social | 0.6 |
| Language | 7.4 |
| Personality | 3.4 |
| Speech | 6.9 |
| Listening | 6.6 |
| Voice | 7.6 |
| Vision | 0 |
| Runtime/Orchestration | 6.8 |
| Diagnostics | 5.2 |
| Proactivity | 3.8 |

Overall architecture coherence: **55–60%** — a genuinely alive behavioral core with a disconnected cognitive shell. The delta to "working entity" is small and precisely known (Section 6.3). Confidence: high on every critical-path finding (all verified by direct execution); PENDING on: live-device language matrix verification, Sarvam vs OpenRouter TTS parity, proactivity behavior on the Sarvam path, and the runtime behavior of the two shadow pipelines under real load.
