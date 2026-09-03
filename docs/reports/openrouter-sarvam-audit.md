# OpenRouter & Sarvam Pipeline — Architecture + Latency Audit

**Date:** 2026-08-31
**Scope:** End-to-end architecture + latency audit of the OpenRouter and Sarvam voice pipelines
(request → provider → STT/transcript → cognitive pipeline → all brains → memory → Pinecone/Redis/Cohere/
Supabase → Attention/Atmosphere/Social Cognition → intent/action → Music → LLM → TTS → playback).
**Method:** Static architecture trace (both providers) + real runtime measurement against the live
backend (`server.py` on :8000, `uvicorn --reload`). Read-only — **no production code modified**,
no temporary instrumentation left in tree. No commits/pushes.

Verification passes run (all pass):
- `npm run build` → PASS, 12.31s
- `npm run build:dev` → PASS, 10.82s
- `npx tsc --noEmit` → 15 pre-existing errors / **0 new** (all in the four known files)
- `python -m py_compile backend/api/main.py memory_endpoints.py core/intelligence/llm_pipeline.py memory/sync.py` → OK

---

## 1. Runtime environment actually used

- Backend: `uvicorn backend.api.main:app --host 0.0.0.0 --port 8000 --reload` (running on :8000).
- Env loaded: project-root `.env.local` (main.py:52 `load_dotenv`) which supplies
  `OPENROUTER_API_KEY` (len 75), `COHERE_API_KEY` (len 42), `REDIS_URL` (len 24), `SARVAM_API_KEY` (len 38).
  Backend `.env` supplies `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ENVIRONMENT=development`.
- `/health` (live): `status=degraded`, `degradation_level=full`; circuits all `closed` (no trips).
  Checks: **redis ok=true (0.19ms)**, **supabase ok=false**, **consumer ok=false** (worker not running).
- Live OpenAPI exposes **23 routes**. Memory routes are **absent** (see Section 8 — critical finding).

### What is measurable vs blocked (runtime capability)
| Infra | Live in this env? | Notes |
|---|---|---|
| Redis (bus/cache/rate-limit/embedding-cache) | ✅ yes (0.19ms) | key present |
| OpenRouter via backend SSE (`/api/analyze/stream`) | ✅ yes | 200, tokens streamed |
| Cohere embedding (as embedding_provider fallback) | ⚠️ present but Gemini takes priority | `GEMINI_API_KEY` set → active=tier1 |
| Supabase (pgvector / `aura_storage`) | ❌ down (`ok=false`) | memory retrieval fail-open empty |
| Sarvam STT (`api.sarvam.ai/speech-to-text`) | ❌ 403 (key unauthorized here) | falls back to browser STT |
| Sarvam TTS (`api.sarvam.ai/text-to-speech`) | ❌ 403 (key unauthorized here) | falls back to browser Web Speech |
| Direct OpenRouter from browser (`ai/v1/chat/completions`) | ⚠️ 401 with this env key | Path-B fallback only |
| Pinecone | ❌ **inactive by design** (`active: False` in telemetry) | Supabase pgvector is live store |
| Frontend browser E2E (mic/SpeechRecognition/audio) | ❌ blocked (no audio devices / no browser) | STT/TTS local stages SKIPPED |

Per the task instructions, everything not measurable is marked **SKIPPED** rather than assumed.

---

## 2. Request → provider → profile resolution

`src/core/useVoiceOrchestrator.ts` (183 lines) selects `ActiveProvider = "gemini" | "openrouter" | "sarvam"`.
Only the active provider's hook runs with real args; inactive hooks receive a sentinel that skips
resource-heavy init. `RuntimeManager.getInstance().initialize()` runs once on mount.

- **OpenRouter** → `useOpenRouter` (`src/providers/openrouter/useProvider.ts`, 2254 lines).
  LLM key via `getOpenRouterKey()` (`src/lib/api.ts:58`). TTFT/TTS are browser-native.
- **Sarvam** → `useSarvam` (`src/providers/sarvam/useSarvam.ts`, 2717 lines). Despite the name, this
  is **not a self-contained Sarvam pipeline**: `Saaras STT → OpenRouter LLM → Sarvam TTS` (comment
  `useSarvam.ts:1108`). Keys via `getSarvamKey()` / `getOpenRouterKey()`.
- **Gemini** → live voice (out of scope for this audit, previously audited).

