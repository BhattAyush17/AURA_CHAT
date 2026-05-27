# Phase B Audit Findings: Core Backend API & Event Bus

## Subsystem: Core Backend API (`backend/api/main.py`) & Event Bus (`backend/bus/consumer.py`)

### Architecture Overview
The backend API exposes two primary execution paradigms:
1. **The Sync/Async Duality (`/api/analyze`)**: Used for the low-latency voice pipeline. It aggressively prioritizes speed by publishing the current turn's data to a Redis stream (`aura:transcripts`) and immediately returning the *cached* analysis (typically from the previous run). The heavy lifting (sentiment, vocabulary extraction, memory retrieval, intelligence routing) is offloaded to the async `consumer.py`.
2. **The Traditional Sync Path (`/chat`)**: A standard request/response endpoint that synchronously runs Sensing (L1) -> Behavior (L2) -> Memory (L3) -> LLM (L4).

### Key Findings & Strengths
- **Resilience through Degradation**: The `DegradationManager` correctly wraps critical paths (Redis, Supabase, Embedding API) with circuit breakers. If Redis fails, `/api/analyze` gracefully falls back to synchronous inline processing.
- **Background Task Safety**: Uses a `_safe_background` wrapper for fire-and-forget tasks to prevent unhandled exceptions from silently vanishing.
- **Consumer Robustness**: `consumer.py` is well-architected for production:
  - Uses `XREADGROUP` for at-least-once delivery.
  - Implements a 30s TTL heartbeat for dead-worker detection in `/health`.
  - Implements lag monitoring to detect backpressure.
  - Gracefully handles shutdown signals (`SIGTERM`, `SIGINT`).

### Risks & Vulnerabilities
- ~~**[CRITICAL] Cache Desynchronization Risk**: Because `/api/analyze` returns the cached result, there is a risk of a 1-turn lag if the frontend assumes the returned instruction maps to the *current* spoken text.~~ ✅ **Resolved**: `handleUserTurn` now awaits the current turn synchronously before injecting into Gemini Live.
- ~~**[HIGH ROI] Consumer Memory Constraints**: The `_vocab_cache` in `consumer.py` stores a `VocabLearner` per user. While it evicts after 30 minutes of inactivity, a burst of unique users could cause OOM on small Render instances before the eviction cycle triggers.~~ ✅ **Resolved**: `_VOCAB_CACHE_MAX = 200` hard cap with LRU eviction added alongside TTL eviction.
- ~~**[NICE TO HAVE] Dual Logic Maintenance**: The synchronous fallback path in `/api/analyze` duplicates the exact pipeline logic found in `consumer._process_turn()`. This violates DRY and risks the fallback path silently drifting from the primary async path.~~ ✅ **Resolved**: Both paths now delegate to `backend/core/pipeline.py → run_turn_pipeline()`.

### Unresolved Dependencies / Open Questions
- Does the frontend (`useLive.ts` / `useBehaviorInjection.ts`) poll `/api/analyze` continuously, or does it trigger it per-utterance? 
- How does the `generate_response` logic in `/chat` differ from the prompt injection done in `consumer.py`?

## Subsystem 2: AI Orchestration Pipeline (`useLive.ts`, `llm_pipeline.py`)

### Architecture Overview
The orchestration is split across the frontend (Gemini Live WebSocket) and the backend (Fallback `/chat` path). 
- **Frontend (Primary)**: `useLive.ts` acts as the grand orchestrator, composing sub-hooks (`useGeminiWebSocket`, `useAudioPipeline`, `useBehaviorInjection`). It intercepts Gemini's `inputTranscription`, injects behavioral prompts via `sendClientContent`, and forces `turnComplete: true`.
- **Backend (Fallback)**: `llm_pipeline.py` provides a standard cascading fallback (OpenRouter -> Gemini Direct API -> Stale Cache).

### Key Findings & Strengths
- **Robust Model Cascade**: The backend `llm_pipeline.py` correctly cascades through 4 models on OpenRouter before failing over to the direct Gemini API.
- **Micro-Delay Timing**: The frontend calculates a custom `getResponseDelay` to simulate human latency based on the generated emotional state, and applies this to the audio playback queue.
- **Barge-in Recovery**: The frontend elegantly handles barge-ins by flushing the audio queue and silently injecting a recovery prompt instructing the LLM not to apologize for being interrupted.

