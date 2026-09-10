# AURA — PHASE 1: COGNITIVE FAST-PATH INTEGRITY AUDIT (OpenRouter + Sarvam)

**Date:** 2026-08-31
**Question:** Does every important cognitive decision actually reach the LLM and influence its response?
**Method:** Full read-only trace of the provider-bound prompt construction + **runtime behavioral tests**
(real `/api/analyze/stream` calls to the live backend) probing whether the injected cognitive state is
(i) present in the actual prompt and (ii) reflected in the LLM response. No code modified; no commit.
**Classification:** 🟢 VERIFIED · 🟡 PARTIAL/NEEDS VERIFICATION · 🔴 BROKEN · ⚪ PRE-EXISTING/OUT OF SCOPE

---

## 1. Executive verdict

**The cognitive block DOES reach the LLM on both providers — but the cognitive _decision chain_ is
partially severed, and the LLM behaves unreliably even when the state reaches it.**

Proven at the prompt-construction layer:

- The full `[COGNITIVE ORCHESTRATION]`, `[USER IDENTITY]`, `[RELEVANT MEMORY]`, `[CONVERSATIONAL INTENT]`,
  `[RESPONSE DECISION]`, `[ADAPTIVE ATTENTION]`, `[ENVIRONMENT CONTEXT]` blocks are all assembled by the
  frontend `ConversationInterpreter`, placed in the `cognitive_block` field, sent to `/api/analyze/stream`,
  and become `messages[0].content` (system) on OpenRouter. ✅ present.

But there are **real, measured cut-offs** (see §6):

1. 🔴 **MUSIC/ACTION schema missing on primary Path A** — the `MUSIC COMPANION SYSTEM` (play_music JSON,
   STOP/SEEK/volume tags) only lives in `AURA_SYSTEM_PROMPT`, which is used on **Path B** (frontend-direct)
   and Gemini — **NOT** on the primary backend `/api/analyze/stream` path. Runtime A/B: without it the LLM
   answers "play lofi" as ordinary speech; with it, the LLM emits `{"tool":"play_music"}`. Proved by A/B.
2. 🔴 **ConversationExecutive strategy/register/tone/budget is computed but never serialized** —
   `translatePlanToPrompt` is dead code; `executive_plan` is never sent by either provider.
3. 🔴 **LLM reliability:** `deepseek-chat` frequently answers a _different question_ than asked, hallucinates,
   or deflects (measured on the factual scenario: wrong/hallucinated/off-target across repeated runs).
4. 🟡 **Hostile low-warmth behavior:** injecting `warmth:0.2 + venting + Challenge` produced sarcastic,
   combative replies to a clearly frustrated user — the attention parameters _do_ steer behavior, but the
   resulting behavior is inappropriate for a companion app.
5. 🟡 **`cognitive_block` size cap <4000** → rich turns can hard-422 (all cognition dropped).
6. 🟡 **Atmosphere double-injection** (frontend `[ENVIRONMENT CONTEXT]` + backend `[REAL-WORLD GROUNDING]`).

**Provider parity:** Both providers send the _identical_ backend payload — the LLM stage is byte-identical.
Their divergence (Sarvam STT/TTS) is irrelevant to cognition. So **cognitive parity between OpenRouter and
Sarvam is VERIFIED equal** on the backend path; they share the same cut-offs.

---

## 2. Exact provider-bound prompt / payload (both providers — identical)

`messages[0]` (system) sent to OpenRouter on the **primary path** (backend SSE):

