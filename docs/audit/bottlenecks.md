# AURA System Bottlenecks

> **Audit Status:** Updated 2026-05-27. All critical and high-impact bottlenecks have been addressed.

## Phase B: Core Backend API & Event Bus
- ~~**`_vocab_cache` Memory Scaling**: In `consumer.py`, the `_vocab_cache` keeps a full `VocabLearner` object instantiated in memory per user for 30 minutes. If AURA experiences a spike in unique users, this could rapidly consume memory on constrained environments (e.g. Render free tier), leading to OOM kills before the eviction loop fires.~~ ✅ **Resolved**: Added `_VOCAB_CACHE_MAX = 200` hard cap with LRU eviction via dict pop/re-insert in `consumer.py`. Both size and TTL-based eviction are now active.
- ~~**Synchronous `/chat` Path**: If the system degrades and falls back to the `/chat` endpoint or the synchronous path in `/api/analyze`, the 300ms-800ms blocking operations (Sensing L1 + Memory Retrieval L3) will consume ASGI worker threads, potentially starving the Uvicorn server under high load.~~ ✅ **Resolved**: Supabase calls replaced with native async `AsyncClient`. Memory retrieval uses `asyncio.wait_for` with a 0.4s timeout on the sync fallback path.

## Phase C/D: AI Orchestration Pipeline
- ~~**Speculative Fetch Thrashing**: In `useLive.ts`, `onInputTranscription` unconditionally triggers `behavior.fireSpeculative`. Although debounced at 500ms in `shouldSpeculate`, frequent transcription updates on long user monologues will bombard the `/api/analyze` endpoint.~~ ℹ️ **Partially mitigated**: `AbortController` cancels the previous speculative fetch when a new one fires. Noted for future debounce tuning.
- ~~**Redundant Processing**: Both the speculative and real `/api/analyze` requests publish the transcript to the Redis stream. The backend worker processes the *same turn* multiple times, unnecessarily burning CPU and embedding API tokens.~~ ℹ️ **Acceptable**: Cache hits on Redis avoid reprocessing in the common case. Full deduplication deferred to P4.

## Subsystem 3: Emotional Routing Layer
- ~~**Horizontal Scaling Bottleneck**: The `_sensing_engines` dict in `behavior.py` forces sticky-session routing (if running multiple workers) or limits the backend to a single `uvicorn` worker. Scaling horizontally will break the emotional state tracking unless it is moved to Redis.~~ ⏸ **Deferred to P4**: Single-worker deployment is the current target. In-process LRU cap (`_SENSING_ENGINE_MAX = 500`) prevents OOM. Redis-backed state is tracked in `prioritized_fixes.md` as P4 #18.

## Phase G / Subsystem 4: Memory & Retrieval Layer
- ~~**Synchronous Database Threading**: `sync.py` uses `asyncio.to_thread` for all Supabase DB calls. A slow database or a spike in concurrent users can easily exhaust the default ASGI thread pool, causing a severe bottleneck across the entire backend.~~ ✅ **Resolved**: Full migration to `supabase._async.client.AsyncClient`. No `asyncio.to_thread` wrappers remain on any Supabase operations.
