# AURA System Walkthrough — Production Architecture v4.1

> Full lifecycle: mic input → analysis → Gemini response → cost accounting
> Last updated: 2026-05-15 | Status: Production Hardened

---

## 0. Architecture Overview

AURA is a voice-first AI companion built on a **5-Brain parallel async architecture**.
The key design principle: **no enrichment work runs on the real-time audio path**.

```
User Mic ──► Gemini Live (WebSocket) ──► AURA speaks
                    │
          (fire-and-forget, <1ms)
                    ▼
           Redis Stream (aura:transcripts)
                    │
           Brain 3 Consumer (async worker)
                    │
    ┌───────────────┼───────────────────┐
    ▼               ▼                   ▼
Behavior       pgvector Memory     Relationship
Analysis       Retrieval (v2)      Tracking
    │               │                   │
    └───────────────┴───────────────────┘
                    ▼
           Redis Hot Cache (aura:analysis:{session_id})
                    │
           server.py reads on next turn ◄── <5ms cache hit
```

**Files responsible for architecture:**

- `server.py` — FastAPI entry point, orchestrator
- `behavior_engine_consumer.py` — Brain 3 async worker
- `redis_bus.py` — Stream + cache communication layer
- `src/hooks/useGeminiLive.ts` — Composition root hook

---

## 1. USER INPUT: Mic Capture

### 1.1 Browser-side mic setup

**File:** `src/hooks/gemini/useAudioPipeline.ts`

- Browser requests mic via `getUserMedia()` with echo cancellation + noise suppression + AGC
- Audio is encoded as 16kHz PCM, chunked into Float32Arrays
- Chunks sent to Gemini via `session.sendRealtimeInput()` (WebSocket, binary frames)
- The AudioPipeline also feeds a VAD (Voice Activity Detection) AnalyserNode for RMS measurement

**Cost impact:** Zero — mic capture is client-side only, no API calls.

### 1.2 Gemini Live VAD

**Config set in:** `src/hooks/gemini/useGeminiWebSocket.ts` (lines 231–238)

```typescript
realtimeInputConfig: {
  automaticActivityDetection: {
    startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
    endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
    prefixPaddingMs: 20,
    silenceDurationMs: 500,
  },
}
```

- Gemini detects speech start/end on its side (no client-side VAD needed)
- `END_SENSITIVITY_LOW` = waits a full 500ms of silence before declaring turn complete
- This prevents premature cutoffs mid-thought
- `prefixPaddingMs: 20` captures the soft consonant at the very start of speech

---

## 2. TALKING: Real-Time WebSocket Session

**File:** `src/hooks/gemini/useGeminiWebSocket.ts`

### 2.1 Connection & Model Cascade

- Connects to Gemini Live via `ai.live.connect()` with the `gemini-2.5-flash-preview-native-audio-dialog` model
- **Model cascade:** If the primary model rejects (API key tier, region), the hook automatically tries the next model in `LIVE_MODELS[]` — silent to the user
- 12s connection timeout before surfacing an error

**Cost impact:** Each successful connection starts a **Gemini Live session** (billed per second of audio streamed).

### 2.2 Layered Prompting System (L1/L2/L3)

**File:** `src/lib/gemini-prompt.ts`

Three prompt layers sent at different cadences:

| Layer                           | Content                                             | When Sent                                     | Token Cost               |
| ------------------------------- | --------------------------------------------------- | --------------------------------------------- | ------------------------ |
| **L1** `AURA_SYSTEM_PROMPT`     | Static identity, speech rules, behavioral constants | Once at session start via `systemInstruction` | ~120 tokens, billed once |
| **L2** `buildBehavioralLayer()` | Active mode, formality, depth, humor flag           | Only on meaningful emotional state change     | ~100 tokens, conditional |
| **L3** `buildLiveContext()`     | `<ctx t="..." d="..." m="..." s="..."/>`            | Prepended to every user turn                  | ~30 tokens/turn          |

**L2 Hysteresis (cost optimization):**
`shouldUpdateBehavioralLayer()` gates L2 resends with 3 checks:

1. Mode shift (calm → distressed): always send
2. Euclidean distance across 4 emotional dimensions > 0.25 threshold
3. Periodic refresh after 120s of stable state

**Effect:** In a typical 20-turn session, L2 fires ~4-6 times instead of 20 times.
**Saving:** ~14 × 100 tokens = **1,400 tokens saved per session** in stable conversations.

### 2.3 Barge-In Detection

