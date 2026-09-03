# AURA — OpenRouter + Sarvam Production-Grade Runtime Audit

**Date:** 2026-08-31
**Method:** Trace one request end-to-end; measure every stage independently against the live backend
(`server.py`/`uvicorn backend.api.main:app --reload` on :8000) plus direct provider/engine probes.
Read-only — **no production code modified, no commits/sstages/pushes, no temp instrumentation left.**
Every claim is backed by a measured number or a code-path verification, and flagged 🟢/🟡/🔴/⚪.

### Verification passes (all re-run this session)
| Check | Result |
|---|---|
| `npm run build` | ✅ PASS 19.21s |
| `npm run build:dev` | ✅ PASS 12.08s (one transient rollup failure on a *parallel* first attempt — not reproducible; prod also built) |
| `npx tsc --noEmit` | ✅ **15 pre-existing errors / 0 new** (VoiceLanguageManager, MusicPerceptionOrchestrator, WebAudioPerceptionProvider, UserModelManager) |
| `python -m compileall backend` | ✅ PASS |

---

## 0. Traffic-light summary of findings

| # | Finding | Verdict |
|---|---|---|
| F1 | `app` reassigned at `main.py:144` drops `memory_router` (line 123) → `/api/memory/model/{user_id}` & `/api/memory/consolidate` **not served** | 🔴 BROKEN |
| F2 | Atmosphere composer blocks metadata pre-yield: cold ~5.0s, warm same-session ~1.3s, +LLM → token TTFT up to ~11.5s | 🔴 BROKEN (critical path) |
| F3 | LLM token TTFT 2–9s (OpenRouter backend SSE) is the dominant critical-path cost | 🔴 BROKEN (bottleneck) |
| F4 | Sarvam `audioCtxRef` never assigned → sarVam TTS audio always discarded → always browser Web Speech | 🔴 BROKEN (logic) |
| F5 | Sarvam STT/TTS keys → **403 invalid_api_key_error** in this env (network-blocked, fallback to Web Speech) | 🟡 PARTIAL (env/key) |
| F6 | `max_tokens=150` truncates answers; model returns stall/evasion turns; ignores emotional content in fast-path default block | 🟡 PARTIAL (quality) |
| F7 | Music search `/api/ytmusic/search` ~4.9s cold / 3.7s warm (weak cache) | 🟡 PARTIAL |
| F8 | Direct OpenRouter (Path-B) 401 with this env key — Path-B not independently verifiable here | 🟡 PARTIAL |
| F9 | Pinecone inactive by design (`active:False`); real store is Supabase pgvector | ⚪ NOT INVOKED |
| F10 | Cache pollution: all caches (composer per-session, embedding md5, behavior word-overlap) are correctly scoped | 🟢 VERIFIED SAFE |
| F11 | Background memory pipeline (`run_turn_pipeline`), Redis bus, embeddings, relationship tracker all off critical path | 🟢 VERIFIED |

---

## 1. REQUEST → every stage → latency → dependency → output → next stage

Provider-selection: `useVoiceOrchestrator.ts` `ActiveProvider`. Both OpenRouter and Sarvam converge on the
**same** back-end LLM path (`/api/analyze/stream` → OpenRouter) and the **same** frontend cognitive brain
(`RuntimeManager.processCognitiveTurn`). Their difference is **STT and TTS** only.