**Profile resolution:** `ModelProfile` (`buildModelQueue(defaultRanking)`, `useSarvam.ts:1600`) maps
`["llama","deepseek","qwen","gemini","gemma"]` → OpenRouter model IDs for Sarvam Path-B. OpenRouter
uses its own `FALLBACK_MODELS` (`meta-llama/llama-3.3-70b-instruct:free`, `deepseek/deepseek-chat`,
`google/gemini-2.0-flash-lite-001`, `google/gemma-3-27b-it`, `openrouter/free`).

> **Note:** `src/executive/ModelRouter.ts` (`routeConversationModel`) is **defined but not wired**
> into either provider's model selection. Both provider paths use their own static model queues.

---

## 3. Microphone / audio capture → STT / transcript

### OpenRouter (browser Web Speech)
- `SpeechRecognition` (`continuous=false`, `interimResults=true`, `lang: responseLanguage || "hi-IN"`),
  wired at `useProvider.ts:1889-2011`.
- `onspeechstart` → `conversationState.reportUserSpeaking()` + `musicService.onUserSpeechStart()` (duck).
- `onresult` → aggregates final/interim, accumulates transcript, then **adaptive turn delay**
  (`adaptiveTurn.calculateTurnConfidence`, `useProvider.ts:1988-2000`), then `processTurn`.
- **NEVER touches Sarvam STT / whisper / network.** STT is fully local.
- `onerror` → exponential backoff retry (`200*2^(n-1)` cap 2000ms, max 3), `no-speech` silent restart.

### Sarvam (Sarvam STT `saaras:v3` + browser fallback)
- Browser Web Speech used as the *fallback transcript* source (`useSarvam.ts:2023-2035`), plus PCM
  capture via `MicrophoneCoordinator` (`useSarvam.ts:550-605`), Silero VAD feed, WAV assembly
  (`encodeWAV(downsampleBuffer(merged, 16000))`, `useSarvam.ts:2094-2095`).
- Primary: `transcribeAudio(wavBlob)` → `POST https://api.sarvam.ai/speech-to-text` (`sarvamSTT.ts:30-37`),
  model `saaras:v3`, mode `transcribe`, language `hi-IN`/`en-IN`. Whole-utterance HTTP POST (not streaming),
  10s abort. Raced against a 1200ms (with fallback) / 3000ms (without) cap (`useSarvam.ts:2114-2123`).
- **Runtime:** 403 → SKIPPED. In production when the key works, STT is blocking ≤1.2–3s on the critical path;
  on timeout/empty it falls back to `fallbackTranscriptRef` (browser).
- Ordering in `handleStopRecording` (`useSarvam.ts:2261`): awaited before `processTurn`.

**Both providers then run L2 behavior → cognitive pipeline → LLM → TTS → playback (below).**

---

## 4. L2 behavioral analysis (`/api/analyze`) — awaits before LLM

Both providers call `behavior.analyzeForTurn(...)` → `behavior-client.ts:analyzeBehavior` →
`POST {VITE_API_BASE}/api/analyze` (`src/config/api.ts:17`), headers
`X-OpenRouter-Key / X-Gemini / X-Cohere / X-Pinecone / X-Redis-Url`, **500ms abort cap**, awaited.
A **speculative** prefetch (`behavior.fireSpeculative`, `useProvider.ts:1983` / `useSarvam.ts:2200`)
fires earlier during user speech (debounced 500ms / 4-word min, `behavior-client.ts:213`) — async.

**Backend (`/api/analyze`, main.py:549-692) is an "eager dual path":**
1. Hot emotional routing `engine.analyze(...)` (local, <5ms)
2. `retrieve_prefetched_memory()` (Redis-cached speculative memory, instant)
3. Builds `behavior_instructions`, then **returns immediately**
4. Heavy memory pipeline (`run_turn_pipeline`) dispatched as BackgroundTasks (not awaited by client)

**Measured:** `/api/analyze` round-trip ≈ **76ms** (incl. curl + idle Python), matching the sub-200ms target.
So behavior analysis does **not** materially block the LLM path in practice — it's near-instant.

---

## 5. Cognitive pipeline (frontend, all brains) — local & synchronous