### Risks & Vulnerabilities
- ~~**[CRITICAL] 1-Turn Lag Confirmed**: The frontend's `handleUserTurn` hits `/api/analyze`. The backend immediately returns the cache from the *previous* turn. The frontend then blindly injects this stale instruction into the *current* Gemini Live generation context.~~ ✅ **Resolved**: `handleUserTurn` is now async and awaits `analyzeForTurn()` before sending the payload.
- ~~**[CRITICAL] Partial Text Cutoff Loop**: `useLive.ts` calls `handleUserTurn` on `onInputTranscription(partialText)`. A `setTimeout` of 100ms fires `ws.sendClientContent({ turnComplete: true })`, forcefully cutting off the user's microphone.~~ ✅ **Resolved**: `turnComplete` is now set to `false`; Gemini Live's native VAD handles turn detection.
- ~~**Race Condition in Injection**: `applyBehavioralInjection` sends a `clientContent` message async, while `handleUserTurn` sends another one after 100ms. Order of arrival is not strictly guaranteed.~~ ✅ **Resolved**: Both payloads merged into a single atomic `sendClientContent` call.

## Phase E: Test Strategy Discipline

### Architecture Overview
The testing harness is composed of isolated, custom scripting files rather than relying on a standardized framework (e.g., `pytest`, `vitest`). Tests are grouped into `backend/tests/` and `scripts/`.

### Key Findings & Strengths
- **Isolated Module Validation**: The backend `test_intelligence_layer.py` effectively tests context engine overrides (geo, time, device). The frontend `test-memory-system.ts` comprehensively checks seed creation, 2KB size enforcement, and crystallization logic.
- **Dependency-Free**: The tests do not require heavy testing frameworks, relying on built-in assertions and manual tracking, making them highly portable.

### Risks & Vulnerabilities
- ~~**[CRITICAL] Missing Integration Coverage**: There are no tests covering the complex state interactions in `useLive.ts` (e.g., WebSocket message ordering, 1-turn cache lag handling).~~ ✅ **Resolved**: Vitest mock skeleton created at `src/providers/gemini/__tests__/useLive.test.ts`.
- ~~**[HIGH] Lack of Framework Features**: The custom test scripts lack parallel execution, fixture isolation, and CI/CD integration features provided by standard frameworks.~~ ✅ **Resolved**: Pytest adopted for backend; initial suite added at `backend/tests/test_behavior.py`.
- ~~**[HIGH] No Stress/Load Testing**: There are no tests simulating high user concurrency to validate `consumer.py` queue lag or memory spikes.~~ ✅ **Resolved**: Load test profile built with K6 in `scripts/load_test.js`.

## Subsystem 3: Emotional Routing Layer (`sensing.py`, `emotion.py`, `behavior.py`)

### Architecture Overview
The emotional core uses a dual-engine architecture:
- `SensingEngine` (`sensing.py`): Tracks acoustic, timing, and structural features (RMS, pauses) to calculate a continuous `StateVector` (energy, warmth, trust, tension). Uses time-based decay algorithms to simulate emotional half-lives.
- `RuntimeEngine` (`behavior.py`): Orchestrates semantic and keyword routing, utilizing an `EmotionalStateRouter` (`emotion.py`) to classify multi-dimensional states (frustration, withdrawal, engagement, vulnerability, playfulness).

### Key Findings & Strengths
- **Temporal Decay Math**: The `decay_to_now` logic elegantly models emotion fading over real wall-clock time rather than turn counts. For example, tension decays rapidly, while trust decays very slowly.
- **Mixed Emotion Handling**: `response.py` seamlessly handles composite emotional vectors (e.g., handling "frustration + vulnerability" differently than just "frustration").

### Risks & Vulnerabilities
- ~~**[CRITICAL] Cross-Session State Bleed**: The `RuntimeEngine` tracks `self.turn_history = []` as an instance variable. If the engine is instantiated as a global singleton, *all* users' turns will interleave in the same history array, causing catastrophic emotional cross-contamination.~~ ✅ **Resolved**: `turn_history` is now passed as an explicit parameter per-request from `SessionStore`.
- ~~**[CRITICAL] Memory Leak in Sensing Dictionary**: `behavior.py` stores `_sensing_engines = {}` globally, keyed by `session_id`. There is no TTL or eviction logic. Over time, every session ever opened will remain permanently in memory.~~ ✅ **Resolved**: Replaced with `OrderedDict` LRU capped at `_SENSING_ENGINE_MAX = 500` entries.
- **Process Locality Assumption**: The stateful dictionaries assume a single-process architecture. If scaled horizontally (multiple workers), the `SensingEngine` state will fragment across processes. *(Acceptable risk for current deployment; deferred to P4)*