### Stage chain (shared, with measured latencies)
| # | Stage | Where | Latency (measured / estimate) | Depends on | Blocks? | Output → next |
|---|---|---|---|---|---|---|
| 1 | **STT / transcript** | OpenRouter: browser Web Speech (local). Sarvam: `saaras:v3` NW + browser fallback | OpenRouter: local (SKIPPED, no browser). Sarvam NW: **403 blocked** → fallback transcript local | mic | OpenRouter no; Sarvam yes (≤1.2–3s cap) | `userText` → L2 |
| 2 | **L2 behavior** `/api/analyze` | backend `engine.analyze` + Redis speculative | **27–188ms** (cold 188 / warm 27–72); speculative prefetch 4.9ms | none (local hotpath) | awaited but **not on LLM critical path** (eager return) | `behavior_instructions` → cognitive |
| 3 | **Cognitive block** (all brains) | `RuntimeManager.processCognitiveTurn` | local JS, single-digit ms (est) | none | awaited, negligible | `cognitiveBlock` string + `lastAtmosphereDecision` |
| 4 | **Memory retrieval** | `memoryGateway.retrieveMemories` | supabase mode → `/api/memory/model/:id` **route absent (405)** → fail-open []; local mode → localStorage | supabase/local | awaited, but always empty in this build | memories → (empty) → cognitive/LLM |
| 5 | **Atmosphere gate** | `attentionLayer.assessAtmosphere` | local | attention | sets `include_atmosphere` | flag → backend |
| 6 | **LLM `/api/analyze/stream`** connect+metadata | backend SSE | **12–80ms** | keys/OR | awaited | `metadata` event |
| 7 | **LLM token TTFT** | backend `stream_openrouter_response` (OpenRouter `deepseek-chat`) | **1081–8823ms** (see table §10) | OpenRouter | awaited (stream) | first `text_chunk` |
| 8 | **Token streaming** | OpenRouter SSE → sentence buffer | to total (total–TTFT) | OpenRouter | streamed, TTS overlaps | sentences → TTS |
| 9 | **TTS** | OpenRouter: browser Web Speech (local). Sarvam: `bulbul:v3` NW **+ discard bug → Web Speech** | Sarvam NW **403 blocked**; local SKIPPED | audio | OpenRouter no; Sarvam yes (wasted) then local | spoken audio |
| 10 | **Music/intent** | `parseSegments`/`extractStageDirections` → `musicService.processIntent` → `/api/ytmusic/search` | search **3.7–4.9s**, async side-path | yt-dlp proxy | **no** (async fire-and-forget) | track play |