**File:** `src/hooks/useInterruptionHandler.ts`

- A dedicated `AnalyserNode` monitors mic energy during AURA's playback (20Hz polling)
- Threshold: RMS > 0.015 sustained for > 150ms = confirmed barge-in
- On confirmation:
  1. `onDuck(100ms)` — fade out AURA's audio over 100ms
  2. `onFlush()` — discard queued audio chunks
  3. Sets `wasInterrupted = true` flag consumed by next `/api/analyze` call
- Prevents the user from being talked over; recovers gracefully without "sorry I was interrupted"

**Cost impact:** Interruption saves remaining audio tokens that would have played. Net positive on cost.

### 2.4 WebSocket Resilience & Reconnection

**File:** `src/hooks/gemini/useGeminiWebSocket.ts` (lines 368–403)

- **Exponential jittered backoff:** `[500, 1000, 2000, 4000, 8000]ms` base delays with ±20% jitter
- **Max 10 reconnection attempts** before surfacing a permanent error
- **State replay on reconnect** (lines 280–301):
  - Re-sends L1 system prompt
  - Re-sends last L2 behavioral layer
  - Injects last 2 conversation turns as context
  - If AURA was mid-utterance: sends `[System: Connection lost mid-utterance. Resume.]`

**Effect:** Users experience a seamless reconnection rather than a cold restart.

---

## 3. ALL PROCESSING: The 5-Brain Pipeline

### 3.1 Turn Completion → Transcript Published

**File:** `server.py` (lines 400–419) + `redis_bus.py`

When Gemini fires `inputTranscription`, the frontend calls `/api/analyze`.

**`server.py` /api/analyze — hot path:**

1. `apply_rate_limit()` — checks Redis sliding window (60 req/min/session)
2. Origin header validation (`is_allowed_origin()`) — blocks non-whitelisted callers
3. **Circuit breaker check** — if `degradation.level == VOICE_ONLY`, return immediately (0ms)
4. `publish_transcript()` — fire-and-forget XADD to Redis stream (`<1ms`)
5. `read_cached_analysis()` — check hot cache for previous turn's result (`<5ms`)
6. **Cache hit → return immediately** (server.py lines 431–446)

**On cache hit:** Total server response time = ~5-15ms.
**On cache cold (first turn):** Falls through to synchronous pipeline (~200-400ms).

**Files:** `server.py`, `redis_bus.py`, `rate_limiter.py`, `degradation.py`

---

### 3.2 Brain 3 Worker: Background Analysis

**File:** `behavior_engine_consumer.py`

Runs as a long-lived asyncio coroutine, consuming from Redis stream.

**Processing pipeline per turn (runs off hot path):**

#### Step 1: Keyword + Emotional Routing

**File:** `behavior_engine.py`

- Pattern matching against extracted behavioral data
- Scores 12+ emotional dimensions (frustration, withdrawal, joy, etc.)
- Selects behavioral act (`chat`, `support`, `redirect`, etc.)
- Selects language template
- **Cost:** Pure Python, 0 API calls, ~2-5ms

#### Step 2: Language Detection

**File:** `behavior_engine.py` → `detect_language_profile()`

- Detects Hindi/Hinglish/English mix ratio
- Counts Devanagari character ratio, Hinglish markers
- Returns `LanguageProfile` with mode + formality signals
- **Cost:** Pure Python, 0 API calls, <1ms

#### Step 3: Sensing Injection (StateVector)

**File:** `sensing_engine.py` + `behavior_engine.py` → `build_sensing_injection()`

- Updates the user's `StateVector`: energy, warmth, engagement, trust, tension, arc
- Computes `directive` (mode, injection_type, response_delay_hint)
- StateVector persisted async to Supabase `aura_storage` table (non-blocking)
- **Cost:** Pure Python + async Supabase write (fire-and-forget), <2ms

#### Step 4: Vocab Learning

**File:** `vocab_learner.py`

- Per-user `VocabLearner` instance cached in memory (`_vocab_cache`)
- Tracks language patterns, abuse vocabulary, formality drift over time
- Auto-saves to Redis + Supabase every N turns (fire-and-forget)
- Evicts stale entries every 50 messages
- **Cost:** Pure Python, async saves don't block turn processing

#### Step 4.5: Memory Retrieval (Moved off hot path)

**File:** `memory_sync.py` → `get_chromadb_enrichment_v2()` + `chroma_service.py` → `query_memories_v2()`

This was the biggest latency source. Now runs in the background worker.

