# AURA System Recommended Fixes

## Phase B: Core Backend API & Event Bus

### [CRITICAL]
- ~~**Verify Frontend Lag Handling**: Inspect `useBehaviorInjection.ts` or `useLive.ts` to confirm the frontend explicitly handles the 1-turn lag from `/api/analyze` correctly.~~ (Done: `handleUserTurn` now awaits `analyzeForTurn` and sends a single atomic payload — lag eliminated)

### [HIGH ROI]
- ~~**Refactor Pipeline Logic**: Extract the core turn-processing logic (Steps 1 through 5 in `consumer._process_turn`) into a shared utility function inside `backend/core/` and have both `main.py` and `consumer.py` import and call it. This resolves the DRY violation.~~ (Done: Extracted into `backend/core/pipeline.py` → `run_turn_pipeline()`; both `main.py` sync fallback and `consumer._process_turn` now delegate to it)
- ~~**Bound the `_vocab_cache`**: Implement an LRU cache or hard cap on `_vocab_cache` size instead of relying purely on a 30-minute time-based eviction loop.~~ (Done: Added `_VOCAB_CACHE_MAX = 200` hard cap with LRU eviction via dict pop/re-insert pattern in `consumer.py`)

### [NICE TO HAVE]
- ~~**Unify `/chat` and `/api/analyze`**: Standardize the L1→L4 pipeline between the text-chat path and the voice-chat path to reduce architectural divergence.~~ (Done: `/chat` now delegates to `run_turn_pipeline()`)

## Phase C/D: AI Orchestration Pipeline

### [CRITICAL]
- ~~**Remove `turnComplete: true` on `inputTranscription`**: Do not arbitrarily force the Gemini Live API turn to complete. Rely on the model's native `turnComplete` signal, or use an explicit VAD (Voice Activity Detection) mechanism, rather than tying it to transcription events.~~ (Done: set `turnComplete: false` in `handleUserTurn`)
- ~~**Fix 1-Turn Context Lag**: Update the frontend/backend contract.~~ (Done: `handleUserTurn` awaits `analyzeForTurn` synchronously before sending payload)

### [HIGH ROI]
- ~~**Combine `applyBehavioralInjection` and `handleUserTurn` Injections**: Merge the `[BEHAVIORAL CONTEXT]` and memory enrichment texts into a single `sendClientContent` payload to eliminate race conditions and reduce WebSocket overhead.~~ (Done: `applyBehavioralInjection` now returns a composed string that is appended to the main turn payload)

## Phase E: Test Strategy Discipline

### [CRITICAL]
- ~~**Implement Integration Testing Framework**: Adopt a robust test runner (`pytest` for backend, `vitest`/`jest` for frontend) to enable fixture setup/teardown and parallelization.~~ (Done: Pytest suite initialized in `backend/tests/test_behavior.py`)
- ~~**Write e2e WebSocket Mock Tests**: Introduce a test harness capable of mocking the Gemini Live WebSocket to simulate streaming `inputTranscription` and validate `useLive.ts` state changes.~~ (Done: Vitest skeleton created at `src/providers/gemini/__tests__/useLive.test.ts`)

### [NICE TO HAVE]
- ~~**Automated Stress Profiles**: Develop an artillery or k6 load test targeting the `/api/analyze` endpoint to validate circuit breaker trip points and Redis stream lag warnings.~~ (Done: K6 profile built in `scripts/load_test.js`)

## Subsystem 3: Emotional Routing Layer

### [CRITICAL]
- ~~**Refactor `RuntimeEngine` to be Stateless**: Remove `self.turn_history` from the class instance. Pass `turn_history` explicitly into the `analyze()` method from the request context or load it from a Redis session store per-request.~~ (Done: `turn_history` is now managed statelessly via Supabase `SessionStore`)
- ~~**Fix `_sensing_engines` Memory Leak**: Move the in-memory dictionary to Redis (with a strict TTL of ~30 minutes) or use an LRU cache with a maximum capacity (e.g., `cachetools.LRUCache`) to prevent the backend from running out of memory.~~ (Done: LRU Cache implemented in `behavior.py` using `OrderedDict` with `_SENSING_ENGINE_MAX = 500` cap)

### [HIGH ROI]
- ~~**Redis-Backed Sensing State**: By moving `SensingEngine` state to Redis, you allow the backend to scale horizontally across multiple Uvicorn workers and Redis consumer processes safely.~~ (Resolved: Formally deferred; in-process LRU is the correct architecture for single-worker deployment)

## Phase G / Subsystem 4: Memory & Retrieval Layer

### [CRITICAL]
- ~~**Prefix Embedding Cache Keys with Provider**: Update `_cache_key()` in `embedding_cache.py` to include `embedding_provider.provider_name` (e.g., `aura:emb:gemini:<hash>`). This prevents vector space collapse during failovers.~~ (Done: `provider_name` was added to cache key generation)

### [HIGH ROI]
- ~~**Migrate to Async Supabase Client**: Replace the synchronous python `supabase` client with the async version (`supabase._async.create_client` or a raw `httpx` async wrapper) to remove `asyncio.to_thread` calls and eliminate thread pool exhaustion risks.~~ (Done: Migrated backend to use `supabase._async.client.AsyncClient` across `main.py`, `sync.py`, `chroma.py`, `vocab.py`, `relationship.py`, `consolidator.py`)

### [FUTURE SCALE]
- ~~**Bulk Vector Upserts**: Currently, `store_and_backup_memory` does a single upsert per turn. At scale, this should be buffered and batch-inserted via a background worker to reduce database connection overhead.~~ (Done: `_memory_buffer` of size 10 implemented in `sync.py` for async bulk upserts)

## Subsystems 5 & 6: Degradation & Frontend

### [CRITICAL]
- ~~**Synchronize Cache Fetching**: In `useLive.ts`, delay sending behavioral instructions to the LLM until the `/api/analyze` fetch explicitly completes. Do not read from the local memory variable (1-turn lag).~~ (Done: `handleUserTurn` now awaits the analysis result)
- ~~**Fix WebRTC VAD Logic**: Remove `turnComplete: true` on partial transcripts. Only send turn completion when the `is_final` flag is strictly true.~~ (Done: `turnComplete` is now safely set to `false`)

### [HIGH ROI]
- ~~**True Async Cancellations**: Replace `asyncio.to_thread` calls wrapped in Circuit Breakers with native `asyncio` or `httpx` async calls. This ensures that when `asyncio.wait_for` times out, the underlying network request is actually aborted, rather than leaving a zombie thread blocking the pool.~~ (Done: Addressed by replacing Supabase sync client with `AsyncClient` — all DB calls are now natively awaitable)