`RuntimeManager.processCognitiveTurn` (`src/runtime/RuntimeManager.ts:128-326`) — awaited before LLM:
1. `conversationRuntime.registerUserTurn` (local)
2. `SenseManager.collectAllContext()` — fused perception (local)
3. **`memoryGateway.retrieveMemories(...)`** (`RuntimeManager.ts:167`) — **the only network step; supabase mode → `GET /api/memory/model/:userId` (route NOT SERVED — see §8); local mode → localStorage.** 
4. `buildConversationContext` → `ConversationUnderstanding.understand` (local)
5. **Adaptive Attention** `attentionLayer.determineStance / determinePurpose / assessAtmosphere`
   (`RuntimeManager.ts:211-218`) → produces `lastAtmosphereDecision` (gates atmosphere injection)
6. **`ConversationExecutive.plan(ctx)`** (`RuntimeManager.ts:225`) → understand / deriveSocialUnderstanding
   (**SocialWorldModel**) / StrategyPlanner.plan / ConfidenceManager / ClarificationPolicy / MemoryPolicy /
   InformationBudget / InitiativePolicy / SpeechBehaviorPlanner
7. **Social Cognition** `socialCognition.processTurn(turnInput)` (`RuntimeManager.ts:247`,
   `SocialWorldModel.ts:1048`)
8. `ConversationInterpreter.processTurn(...)` → renders the **cognitiveBlock string** (local)
9. Two `setTimeout(0)` async (non-blocking): AdaptiveCommunicationAnalyzer.observe + `memoryGateway.storeMemory`

Atmosphere relevance gate consumed at provider: `getLastAtmosphereDecision()?.includeAtmosphere`
(`useProvider.ts:1068`, `useSarvam.ts:1171`). Music context injected via `buildMusicContext()`
(`src/lib/aura-actions.ts:117`).

**Latency:** All cognitive work is in-memory JS (single-digit ms typical); negligible vs the 2–9s LLM.
The one network dependency (supabase memory) is fail-open and (in this build) not even served.

---

## 6. Memory (Pinecone / Redis / Cohere / Supabase / UserModel / consolidation)