**Embedding Cache Layer (cost optimization):**
**File:** `embedding_cache.py`

```python
# Cache key: MD5 of normalized (stripped + lowercased) text
key = f"aura:emb:{md5(text.strip().lower())}"
# TTL: 24 hours (embeddings don't change for same text + model)
await redis.set(key, json.dumps(embedding), ex=86400)
```

Flow:

1. Check Redis cache for MD5-hashed text → **cache hit: return in <1ms, $0 API cost**
2. Cache miss → call Gemini Embedding API (768-dim, `gemini-embedding-001`)
3. Store result in Redis with 24h TTL

**Expected hit rate:** 30-50% (users repeat themes, greetings, emotional phrases)
**Cost saving per hit:** Eliminates one Embedding API call (~$0.00001/call at scale = significant)
**Latency saving per hit:** 50-200ms avoided

**Hybrid Memory Retrieval v2:**
**File:** `chroma_service.py` → `query_memories_v2()`

RPC call to Supabase `match_memories_v2` function:

- Combines **semantic similarity** (pgvector cosine) + **temporal recency** (age decay)
- `final_score = similarity * (1 - recency_weight) + recency_score * recency_weight`
- `recency_weight = 0.15` (configurable via `MEMORY_RECENCY_WEIGHT` env var)
- Returns up to 3 memories with: text, similarity, recency_score, age_hours, recency_label
- Formatted with temporal labels: "Earlier today", "A few days ago", "A while back"
- **Timeout gate:** 500ms hard timeout; miss = fallback to frame_from_current_input()

**Free-tier gating (cost optimization):**
**File:** `memory_sync.py` → `store_and_backup_memory()`

```python
# Only embed + store emotionally significant moments
if state.energy < 0.3 and state.engagement < 0.3:
    return  # Skip — not worth storing or embedding
if state.arc_turns < 2:
    return  # Too early in arc
```

**Effect:** ~40-60% of turns never trigger an embedding call at all.

#### Step 4.6: Relationship Stage Tracking

**File:** `relationship_tracker.py`

- Tracks 5 stages: Stranger → Acquaintance → Familiar → Close → Intimate
- Based on session count + avg trust + days known (pure arithmetic, <1ms)
- Cached in Redis (24h TTL), durable in Supabase `aura_storage`
- Injects stage-appropriate behavioral directive into L3 context:
  ```
  rel="familiar" sessions="14" days="21" rel_hint="Comfortable and natural. Use callbacks."
  ```
- **Monotonically non-decreasing:** trust can dip but stage only goes forward
- **Cost:** Redis read/write only, 0 API calls

#### Step 5: Build Final Instructions

- Combines: sensing_injection + vocab_injection + memory_enrichment + relationship_injection
- Passes to `engine.build_instructions()` → behavioral directive string
- **Cost:** Pure Python, 0 API calls

#### Step 6: Write to Redis Hot Cache

**File:** `redis_bus.py` → `write_cached_analysis()`

```python
await client.set(key, json.dumps(analysis), ex=3600)  # 1-hour TTL
```

- Full `AnalyzeResponse`-equivalent dict written with 1h TTL
- Next turn's `/api/analyze` reads this in <5ms
- Includes: behavior_instructions, sensing_state, memory_enrichment, language_profile, relationship

---

### 3.3 Memory Consolidation Pipeline (Offline)

**Files:** `memory_consolidator.py`, `docs/scripts/run_consolidation.py`

Run daily via cron or manually:

- Fetches turn-level memories older than 7 days (`consolidated_at IS NULL`)
- Groups by session_id, requires ≥5 turns per episode
- Generates template-based extractive summary (300 chars max):
  - First turn snippet + peak tension moment + last turn snippet + duration/stats
- Embeds summary (one API call per episode, not per turn)
- Inserts consolidated row with `metadata.type='consolidated_episode'`
- Soft-deletes original turns (stamps `consolidated_at`), kept 30 days then purgeable

**Storage reduction:** 500 turns → ~30 episode rows = **~17x storage reduction**
**Retrieval improvement:** Consolidated memories are higher-signal (temporal summaries vs. raw fragments)
**Cost:** One embedding call per episode (~16 turns avg) vs. one per turn = ~16x embedding cost reduction

---

## 4. CIRCUIT BREAKERS & DEGRADATION

**File:** `degradation.py`