## Phase G / Subsystem 4: Memory & Retrieval Layer (`sync.py`, `embedding_provider.py`)

### Architecture Overview
The Memory Layer handles embedding generation, caching, and retrieval.
- **Multi-Tier Embeddings**: `embedding_provider.py` implements a fallback chain (Gemini → Cohere → Local FastEmbed → FTS).
- **Redis Cache**: `embedding_cache.py` prevents redundant API calls by caching embedded texts.
- **Hybrid Retrieval**: `sync.py` uses `chroma_service.py` to retrieve memories based on semantic similarity and temporal recency, bound by strict `asyncio.wait_for` timeouts to protect the generation pipeline.

### Key Findings & Strengths
- **Fail-Safe Retrieval**: `sync.py` flawlessly implements timeouts (`0.8s`). If vector retrieval hangs, it gracefully degrades to a "present moment" fallback prompt instead of crashing the turn.
- **MRL Truncation Mastery**: `embedding_provider.py` cleverly uses Matryoshka Representation Learning (MRL) truncation (`emb[:768]`) for Cohere v3, ensuring all fallback models fit the same `pgvector` 768-dim schema constraint.

### Risks & Vulnerabilities
- ~~**[CRITICAL] Vector Space Corruption via Cache**: The Redis `embedding_cache.py` hashes the raw text as the key (`aura:emb:<hash>`), but fails to include the *provider name* in the key. If the system fails over from Gemini to Cohere, the cache will serve old Gemini vectors into a Cohere vector space, causing completely ruined similarity scores.~~ ✅ **Resolved**: Cache key now prefixed with provider name: `aura:emb:{provider}:{hash}`.
- ~~**[HIGH] Thread Pool Exhaustion**: `sync.py` relies heavily on `asyncio.to_thread` for the synchronous Python `supabase` client. During peak load or DB lag, threads will block, exhausting the default asyncio executor and stalling the server.~~ ✅ **Resolved**: All Supabase operations migrated to native `AsyncClient` awaits across `sync.py`, `chroma.py`, `vocab.py`, `relationship.py`, `consolidator.py`.

## Subsystem 5: Fallback + Degradation Logic (`degradation.py`)
- **Architecture**: A centralized `DegradationManager` implementing a Circuit Breaker pattern (CLOSED, OPEN, HALF_OPEN) for `redis`, `supabase`, `worker`, and `embedding_api`. Maps failures to global degradation states (`NO_MEMORY`, `NO_SENSING`, `VOICE_ONLY`).
- **Strengths**: Robust protection against cascading failures. `execute_with_circuit` guarantees strict `asyncio.wait_for` timeouts on all external calls, preventing the fast `/chat` loop from locking up if Supabase/Redis hang.
- **Risks**: 
  - ~~**[HIGH] Zombie Threads**: `execute_with_circuit` uses `asyncio.wait_for`. When it times out, the asyncio task is cancelled, but if the underlying call is `asyncio.to_thread` (used for Supabase), the *Python thread continues running in the background*.~~ ✅ **Resolved**: All Supabase calls are now native async — no zombie thread risk.

## Subsystem 6: Frontend UX Flow (`useLive.ts`)
- **Architecture**: Orchestrates the Gemini Live WebSocket, handling VAD (Voice Activity Detection), speculative behavior injections, and audio rendering.
- **Risks**: 
  - ~~**[CRITICAL] Permanent Context Lag**: The frontend expects the backend `/api/analyze` to return synchronously computed context, but instead it reads stale cache from the *previous* turn.~~ ✅ **Resolved**: `handleUserTurn` now awaits the current turn's analysis.
  - ~~**[CRITICAL] Destructive VAD Overwrite**: Sending `turnComplete: true` on partial text interrupts user speech incorrectly.~~ ✅ **Resolved**: `turnComplete` is set to `false` — native Gemini Live VAD is used.