- **Pinecone:** Inactive by design. Telemetry `"pinecone": {"active": False}` ("key accepted but not
  the live vector store"). Key is ingested from the `X-Pinecone-Key` header (`main.py:479-482`) but
  **never queried**. Real store is **Supabase pgvector** (`backend/memory/sync.py` = the former `chroma.py`).
- **Redis:** Live (0.19ms). Used for the async bus (`backend/bus/redis.py`), speculative-memory cache
  (`redis_bus.client.set f"speculative_mem:{session_id}"`, main.py:519), rate limiter, proactive engine,
  embedding cache, vocab learner. **All off the LLM critical path** (background/fire-and-forget).
- **Cohere:** Used as `embedding_provider` tier-2 (Gemini tier-1 is active since `GEMINI_API_KEY` set).
  Embeddings feed `MemoryPolicy`/UserModel ranking on `/api/memory/model` (unreachable in this build)
  and pgvector writes. **Off LLM critical path.**
- **Supabase:** Down in this env (`ok=false`). Service-role client inited at startup (fail-open). Houses
  `aura_storage` (UserModel + session), pgvector memory.
- **UserModel / consolidation:** `/api/memory/model/{user_id}` (fetch/rank) and `/api/memory/consolidate`
  live in `backend/api/memory_endpoints.py` — but **are not served** (see §8). Consolidation cron target
  is `backend.memory.consolidator` (different path).

**Critical-path verdict:** In production-with-Supabase, the per-turn memory retrieval would be a network
hop, but it is **fail-open**: empty memories degrade the cognitive block, not the loop.

---

## 7. Attention / Atmosphere / Social Cognition

- **Attention** (`attentionLayer`): runs locally in `RuntimeManager.processCognitiveTurn`; `assessAtmosphere`
  gates whether real-world context is fetched this turn.
- **Atmosphere:** Two-stage. (a) Frontend gate → sends `include_atmosphere` to backend. (b) Backend, when
  true, calls `composer.get_context(query, ip, ...)` (real-world/IP/geo/weather/news, TTL 900s cache,
  fail-open, 10s timeout) at `main.py:922`. **This is on the LLM critical path** — see measured §10.
- **Social Cognition** (`SocialWorldModel` → `deriveSocialUnderstanding`): local, runs before LLM.

---

## 8. Critical finding: memory routes are silently dropped

`app` is **reassigned at `backend/api/main.py:144`** (`app = FastAPI(...)`) **after**
`app.include_router(memory_router)` at line 123. The reassignment discards the earlier router registration.

Consequences (verified against live OpenAPI — only 23 routes, **no** `/api/memory/*`):
- `GET /api/memory/model/{user_id}` — the endpoint `memoryGateway.retrieveMemories` calls in supabase
  mode (`src/lib/memory-gateway.ts:162`) — **does not exist** on the deployed app (returns 405).
- `POST /api/memory/consolidate` — **does not exist**.

Impact: in production with Supabase reachable, the frontend suppresses local memory and calls a
non-existent endpoint → 405 → fail-open empty. **Longitudinal memory retrieval for the LLM is,
in this build, effectively dead at the API boundary** even when Supabase is healthy. Local mode
(localStorage) is unaffected.

The bug is a one-line class of issue (early `include_router` before the later `app = FastAPI(...)`
reassignment) — but per the task I report it and do **not** fix it.

---

## 9. LLM call (L4) — primary and fallback

### Backend SSE (Path A — primary, both providers)
- `POST {VITE_API_BASE}/api/analyze/stream` (`config/api.ts:18`), `AbortController`.
- Body carries `text, user_id, session_id, conversation_history, client_memories:[], memory_mode:"supabase",
  cognitive_block, include_atmosphere` (delegates memory to server; client sends empty array).
- Backend (`main.py:846-998`): builds `system_prompt` from `cognitive_block` (canonical path) or
  `behavior_instructions` (fast path), optionally prepends atmosphere grounding, then
  `stream_openrouter_response(...)` (`backend/core/intelligence/llm_pipeline.py:9-59`) →
  `POST https://openrouter.ai/api/v1/chat/completions`, model `deepseek/deepseek-chat`,
  `max_tokens=150`, `stream=True`, server-side `OPENROUTER_API_KEY`.
- SSE events: `metadata` (emotional_state, behavior_instructions, atmosphere) → `text_chunk*` → `done`.
- **Music tool interceptor** parses inline `{"tool":"play_music",...}` and calls `musicService.processIntent`.
- Fallback on failure: direct frontend OpenRouter (Path B).

### Direct OpenRouter (Path B — fallback)
- `POST https://openrouter.ai/api/v1/chat/completions` (`useProvider.ts:1522` / `useSarvam.ts:1637`),
  `Authorization: Bearer`. Model failover queue + 15s abort + 800ms stagger. 401/402/403 short-circuit.

**Measured TTFT (backend SSE, deepseek-chat):** see §10. The dominant latency is **LLM token generation**.

---

## 10. Latency measurements (real runtime, backend SSE floor)

Measured in this environment (OpenRouter key live via header; gold = LLM generation floor + overhead):

| # | Scenario | Connect | Meta TTFT | **Token TTFT** | **Total** | chunks/chars |
|---|---|---|---|---|---|---|
| 1 | `/api/analyze` (behavior L2) | – | – | – | **76ms** | eager return |
| 2 | `/api/analyze/stream` COLD | 15ms | 15ms | **4891ms** | **6013ms** | 7 / 50 |
| 3 | `/api/analyze/stream` WARM | 79ms | 79ms | **8823ms** | **10040ms** | 7 / 32 |
| 4 | `/api/analyze/stream` WARM | 12ms | 12ms | **1970ms** | **3424ms** | 14 / 98 |
| 5 | `/api/analyze/stream` **atmosphere=true** | – | **3118ms** | **11474ms** | **11740ms** | – |
| 6 | `/api/ytmusic/search` (music spawn) | – | – | – | **4903ms** | – |
| 7 | `/api/memory/model/:id` | – | – | – | **405 (route not served)** | fail-open |
| 8 | Sarvam TTS | – | – | – | **403 SKIPPED** | env-blocked |
| 9 | Sarvam STT | – | – | – | **403 SKIPPED** | env-blocked |
| 10 | Direct OpenRouter (Path B) | – | – | – | **401 SKIPPED** | env-blocked |

**Cold vs warm:** not a meaningful split for the LLM — results 2–4 (same session, back-to-back) show
**2s–9s** token TTFT with high variance (1970 / 4891 / 8823ms), driven by provider-side queueing/scheduling,
not local state. Warm uptime did not lower it.

**Two decisive latency findings:**
1. **Token TTFT is 2–9s** — the first spoken word waits this long. The metadata event (15–80ms) is fast,
   but the *first real token* is the bottleneck. This is the **number-one critical-path latency.**
2. **Atmosphere turns cost +3s**: `composer.get_context` runs *before* metadata is yielded
   (`main.py:938-946`), so an atmosphere-relevant turn pushes metadata to ~3.1s and token TTFT to
   **~11.5s**.

**Max response tokens** is `max_tokens=150` backend / 80 frontend direct; the system prompt requests
"1-3 sentences". Measured responses were only 32–98 chars and the model frequently returned
stall/evasion-style turns ("Oh, interesting! What's got you curious right now?") — see §16.

---

## 11. TTS (text → audio → playback)

### OpenRouter — browser Web Speech only
- Sentence-chunked via `drainQueue`/`tryStartTTS`. `parseSegments` → `speakChunk`
  (`useProvider.ts:776-922`): strips JSON/noisy text, picks language/premium voice, per-style pitch/rate/vol,
  `SpeechSynthesisUtterance`, registered via `SpeechCoordinator` (`window.speechSynthesis.speak`).
- **No network.** First-audio latency ≈ last sentence boundary (i.e., close to Token TTFT) + local synth.

### Sarvam — Sarvam TTS `bulbul:v3` (network) with a **discard bug**
- `generateSpeech(text, speaker, pace, lang)` → `POST https://api.sarvam.ai/text-to-speech`
  (`sarvamTTS.ts:38-46`), `bulbul:v3`, 10s abort, awaited per sentence. Returns whole-response base64.
- **Critical defect:** `audioCtxRef` is declared (`useSarvam.ts:545`) but **never assigned**. The guard
  `if (!base64 || !audioCtxRef.current)` at `useSarvam.ts:830` is always true, so the Sarvam base64 audio
  is **discarded** and every sentence is actually spoken by `speakChunkNative` → **browser Web Speech**
  (`window.speechSynthesis`). The `SarvamTransport`/`SpeechCoordinator.enqueueRawBytes` decode+play branch
  (`useSarvam.ts:835-867`) is dead code.
- **Net effect:** Sarvam's network TTS costs an unnecessary awaited HTTPS round-trip per sentence, then
  throws the audio away and falls back to a *different* engine. The audible result is never Sarvam.
- **Now + in prod:** network 403 in this env (SKIPPED). With a working key it would still hit the discard
  branch → always Web Speech.

### Shared
- Barge-in: 400ms grace, dynamic RMS threshold (0.04 → 0.15 during AURA speech), 15 loud frames →
  `speechSynthesis.cancel()` + sentence-queue clear + `onInterrupt`.
- Music ducking: `onAuraSpeechStart/End` → `MusicService` volume fade to 20% / restore (local).

---

## 12. Intent / action / Music execution

Two parallel music-command seams (known architecture):
1. **Gemini Live tool-call seam** (`GeminiSession` schema → `useLiveNext.handleToolCall` →
   `executeAuraAction` in `src/lib/aura-actions.ts` → `MusicService.processIntent`) — Gemini only.
2. **OpenRouter/Sarvam prompt-tag seam:** `parseSegments` (`useProvider.ts:90-346`) and
   `extractStageDirections` (`useSarvam.ts:120-240`) parse `PLAY_YOUTUBE: / STOP_YOUTUBE / PAUSE_MUSIC /
   RESUME_MUSIC / SEEK: / NEXT_SONG / PREV_SONG / VOLUME_* / MUSIC_ASSOCIATION / MUSIC_EMOTION`,
   plus inline `{"tool":"play_music",...}` in the token stream. Both call `musicService.processIntent`
   via **dynamic `import()`** (fire-and-forget, never blocks spoken-text drain).

`MusicService.processIntent({type:"play"})` → `search(query)` (network) → `rankTracks` → `playTrack` →
`HTMLAudioPlaybackProvider.play`. Music commands are **asynchronous** relative to speech.

**Measured:** `/api/ytmusic/search?query=lofi chill` ≈ **4903ms** (yt-dlp in-process search). This is the
dominant cost of any music-intent turn — on a side path (speech continues under it), so it degrades the
music start, not the reply text.

---

## 13. Response path / playback / streaming

- **Sentence-buffered TTS:** LLM SSE tokens are split at sentence boundaries (`SENTENCE_END` regex /
  `TERMINAL_PUNCTUATION`) into `sentenceQueueRef`; `tryStartTTS()` starts speaking as soon as the first
  sentence completes → **audible response begins at ≈ Token TTFT**, not at stream end. Helper delay/pause
  computed by `conversationalPauses.getPause` and `RuntimeManager.evaluateDecision`
  (HumanResponseTimingEngine: SPEAK/WAIT/BACKCHANNEL).
- Backend path: response text preserved to transcript/chat buffer; non-speakable directives stripped.
- Music interceptor strips tool JSON so it is never spoken.

---

## 14. `executeAuraAction` and shared action seam health

- `executeAuraAction` (`src/lib/aura-actions.ts:336`) is the canonical action seam and is used by the
  **Gemini tool-call path**. The **OpenRouter/Sarvam tag/JSON paths bypass it** and inline
  `musicService.processIntent` instead. Both converge on `MusicService`. Not a defect — a documented
  divergence; consolidation opportunity only (out of scope to change).

---

## 15. Music latency & playback timeline (from measured data)

Typical music-intent turn timeline (OpenRouter, from measurements):
```
user speech
  → adaptive delay (~1-2s, TBD per turn)
  → /api/analyze        ≈ 76ms        (L2, awaited)
  → cognitive block     ≈ few ms      (local)
  → /api/analyze/stream
       metadata         ≈ 15-80ms
       first token      ≈ 2-9s   ◄── critical
       [song search fires async ≈ 4.9s]
       sentence "OK playing that..." spoken ≈ after first token
       [song starts ≈ after search completes ≈ +4.9s]
```
Music intent starts on a **side path** (async), so speech isn't blocked by the ~4.9s search; the *song*
itself starts ~4.9s in, concurrently with/after speech. Atmosphere-relevant turns shift first-audio to
~11.5s (see §10).

---

## 16. Response quality / behavioral observations (measured)

- Backend `system_prompt = "{cognitive_block}\n\nRespond in 1-3 sentences. Speak naturally, not formally."`
  combined with `deepseek/deepseek-chat` `max_tokens=150` produced **numerous stall/evasion responses**:
  "Oh, interesting! What's got you curious right now?", "Oh yeah? What's got you curious?", "Oh wow, what
  made you think of that? I'm genuinely curious to hear more...". Several were cut at ~32–50 chars — the
  model ended on a question to the user instead of answering, consistent with under-promoted directness
  and a low token ceiling that truncates the actual answer.
- Sarvam fallback replies come from the brain's spelling of values; with Sarvam TTS dead, quality is
  governed by browser voices, not Sarvam `bulbul:v3`.

---

## 17. Att: skips / not measured / assumptions

- **SKIPPED (env-blocked, no device/browser):** browser SpeechRecognition local STT stage timing;
  `window.speechSynthesis` local TTS stage timing; full frontend orchestration timeline (adaptive delay
  duration, sentence-drain pacing); music playback through `HTMLAudioPlaybackProvider`; Sarvam STT/TTS
  network latency (403); direct OpenRouter Path-B (401 with this env key).
- **Assumed from producer/browser semantics** (not independently timed): adaptive-turn delay, VAD/barge-in
  timing, Web Speech voice pitch/rate timing.
- **Not measured end-to-end in a browser**, so TTF-*first-spoken-word* is derived as
  ≈ Token TTFT (± local synth) — the LLM token time is the dominant, externally-verified term.

---

## 18. Recommendations (report only — no code changed)

1. **Highest priority — fix the critical-path LLM TTFT (2–9s).** Investigate deepseek-chat queueing on
   OpenRouter; consider higher-priority/premium model, larger generation before first flush, and/or
   streaming-TTS overlap. Target <1.5s token TTFT.
2. **Fix the dropped `memory_router`** (`main.py:144` reassigns `app` after the line-123 include). Restore
   `/api/memory/model/{user_id}` and `/api/memory/consolidate`, or the longitudinal-memory layer is dead
   at the API boundary in production.
3. **Fix Sarvam `audioCtxRef` never assigned** (`useSarvam.ts:545`) so `bulbul:v3` audio is actually
   played, or remove the wasted per-sentence TTS network call (it is always discarded and always falls
   back to Web Speech).
4. **Atmosphere cost:** `composer.get_context` runs before the metadata event (`main.py:938`), adding ~3s.
   Yield metadata first and stream atmosphere as a later `atmosphere_ready` event to uncouple it from TTFT.
5. **Response quality:** raise/retain direct-answer instruction and raise backend `max_tokens` (150 is
   trivially truncated; stall responses suggest the ceiling cuts the answer short).
6. **Music search ~4.9s:** already async; consider warming/common-query cache or parallel search fallbacks
   to lower perceived song-launch latency.
7. **Sweep dead routing:** `IncludeRouter` calls before the final `app = FastAPI(...)` are dropped; audit
   both `cron_router` (line 120 vs 158) and `memory_router` (line 123) registrations.

---

*No production code was modified; no temporary instrumentation remains; no commits/pushes made.*