| Circuit         | Threshold  | Recovery | Protects                     |
| --------------- | ---------- | -------- | ---------------------------- |
| `redis`         | 3 failures | 15s      | Stream publish + cache reads |
| `supabase`      | 3 failures | 30s      | Memory storage + seed sync   |
| `worker`        | 5 failures | 45s      | Background analysis pipeline |
| `embedding_api` | 3 failures | 60s      | Gemini Embedding calls       |

**Degradation levels (fail-open):**

| Level        | What's broken          | AURA still does                                        |
| ------------ | ---------------------- | ------------------------------------------------------ |
| `FULL`       | Nothing                | Everything                                             |
| `NO_MEMORY`  | Supabase down          | Conversation + behavior steering, no memory enrichment |
| `NO_SENSING` | Redis/Worker down      | Raw Gemini conversation + system prompt                |
| `VOICE_ONLY` | Backend fully degraded | Gemini + L1 system prompt only                         |

**Key:** AURA never crashes. Every failure mode has a defined fallback. Users may get slightly less personalized responses, but conversation never stops.

---

## 5. RATE LIMITING

**Files:** `rate_limiter.py`, `server.py`

Redis-backed sliding window using sorted sets (ZADD + ZREMRANGEBYSCORE):

| Endpoint                 | Limit  | Window      |
| ------------------------ | ------ | ----------- |
| `POST /api/analyze`      | 60 req | 60s/session |
| `GET /api/proactive/:id` | 10 req | 60s/session |
| `POST /session/start`    | 5 req  | 60s/IP      |
| `POST /session/end`      | 5 req  | 60s/IP      |
| `GET /health`            | 30 req | 60s/IP      |

- Response headers include `X-RateLimit-Remaining`
- Fail-open: if Redis is down, rate limiting is skipped (never blocks legitimate traffic)
- OPTIONS (preflight) requests are exempt

**Pipeline optimization:** `rate_limiter.py` uses a single Redis pipeline for ZREMRANGEBYSCORE + ZADD + ZCARD + EXPIRE (4 commands, 1 round trip).

---

## 6. PROACTIVE ENGAGEMENT

**File:** `proactive_engine.py`

Frontend polls `/api/proactive/{session_id}` every 15s, but only when:

- User has been silent for > 30s
- AURA is not currently speaking

Three trigger types (priority order):

1. **EMOTIONAL_FOLLOWUP** (priority 2): High tension (>0.7) detected earlier, now calm (<0.4), 3+ turns later → gentle reference
2. **SILENCE_CHECKIN** (priority 1): User silent 45-180s → warm 1-sentence check-in
3. **RETURN_GREETING** (priority 3, one-shot): First session after >24h gap

**Rate limit:** Max 1 proactive action per 2 minutes per session.
**Cost:** One Redis read per poll (lightweight). Actual Gemini cost only if trigger fires and user hears a response.

---

## 7. COST ACCOUNTING

### Per-Turn Cost Breakdown (typical production turn)

| Operation                            | Cost                   | Frequency       | Notes                       |
| ------------------------------------ | ---------------------- | --------------- | --------------------------- |
| Gemini Live audio streaming          | ~$0.0018/min           | Every turn      | Billed by Render audio time |
| Gemini Flash response generation     | ~$0.0001-0.0003        | Every turn      | Token-based                 |
| L1 System Prompt                     | ~120 tokens            | Once/session    | Amortized                   |
| L2 Behavioral Layer                  | ~100 tokens            | ~4-6×/session   | Hysteresis gated            |
| L3 Live Context                      | ~30 tokens             | Every turn      | Tiny XML tag                |
| Embedding API (gemini-embedding-001) | $0.00001/call          | Cache miss only | 30-50% cache hit rate       |
| Supabase pgvector query              | $0 (free tier)         | Background only | Not on hot path             |
| Redis ops                            | ~$0/req (Upstash free) | Every turn      | Negligible                  |

### Cost Optimizations Implemented

| Optimization               | File                          | Saving                                                  |
| -------------------------- | ----------------------------- | ------------------------------------------------------- |
| Embedding cache (24h TTL)  | `embedding_cache.py`          | 30-50% fewer Embedding API calls                        |
| Free-tier memory gating    | `memory_sync.py`              | 40-60% of turns skip embedding entirely                 |
| L2 hysteresis              | `gemini-prompt.ts`            | ~70% fewer L2 resends                                   |
| Memory consolidation (17x) | `memory_consolidator.py`      | 17x reduction in stored embeddings                      |
| Background processing      | `behavior_engine_consumer.py` | Zero Gemini tokens for analysis (pure Python)           |
| Speculative pre-fetch      | `src/lib/behavior-client.ts`  | Eliminates one post-turn API call when speculative hits |
| Memory off hot path        | `server.py` → consumer        | Avoids redundant embedding on every sync request        |