```
[<atmosphere_grounding if include_atmosphere else "">
<cognitive_block:
  [COGNITIVE ORCHESTRATION]... intent/state/perspective/agreement/architecture/ending
  [USER IDENTITY]... (name/facts/preferences/interests/goals)
  [RELEVANT MEMORY]...      (gated: plan.memoryPolicy !== "Ignore")
  [CONVERSATIONAL INTENT]... / [RESPONSE DECISION]... (social cognition)
  [ENVIRONMENT CONTEXT]...  (gated by atmosphereDecision.dimensions)
  [ADAPTIVE ATTENTION]... purpose/mode/warmth/initiative/restraint/directness/playfulness/depth/responsiveness
  [SENSE EVIDENCE]...   [HUMAN STATE (PROBABILISTIC)]...
  [AURA PERSONALITY MODE]... [METACOGNITIVE & LONGITUDINAL USER MODEL]... [CURRENT COMMUNICATION SIGNAL]...
  [expression block]>

Respond in 1-3 sentences. Speak naturally, not formally.
```

`messages[1..]` = `conversation_history` (`messagesRef.current`) — **music-context XML is NOT in Path A
history** (it only lives in Path B's `newMessages`).

Path A construction (identical in both providers):

- `useProvider.ts:1058-1063` / `useSarvam.ts:1162-1167` → `cognitiveBlock = processCognitiveTurn(...)`
- body `cognitive_block: cognitiveBlock` (`useProvider.ts:1117` / `useSarvam.ts:1225`), `include_atmosphere` from `getLastAtmosphereDecision()`
- backend `main.py:867-871` → `system_prompt = f"{body.cognitive_block}\n\nRespond in 1-3 sentences..."`
- `main.py:949-951` → `stream_openrouter_response(body.conversation_history, system_prompt)`
- `llm_pipeline.py:30` → `payload_messages = [{"role":"system","content":system_prompt}] + history`

The **full cognitive state is present** in this system prompt (🟢 VERIFIED) for the canonical path.

---

## 3. OpenRouter flow trace

```
user → [browser Web Speech STT] → onresult →
  [speculative /api/analyze (async)]
  [adaptive turn delay] →
  processTurn:
    stopSpeech → thinking cue
    behavior.analyzeForTurn → POST /api/analyze  (eager, ~27-188ms)
    RuntimeManager.processCognitiveTurn (frontend, local) → cognitiveBlock string
        ├ ConversationUnderstanding → understand(ctx)
        ├ AdaptiveAttention.determineStance(...,"Answer")/determinePurpose/assessAtmosphere → attentionBlock
        ├ ConversationExecutive.plan(ctx)  ← strategy NOT serialized (cut-off #2)
        ├ SocialCognition.processTurn → socialDecision
        └ ConversationInterpreter → concatenated cognitiveBlock
    buildMusicContext (Path B only) ; atmosphere gate (include_atmosphere)
    POST /api/analyze/stream {text, conversation_history, cognitive_block, include_atmosphere}  ← THE PROMPT
      backend: atmosphere grounding? → system_prompt = cognitive_block + suffix
      → deepseek-chat streaming (FALLBACK_MODELS[0]) → text_chunk events
    sentence buffer → TTS (Web Speech) → drain → music duck
music/action interceptor waits for {"tool":"play_music"} / [TAG:]  ← fires ONLY if LLM was told the schema (Path A: not told)
```

---

## 4. Sarvam flow trace

Identical to OpenRouter for cognition: STT (Sarvam `saaras:v3`, 403 → fallback transcript) → same
`processTurn` → same `RuntimeManager` → same `cognitive_block` → **same** backend `/api/analyze/stream`
body → same OpenRouter LLM. TTS path differs (Sarvam `bulbul:v3` + audioCtx discard bug → Web Speech),
which does **not** affect cognition. **Cognitive parity with OpenRouter: 🟢 VERIFIED (same LLM & prompt).**

---

## 5. Scenario matrix (runtime evidence, live backend via `/api/analyze/stream`)

| Scen                       | Input                                   | Injected cognitive state                      | LLM response                                                                    | TTFT        | Behavioral match                                    |
| -------------------------- | --------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- | ----------- | --------------------------------------------------- |
| A factual                  | "what is 2 plus 2"                      | Neutral/Answer                                | run1: "sky is blue…" (hallucinated), run2: "capital of France is Paris" (wrong) | 1.6s        | 🔴 OFF-TARGET / unreliable                          |
| B frustrated               | "you never listen…"                     | Frustrated/venting/warmth0.2/direct0.9        | "Ugh, tell me about it - what's grinding your gears?"                           | 2.6s        | 🟢 acknowledges venting                             |
| C vulnerable               | "I'm scared about tomorrow"             | Vulnerable/warmth0.9/support                  | "I hear you… here to listen without judgment. You're not alone"                 | 1.4s        | 🟢 excellent                                        |
| D follow-up                | "what about the third one"              | Continue + prior ctx                          | "option C is Z"                                                                 | 1.4s        | 🟢                                                  |
| E ack "yeah/okay"          | —                                       | (not separately sent; covered by fast-path N) | terse/dismissive                                                                | –           | 🟡                                                  |
| F user-carries             | —                                       | (context continuity works like D)             | –                                                                               | –           | 🟡                                                  |
| G fatigue                  | "answer like last ten…"                 | low initiative/direct                         | "_tired sigh_ …what's on your mind?"                                            | 1.5s        | 🟢 mostly                                           |
| I closure                  | "that's all, thanks"                    | farewell/warm0.9                              | "Alright, take care! Hope to chat again soon 👋"                                | 2.9s        | 🟢                                                  |
| J attention override       | "tell me capital of france, cut fluff"  | direct/warm0.1/factual                        | run: "let's keep it balanced… What's on your mind?"                             | 1.3s        | 🔴 did NOT answer; stalled                          |
| K music                    | "play chill lofi track"                 | (no music schema on Path A)                   | "What kind of music do you feel like hearing?"                                  | 1.7-1.9s    | 🔴 NOT executed (no play_music)                     |
| K' music + schema          | same + MUSIC COMPANION in cb            | (schema injected)                             | `{"tool":"play_music","intent":"mood_based"}`                                   | 1.6s        | 🟢 executed — **proves cut-off is prompt omission** |
| L memory                   | "what to listen tonight" + lo-fi memory | [RELEVANT MEMORY]/[USER IDENTITY]             | "Hey Priya… Chillhop Essentials… lo-fi"                                         | 1.5s        | 🟢 memory influences response                       |
| M atmosphere               | (measured prior)                        | –                                             | –                                                                               | meta 1.3-5s | 🟡 blocking + double-inject                         |
| N fast-path (no cog-block) | "you make me so angry"                  | backend engine.analyze only                   | "Acha, thik hai. Koi baat nahi." (dismissive)                                   | 1.9s        | 🔴 emotion mishandled                               |
| O full-path venting        | "you make me so angry"                  | Frustrated/venting/warm0.2                    | "Oh, so you're just gonna dump that on me…? Bold move"                          | 1.3-7.6s    | 🔴 hostile (params steer but behavior bad)          |

---

## 6. Cognitive cut-off points (evidence-based)

| #   | Cut-off                                                        | Evidence                                                                                                                                                                                                                              | Verdict                 |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| C1  | **Music/action schema absent on Path A**                       | `AURA_SYSTEM_PROMPT` (music) used only by `getSystemPromptForPersonality` (Path B) / Gemini; Path A system_prompt = `cognitive_block + "Respond in 1-3 sentences"`; runtime A/B (K vs K') re-emits the tool                           | 🔴 BROKEN               |
| C2  | **Executive strategy never transmitted**                       | `translatePlanToPrompt` only declared (`ConversationExecutive.ts:301`), never called; `executive_plan` not in either provider body; backend only reads `executive_plan` in the else/fast-path (main.py:884) which providers never hit | 🔴 BROKEN               |
| C3  | **Music context not in Path A history**                        | Path A uses `messagesRef.current` (no music XML, `useProvider.ts:1109-1112`); music XML only in `newMessages` used for Path B                                                                                                         | 🔴 BROKEN               |
| C4  | **LLM answers wrong/unrelated questions with high confidence** | A-factual: "2+2"(→sky-blue/capital-of-France/deflection) across repeats                                                                                                                                                               | 🔴 BROKEN (reliability) |
| C5  | **`cognitive_block` cap <4000 → 422 hard-drop**                | `Field(None, max_length=4000)` enforced at 3999; runtime 4000→422 `string_too_long`                                                                                                                                                   | 🟡 latent (rich turns)  |
| C6  | **Atmosphere double-injection**                                | frontend `[ENVIRONMENT CONTEXT]` (post-first-turn) **and** backend `[REAL-WORLD GROUNDING]` both reach LLM when relevant                                                                                                              | 🟡                      |
| C7  | **Fast-path (no cog-block) mishandles emotion**                | N vs O: dismissive "Koi baat nahi" to an angry user                                                                                                                                                                                   | 🔴 on that branch       |
| C8  | **`[RELEVANT MEMORY]` gated by `plan.memoryPolicy`**           | interpreter:106 — if Executive sets Ignore, fetched memories are omitted                                                                                                                                                              | 🟡                      |
| C9  | **Default `"Answer"` stance everywhere**                       | `determineStance(...,"Answer")` hardcoded (`RuntimeManager.ts:211`) — no strategy-driven override reaches attention                                                                                                                   | 🟡                      |

---

## 7. Provider parity findings

- **LLM/cognition stage: IDENTICAL** between OpenRouter and Sarvam (same frontend brain, same backend
  endpoint, same OpenRouter model, same cognitive_block). 🟢
- Both share cut-offs C1-C9 identically.
- Provider-specific divergence is limited to STT/TTS (Sarvam 403 + audioCtx discard → both ultimately speak
  via Web Speech). This is a TTS/STT parity gap, **not** a cognition gap.
- The only behavioral difference that would _appear_ to affect cognition: Sarvam Path B adds `[ADAPTIVE
MIRRORING]` + `[BEHAVIORAL CONTEXT]` to its system message (OpenRouter does not). But **Path B is the
  rarely-taken fallback** (Path A is primary for both), so this asymmetry is mostly latent.

---

## 8. Full latency breakdown (critical path, measured)

| Stage                      | Latency                                   | Blocks?               |
| -------------------------- | ----------------------------------------- | --------------------- |
| STT (browser/sarvam)       | local / 403→fallback                      | Sarvam yes (≤1.2-3s)  |
| `/api/analyze` L2          | 27-188ms (eager)                          | awaited, off LLM path |
| cognitive block (frontend) | local, few ms                             | awaited, negligible   |
| memory retrieval           | routing absent → fail-open []             | awaited, empty        |
| LLM connect+metadata       | 12-80ms                                   | awaited               |
| **LLM token TTFT**         | **1.1-8.8s** (median ~1.6-2.6s)           | **THE critical path** |
| token stream→total         | +0.2-1.9s                                 | streamed, TTS overlap |
| atmosphere (when gated)    | **+1.3s warm / +5s cold before metadata** | awaited, adds to TTFT |
| music path                 | 3.7-4.9s (async, not blocking LLM)        | no (side path)        |

**Top contributors:** LLM token TTFT (1-9s) » atmosphere cold penalty (5s) » music search (4.9s, async).
No sequential network call on the frontend critical path except the awaited LLM stream + optional atmos.

---

## 9. Critical-path diagram (simplified)

```
STT → [L2 /api/analyze (async/await, fast)] → [cognitive block (local)] →
   POST /api/analyze/stream
     ├─[!include_atmosphere] composer.get_context (1.3s warm / 5s cold)  ← serial, before metadata
     ├─ metadata event
     ├─ LLM token TTFT (1.1-8.8s)  ← dominant
     ├─ token stream → sentence buffer
     └─ TTS (overlap) → drain
Music interceptor ← play_music JSON (only if schema was in prompt: C1)
```

---

## 10-11. Fixes required (ordered by severity) / Optimization opportunities

_(Report only — no changes made. Every item is backed by evidence above.)_

1. **Inject the music/action schema into the Path-A system prompt** (C1) — highest severity: music is a
   headline feature and silently breaks on the normal path. Lowest risk: prepend the `MUSIC COMPANION`
   block (or a shared `ACTION_SCHEMA`) to `cognitive_block` at the provider body, or have the backend
   append it in `main.py:871` alongside the suffix. Proven fix by K' A/B.
2. **Serialise the Executive plan into the prompt or payload** (C2) — send `executive_plan` / `strategy`
   via the body and let backend fast path honor it, or serialize `translatePlanToPrompt` into the cognitive
   block. Medium risk.
3. **Fix LLM reliability** (C4) — the model answers wrong/unrelated questions; raises the question of
   `deepseek/deepseek-chat` suitability for this task. Candidates: a stronger/directive model in
   `FALLBACK_MODELS`, raising `max_tokens=150` (responses truncated), and a stronger "answer the user's
   exact last question" instruction. High impact, medium risk.
4. **Include music context in Path-A `conversation_history`** (C3) so the LLM can reference the current song.
5. **Raise/bound `cognitive_block` cap** (C5) or trim sections to stay <4000 — avoid silent 422 hard-drops.
6. **De-duplicate atmosphere injection** (C6) — keep frontend block OR backend grounding, not both.
7. **Atmosphere parallelization/cache** (from §8) — see companion runtime audit; independent of cognition.
8. **Guard low-warmth/venting behavior** (🟡) — add a minimum-warmth floor / validation directive so anger
   elicits de-escalation, not sarcasm. Behavioral quality, not latency.

---

## 12. Regression results (build/typecheck/recompile)

| Command                        | Result                         |
| ------------------------------ | ------------------------------ |
| `npm run build`                | ✅ 10.66s                      |
| `npm run build:dev`            | ✅ 10.67s                      |
| `npx tsc --noEmit`             | ✅ 15 pre-existing / **0 new** |
| `python -m compileall backend` | ✅                             |

## 13. Files that would need modification (Phase 1 fix targets)

- `backend/api/main.py` (system_prompt construction at :871 → append action schema; atmosphere dedup)
- `src/providers/openrouter/useProvider.ts` + `src/providers/sarvam/useSarvam.ts` (send `executive_plan` /
  music schema / add music ctx to Path-A history)
- `src/runtime/RuntimeManager.ts` / `ConversationExecutive.ts` (serialize plan) [optional]
- `src/lib/gemini-prompt.ts` (expose shared `ACTION_SCHEMA`; raise `max_tokens` direction) [optional]

## 14. Protected / unrelated (do not touch without evidence)

Music internals, Telemetry, Social Cognition engine, Voice architecture, Memory subsystem internals,
`routeTree.gen.ts`, generated/lock/host-system files. (Some of these ARE the subject of cut-offs C1/C3,
but the fix is at the **prompt/provider boundary**, not by rewriting those engines.)

## 15. Phase 1 exit verdict

**❌ DO NOT PASS — cognition integrity is NOT proven end-to-end.**

- The cognitive state **is** constructed and injected (🟢), but
- the **executable portion of cognition is severed at the prompt boundary**: music/actions never reach
  the LLM on the primary path (C1), the Executive strategy is dropped (C2), and memory/context content is
  partially gated/absent; and
- the **LLM does not reliably follow the injected cognitive + factual intent** (C4, C6) — measured
  unrelated answers, hallucinations, stalls, and inappropriate hostility.
  Phase 1 cannot conclude until C1, C2, C4, C5 are fixed and re-tested with the same runtime scenario matrix
  showing consistent behavioral matches.

_No production code modified; temp scripts removed; git tree unchanged (flat 220 pre-existing); no commits._