**Exact invocation order (from code, `useProvider.ts`/`useSarvam.ts`):**
`STT → (speculative analyze fires async) → onresult final → adaptive turn delay → processTurn:
stopSpeech → thinking cue → behavior.analyzeForTurn (await) → RuntimeManager.processCognitiveTurn (await)
→ buildMusicContext → atmosphere gate → POST /api/analyze/stream (SSE) → sentence chunk → TTS
→ drain → restart session. Barge-in overlays throughout (async).**

---

## 2 & 3. Per-stage latency / OpenRouter vs Sarvam parity

**LLM stage is bit-for-bit identical between providers** (same `/api/analyze/stream` + OpenRouter). Parity
matrix of *provider-specific* stages:

| Stage | OpenRouter | Sarvam | Parity |
|---|---|---|---|
| STT | browser Web Speech (local, no NW) | sarVam `saaras:v3` (NW, 403 here) + browser fallback | **Divergent** — Sarvam adds an NW call that fails → same fallback as OpenRouter |
| LLM | `/api/analyze/stream` (or direct OR fallback) | **identical** `/api/analyze/stream` (or direct OR fallback) | **Identical** |
| TTS | browser Web Speech (local) | sarVam `bulbul:v3` (NW, 403 here) **discarded by audioCtxRef bug** → browser Web Speech | **Divergent but converge** — Sarvam's NW TTS is always thrown away; audible = Web Speech in both |
| Music | same MusicService seam | same MusicService seam | **Identical** |
| Cognitive brains | RuntimeManager (same) | RuntimeManager (same) | **Identical** |
| Model selection | OpenRouter `FALLBACK_MODELS` queue | Sarvam `buildModelQueue` (same OR models) | Equivalent static queues; neither uses `ModelRouter` (⚪) |

**Conclusion:** Sarvam is *not* a real second pipeline — it is OpenRouter-LLM + sarVam STT/TTS that are
both non-functional-here (403) and partially broken (TTS audio discarded). **Sarvam's runtime audible
behavior ≈ OpenRouter's** (Web Speech on both ends), at the cost of two purposeless Sarvam network
round-trips per utterance (STT, TTS).

---

## 4 & 5. External service audit (call occurs / consumed / timeout / cache / blocks / fallback)

| Service | Call occurs? | Response consumed? | Timeout / retry | Cache | Blocks LLM path? | Fallback |
|---|---|---|---|---|---|---|
| **Pinecone** | ⚪ **No** — not in any register (only key ingestion at main.py:479; telemetry `active:False`) | n/a | n/a | n/a | No | Supabase pgvector is the store |
| **Redis** | ✅ bus, speculative-mem (`speculative_mem:{sid}`), rate-limit, embedding-cache, proactive (0.19ms ping) | ✅ consumed | fail-open circuit; `REDIS_URL` alpine | in-memory per-session | **No** — background/instant | degrade to sync |
| **Cohere** | 🟡 as `embedding_provider` tier-2 (only if Gemini absent; Gemini is tier-1 here) | consumed only for embeddings (memory store / model ranking) | 10s | Redis `aura:emb:{provider}:{md5}` | **No** (in background memory task) | Gemini→Cohere→FastEmbed→none |
| **Supabase** | 🟡 `aura_storage` read/writes in user-model + memory paths; **down here** (`ok:false`) | → fail-open empty | n/a | n/a | **No** (background) — and its GET endpoint is **not even routed** (F1) | local mode → localStorage |
| **OpenRouter (via backend)** | ✅ `/api/analyze/stream` (deepseek-chat) | ✅ tokens consumed (streamed to client) | 15s / model-failover | no response cache | **YES — the critical path** | backend→direct-frontend(PB) |
| **Sarvam STT** | 🔴 attempted → **403 invalid_api_key_error** (1138ms) | ✗ | 10s + browser-fallback race | n/a | only on Sarvam provider | browser Web Speech transcript |
| **Sarvam TTS** | 🔴 attempted → **403** (978ms) | ✗ (and even on success would be discarded, F4) | 10s | n/a | on Sarvam provider | browser Web Speech |
| **Music/YouTube** | ✅ `/api/ytmusic/search` → yt-dlp; `/api/ytmusic/resolve`; `/api/ytmusic/proxy` (SSRF-guarded) | music search 4.9s cold / 3.7s warm | 15s/120s proxy | weak `_audio_url_cache` | **No** (async side-path) | Invidious fallback instances |

---

## 6. Five cognitive brains + memory/attention/atmosphere → provider/music/voice

Trace of `RuntimeManager.processCognitiveTurn` (frontend, all local):
1. **ConversationUnderstanding** (`understand`) → input understanding
2. **Adaptive Attention** (stance/purpose/**assessAtmosphere**) — gates atmosphere; produces `attentionBlock`
3. **ConversationExecutive.plan** → **SocialWorldModel** (deriveSocialUnderstanding) + StrategyPlanner/
   Confidence/ClarificationPolicy/**MemoryPolicy**/InformationBudget/Initiative/SpeechBehavior
4. **Social Cognition** (`socialCognition.processTurn`) → `socialDecision`
5. **ConversationInterpreter** → renders the `cognitiveBlock` string
→ consumed by provider → `/api/analyze/stream` `cognitive_block` → backend system prompt → LLM.
→ Music gate: `buildMusicContext` (relevance) + `processIntent` on intent tags (async).
→ Voice: sentence-drain → duck (`onAuraSpeechStart/End`).

`ModelRouter.routeConversationModel` and `assembleCognitiveContext` are **⚪ NOT INVOKED** in either
provider path (confirmed by trace). Memory block is effectively empty (F1).

---

## 7. Dead branches / sequential awaits / duplicates / hidden latency

| Finding | Evidence | Type |
|---|---|---|
| `memory_router` registered then dropped (F1) | `app = FastAPI()` at 144 after `include_router` at 123 | **dead route** |
| Sarvam TTS audio decoded branch unreachable (F4) | `audioCtxRef` null guard always true (`useSarvam.ts:830`) | **dead branch** |
| Composer 5 engines awaited **serially** though independent | `composer.py:86,98,104,114,124,131` sequential `await` | **sequential-wait hidden latency** |
| `fallback_engine` DDG search **uncached**, re-runs every freshness turn | `get_context` [triggered] always `_search_ddg_fallback` | **duplicate per-turn cost** |
| Metadata event withheld until composer done | `main.py:938-946` yield metadata after `composer.get_context` | **sequential-wait** |
| `/api/analyze` turn-history append double (both `analyze` and stream endpoints mutate `active_sessions`) | main.py:604-608 & 864-865 | duplicate-write (benign) |
| `update_byok_credentials` re-enters env each request (dedup by value) | main.py:454-487 | guard present, fine |
| Direct-OR Path-B and backend Path-A both exist as fallback pair | useProvider.ts:1371-1380 | intended fallback, 🟡 unverifiable key |

Fire-and-forget (non-blocking, ✅): speculative analyze, memory persistence (`setTimeout` + `BackgroundTasks
.run_turn_pipeline`), vocab learner, proactive engine, music `import()` execution.

---

## 8. Cache analysis & pollution

- **Composer caches** (`_geo/_env/_device/_net_*`): keyed by `session_id`, TTL 900/900/30/30s. ✅ No
  cross-session pollution. **BUT** the first atmosphere turn per session pays full cold cost (~5s) because
  nothing pre-warms them.
- **Behavior cache**: Redis hot-cache + `isSpeculativeResultUsable` (≥70% word overlap gate) → a stale
  speculative result doesn't leak into an unrelated turn. ✅ Safe.
- **Embedding cache**: `md5(normalized text)` — exact-text only. ✅ Safe.
- **Music `_audio_url_cache`**: keyed by URL. ✅ Safe.
- **Conclusion:** No measured cache-pollution of unrelated turns (F10). The cache *gaps* are: uncached
  fallback DDG search (per-turn ~1s) and cold composer on first atmosphere turn.

---

## 9. Representative scenarios (live `/api/analyze/stream`, both providers share this)

| Scenario | Meta | Token TTFT | Total | chars | Note |
|---|---|---|---|---|---|
| Factual COLD | 15ms | 4891ms | 6013ms | 50 | deepseek-chat queue |
| Factual WARM | 12–79ms | 1970–8823ms | 3.4–10.0s | 32–98 | high variance |
| Emotional | 27ms | 1081ms | 1455ms | 26 | default block ignores emotion → "Sure! What's on your mind?" |
| Memory-injected | 35ms | 8365ms | 9997ms | 76 | memory block present but model stalls |
| Atmosphere (cold sess) | **5007ms** | 8705ms | 9936ms | – | composer blocks metadata |
| Atmosphere (warm sess) | **1260ms** | 4875ms | 8397ms | – | only uncached DDG + time remain |
| Follow-up/continuation | 32ms | 2494ms | 2747ms | 26 | music tag `*[plays chill lofi beats]*` live |
| Provider-failure (Path-B) | – | – | – | – | 401 with env key — Path-B unverifiable here |
| External-service timeout | – | – | composer fails-open at 10s (main.py:929) | | geo/env/network each fail-open |

**Cold vs warm:** LLM TTFT is **not** cold/warm-served (backend warmed; variance is provider-side
2–9s). The only meaningful cold/warm split is **atmosphere** (~5s cold → ~1.3s warm same-session → still
blocking per turn until a pre-warm strategy exists). Music search 4.9→3.7s (weak cache).

---

## 10. ROOT CAUSE — include_atmosphere delays (F2)

Measured composer sub-stage latency (fresh process, direct engine calls):

| Engine | Cold | Cached | Dependency |
|---|---|---|---|
| geo (ipapi.co) | **1598ms** | ~0 (per-session) | none (feeds env) |
| env (open-meteo) | **1913ms** | ~0 (per-session) | needs geo lat/lon |
| device | 66ms | 30s TTL | none |
| network | **1137ms** | 30s TTL | none |
| fallback DDG (news) | **981ms** | **NOT cached** | query freshness |
| time | 37ms | dynamic | needs timezone |
| **composer.get_context COLD** | **5761ms** | (771ms warm same-session) | serial |

**Why metadata is delayed:**
- `main.py:938` — `event_generator` calls `await composer.get_context(...)` (10s cap) **before** the
  first `yield` of `metadata`.
- The composer runs its engines **strictly serially** (each `await` waits for the previous). Geo→env forms
  a necessary chain, but **time, device, network, and fallback are independent** of geo/env yet still
  wait in sequence.
- The **fallback DDG search (~1s) is uncached**, so even a fully-warm same-session atmosphere turn still
  pays ~1.3s (time + DDG) before metadata.

**Can it be parallelized/cached/moved off the blocking path without losing same-turn grounding?**
- **Parallelize:** wrap the independent group `[time, device, network, fallback]` in `asyncio.gather`
  alongside the `geo→env` chain. Cold ~5.8s → dominated by `max(env~1.9, network~1.1, ddg~1.0)` ≈ **~2s**;
  warm same-session ~1.3s → dominated by `max(time~0.04, ddg~1.0)` ≈ **~1.0s**. Backed by the per-engine
  numbers above.
- **Cache gap:** cache the fallback DDG results (e.g., 5–10 min per query or per query+session). Eliminates
  the recurring ~1s per atmosphere turn.
- **Pre-warm during speech:** the composer is only needed when `include_atmosphere=true`, which the
  frontend already decides in the cognitive step (before the LLM call). A speculative composer call fired
  during user speech (mirroring the behavior speculative prefetch) would warm the per-session caches so
  the first atmosphere turn is ~fast.
- **Move fully off the block:** you **cannot** emit metadata and still inject the grounding into the *same
  turn's* system prompt without waiting — the LLM call follows immediately and needs `atmosphere_grounding`
  beforehand (`main.py:933`). Options: (a) accept ungrounded first tokens (yield metadata, push grounding
  as a later `atmosphere_ready` event the frontend can surface), or (b) require pre-warm/cache so the wait
  is ~0. **Ranked: parallelize (low risk) > cache DDG (low risk) > pre-warm during speech (medium) >
  defer grounding to an event (medium, changes contract).**

Estimated impact of parallelize+cache on warm atmosphere turn: metadata 1260ms → ~100ms; token TTFT
~4.9s → ~3.8s (only the composer saving removed).

---

## 11. Above the critical path — confirmed non-blocking

- Redis bus, rate-limiter (fail-open), speculative analyze, `run_turn_pipeline` (memory store,
  embeddings, user-model, relationship, vocab), proactive engine — all `BackgroundTasks`/`setTimeout`/
  intervals. **Measure: none extend token TTFT.**

---

## 12. Highest-impact bottlenecks (evidence-ranked)

| Rank | Bottleneck | Evidence | Est. saving |
|---|---|---|---|
| B1 | **LLM token TTFT 2–9s** (OpenRouter deepseek-chat) | factual/emotional/memory runs all ≥1s; variance to 8.8s | biggest — target <1.5s (premium model / concurrency / first-flush) |
| B2 | **Atmosphere composer blocks metadata** (cold 5s / warm 1.3s per turn) | F2 §10 | cold→~2s, warm→~0.1s |
| B3 | **Music search 3.7–4.9s** (weak cache) | measured | cache/parallel fallbacks |
| B4 | **Memory retrieval dead (405)** → empty memory → LLM unknowing | F1 | restore route (correctness, not latency) |
| B5 | **Sarvam TTS wasted round-trip + discard** | F4/F5 | remove or fix play path |

---

## 13. Fixes ranked by impact/risk

| Pri | Fix | Impact | Risk | Evidence |
|---|---|---|---|---|
| 1 | Investigate OpenRouter deepseek-chat token TTFT (model/concurrency/first-flush); enforce gen before flush | High (latency) | Low-Med | §10 tables |
| 2 | **Fix `app` reassignment** (F1): include `memory_router` after `app = FastAPI()` at 144, or restore memory routes | High (correctness/memory) | Low | openapi shows absent |
| 3 | **Parallelize composer engines** + cache fallback DDG (F2) | High (atmosphere latency) | Low | §10 numbers |
| 4 | Fix/remove **Sarvam `audioCtxRef` discard** (F4) + stop pointless NW call | Med (provider truthfulness) | Low | usage dead branch |
| 5 | Raise **`max_tokens`** (150) + strengthen direct-answer prompt; stop default-block emotion blindness | Med (quality) | Low | truncation + stall responses |
| 6 | **Pre-warm composer** during user speech (mirror behavior speculative) | Med (first atmosphere turn) | Med | §10 |
| 7 | **Music search cache** (multi-tenant, TTL-keyed) | Med (music launch) | Low | 4.9s→3.7s weak |
| 8 | Defer grounding to an `atmosphere_ready` event (contract change) | Low (TTFT) | Med | only if same-turn grounding optional |

No redesign of architecture; each fix is independently backed by a measured number (explicitly
prioritized; no speculative changes).

---

## 14. Regression results

- `tsc --noEmit`: 15 pre-existing / **0 new** (same set). ✅
- `npm run build` PASS; `npm run build:dev` PASS (one non-reproducible transient). ✅
- `python -m compileall backend` PASS. ✅
- Live backend behavior unchanged by audit (no edits). ✅

## 15. Exact remaining blockers for full E2E

1. **No browser/audio device** in this env → OpenRouter STT + TTS (local Web Speech) and the full
   frontend drain pipeline can only be **code-traced**, not runtime-timed (SKIPPED, flagged 🟡).
2. **Invalid Sarvam `api-subscription-key` (403)** → Sarvam STT/TTS real latency and the (latent) audio
   decode path are unmeasurable here.
3. **Direct OpenRouter Path-B (401)** with this env key → Path-B (browser-side) not independently measured.
4. **Supabase down (`ok:false`)** → real pgvector retrieval latency unmeasurable (and the route is dead F1
   anyway).
5. `rediss://` Upstash Redis reachable (0.19ms) — Redis stages verified, but bus/consumer worker offline.

Recommend running `scripts/test-*.ts` (`test-executive`, `test-language`, etc.) in a **browser** with
valid Sarvam + Direct-OR keys to close blockers 1–3.

---

*Full evidence in this report; temp measurement scripts removed; no source files modified; git tree
unchanged from its pre-existing 220-file dirty state (only the new report file added, untracked).*