---

## 8. RESPONSE HITTING THE USER

### 8.1 Adaptive Response Delay

**File:** `src/hooks/useResponseTiming.ts`

Before playing the first audio chunk:

- Reads `response_delay_hint` from `sensing_state` (set by consumer based on emotional arc)
- Distressed user: 0ms delay (immediate presence)
- Playful/casual: 100-300ms (natural conversational rhythm)
- Applied to first chunk only; subsequent chunks play immediately

### 8.2 Audio Scheduling

**File:** `src/hooks/gemini/useAudioPipeline.ts`

- Gemini streams audio as base64 PCM chunks
- Chunks are decoded and scheduled via `AudioContext.schedulePlayback()`
- First chunk: delayed by `delayOffset` (from sensing state)
- Subsequent chunks: queued and played back-to-back (no re-buffering)
- Volume loop runs at 60fps to feed the animated orb visualization

### 8.3 Context Budget Management

**File:** `src/lib/context-budget.ts`

Before every user turn send, the budget manager enforces:
| Budget Bucket | Limit |
|--------------|-------|
| System Prompt (L1) | 500 tokens |
| Behavioral Layer (L2) | 300 tokens |
| Live Context (L3) | 100 tokens |
| Memory Enrichment | 400 tokens |
| Behavior Injection | 200 tokens |
| Conversation History | 2,500 tokens |
| Safety Margin | 500 tokens |
| **Total** | **~4,500 tokens** |

- History truncation: keeps first turn (context anchor) + most recent turns, drops middle with a `[N turns omitted]` marker
- Memory truncation: greedy fill by final_score order until 400-token budget exhausted
- **Cost effect:** Prevents token creep over long sessions. Without this, a 60-turn session could balloon to 12,000+ tokens.

### 8.4 Turn Complete & Cleanup

**File:** `src/hooks/useGeminiLive.ts` (lines 420–427)

On `turnComplete`:

- `responseDelayAppliedRef.current = false` (reset for next turn)
- `currentResponseTextRef.current = ""` (clear partial text buffer)
- `recordTimingTurn()` (update response timing model)
- Every 5 turns: injects a `[THREAD]` callback referencing the first session highlight

---

## 9. STRUCTURED LOGGING & OBSERVABILITY

**File:** `logging_config.py`

All backend modules use `structlog` with JSON rendering in production:

```python
log.info("analyze_request",
    session_id=body.session_id,
    cache_hit=True,
    degradation_level="full",
    duration_ms=12.4,
    has_memories=True
)
```

Key log events:
| Event | File | Fields |
|-------|------|--------|
| `analyze_request` | `server.py` | session_id, cache_hit, duration_ms, degradation_level |
| `message_consumed` | `consumer.py` | session_id, user_id, turn_index, processing_ms, arc, mode |
| `memory_stored` | `memory_sync.py` | user_id, embedding_ms, insert_ms |
| `consumer_lag` | `consumer.py` | lag_count, processed, severity |
| `health_check` | `server.py` | status, degradation_level |
| `cache_write` | `redis_bus.py` | session_id, ttl |

Privacy constraint: full `user_text` is **never logged**. Only length/presence flags.

---

## 10. HEALTH ENDPOINT

**File:** `server.py` → `GET /health`

Returns structured health for all subsystems (each with independent timeout):

```json
{
  "status": "healthy|degraded|critical",
  "version": "4.1",
  "degradation_level": "full",
  "circuits": {
    "redis": {"state": "closed", "failure_count": 0, "total_trips": 0},
    "supabase": {"state": "closed", ...},
    "embedding_api": {"state": "closed", ...}
  },
  "checks": {
    "redis": {"ok": true, "latency_ms": 1.2},
    "consumer": {"ok": true, "last_heartbeat_seconds_ago": 3.1, "lag": 0},
    "supabase": {"ok": true, "latency_ms": 45.3}
  },
  "embedding_cache": {"hits": 142, "misses": 89, "hit_rate": "61.5%"}
}
```

Consumer heartbeat: the worker writes `aura:consumer:heartbeat` with a 30s TTL after every processed message. If the key is absent, the consumer has been dead for >30s.

---

## 11. FULL DATA FLOW SUMMARY

```
[User speaks]
      │
      ▼
[Gemini Live VAD] ──────────────────────────────────────────────────────────────►
      │ inputTranscription fires                                          [Audio Chunks]
      ▼                                                                        │
[Frontend: handleUserTurn()]                                                   │
  • addTurn() to transcript                                              [schedulePlayback()]
  • fireSpeculative() → /api/analyze (300ms timeout, pre-fetch)               │
  • buildContext() → L3 ctx tag                                               │
  • sendClientContent() → Gemini (L2 if changed)                              ▼
      │                                                               [User hears AURA]
      ▼ (100ms delay for injection to settle)
[POST /api/analyze]  ◄──────────────── Origin check + Rate limit
      │
      ├── Circuit OPEN? → return VOICE_ONLY stub (0ms)
      │
      ├── Redis cache hit? → return cached result (5-15ms) ────────────────────►
      │
      └── Cache cold? → Sync fallback pipeline (200-400ms):
            ├── engine.analyze() [pure Python]
            ├── detect_language_profile()
            ├── build_sensing_injection() → StateVector
            ├── get_chromadb_enrichment() [embedding cache → pgvector, 0.4s timeout]
            ├── store_and_backup_memory() [async, non-blocking]
            └── return AnalyzeResponse ────────────────────────────────────────►

[Redis Stream: aura:transcripts]  ◄── publish_transcript() (fire-and-forget, <1ms)
      │
      ▼
[Brain 3 Consumer: behavior_engine_consumer.py]  (runs in background)
      ├── engine.analyze()
      ├── detect_language_profile()
      ├── build_sensing_injection() → persist StateVector
      ├── VocabLearner.ingest_turn() → auto-save
      ├── get_chromadb_enrichment_v2():
      │     ├── EmbeddingCache.get_embedding() → [Redis hit: <1ms] or [Gemini API: 50-200ms]
      │     └── match_memories_v2 RPC → Supabase pgvector (similarity + recency)
      ├── RelationshipTracker.update_trust() → Redis + Supabase
      └── write_cached_analysis() → Redis (aura:analysis:{session_id}, TTL 1h)
            │
            └── Read by server.py on NEXT turn → <5ms cache hit
```

---

## 12. KEY FILES REFERENCE

| File                                     | Role                                                 | Cost Impact                                         |
| ---------------------------------------- | ---------------------------------------------------- | --------------------------------------------------- |
| `server.py`                              | API gateway, rate limiting, circuit wrapping         | High — orchestrates all calls                       |
| `behavior_engine_consumer.py`            | Brain 3 async worker                                 | Medium — does the heavy lifting off-path            |
| `redis_bus.py`                           | Stream + cache layer (pipelined)                     | Low — Redis ops are cheap                           |
| `embedding_cache.py`                     | 24h Redis cache for 768-dim embeddings               | **High saving** — 30-50% API call reduction         |
| `chroma_service.py`                      | Hybrid pgvector retrieval (similarity + recency)     | Medium — one query per turn, off hot path           |
| `memory_sync.py`                         | Supabase write-path, gated by energy/arc thresholds  | **High saving** — 40-60% of turns skipped           |
| `memory_consolidator.py`                 | Offline 17x compression of turn memories             | **High saving** — 17x storage + embedding reduction |
| `degradation.py`                         | Circuit breakers for Redis/Supabase/Worker/Embedding | Resilience — prevents cascading failures            |
| `rate_limiter.py`                        | Redis sliding window, pipelined 4-command batch      | Protection — no cost impact on legitimate traffic   |
| `proactive_engine.py`                    | Unprompted engagement triggers                       | Low — Redis reads only until trigger fires          |
| `relationship_tracker.py`                | 5-stage user familiarity model                       | Negligible — Redis + Supabase, pure arithmetic      |
| `logging_config.py`                      | structlog JSON renderer                              | Zero cost                                           |
| `src/lib/gemini-prompt.ts`               | L1/L2/L3 layered prompting + hysteresis              | **High saving** — 70% fewer L2 resends              |
| `src/lib/context-budget.ts`              | Token budget enforcement (4,500 token cap)           | **High saving** — prevents unbounded token growth   |
| `src/lib/behavior-client.ts`             | Speculative pre-fetch + hit-rate tracking            | Latency saving — eliminates one post-turn call      |
| `src/hooks/useInterruptionHandler.ts`    | Barge-in detection + audio ducking                   | Quality + cost (stops wasted audio generation)      |
| `src/hooks/gemini/useGeminiWebSocket.ts` | WebSocket lifecycle, cascade, state replay           | Reliability — seamless reconnects                   |

---
