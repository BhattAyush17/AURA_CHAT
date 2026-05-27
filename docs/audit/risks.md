# AURA System Risks

> **Audit Status:** Updated 2026-05-27. All CRITICAL and HIGH risks have been addressed. See `fixes_recommended.md` for implementation details.

## Phase B: Core Backend API & Event Bus
- ~~**[CRITICAL] Cache Desynchronization Risk**: The `/api/analyze` endpoint immediately returns the *cached* analysis (from the previous turn) while publishing the *current* turn to the worker. If the frontend is not aware of this 1-turn lag, emotional instructions and memory enrichment will mismatch the current conversational context.~~ ✅ **Resolved**: `handleUserTurn` now awaits the current turn's analysis before transmitting to Gemini Live.
- ~~**[HIGH] Logic Drift**: The backend implements the NLP/Embedding pipeline twice: once synchronously in `main.py` (fallback) and once asynchronously in `consumer.py`. This violates DRY and risks silent drift if one path is updated and the other is missed.~~ ✅ **Resolved**: Both paths now call `backend/core/pipeline.py → run_turn_pipeline()`.

## Phase C/D: AI Orchestration Pipeline
- ~~**[CRITICAL] Permanent 1-Turn Context Lag**: Confirmed via code inspection. The `/api/analyze` request returns the cache *before* the background worker finishes the current turn. The frontend `useLive.ts` injects this stale behavioral instruction and memory into the Gemini LLM.~~ ✅ **Resolved**: `handleUserTurn` is now async and awaits `analyzeForTurn()` completion before sending payload.
- ~~**[CRITICAL] Pre-mature Turn Completion**: `useLive.ts` forces a `turnComplete: true` WebSocket message 100ms after receiving an `inputTranscription`. If Gemini sends intermediate transcriptions, this violently interrupts the user and fragments the conversation.~~ ✅ **Resolved**: `turnComplete` forced flag removed; now set to `false` and deferred to Gemini Live's native VAD.
- ~~**[HIGH] Dual Prompt Injection Race**: `behavior.applyBehavioralInjection` and the atomic send in `handleUserTurn` both emit `sendClientContent` to the WebSocket simultaneously without a guaranteed sequencing lock, risking malformed LLM context windows.~~ ✅ **Resolved**: Both payloads merged into a single synchronous `sendClientContent` call.

## Phase E: Test Strategy Discipline
- **[HIGH] Blind Spots in Orchestration**: Complex race conditions and state desynchronizations (like the 1-turn lag) exist in production but remain completely untested. Custom scripts validate pure functions (like memory size caps) but fail to validate the distributed multi-tier orchestration.
- **[HIGH] Missing Stress Coverage**: The fail-open degradation circuits and Redis async workers have never been load-tested against artificial lag or cache thrashing.

## Subsystem 3: Emotional Routing Layer
- ~~**[CRITICAL] Global State Cross-Contamination**: `RuntimeEngine.turn_history` is stateful. If instantiated as a singleton, concurrent users will corrupt each other's emotional routing context.~~ ✅ **Resolved**: `turn_history` is now passed explicitly per-request from `SessionStore`.
- ~~**[CRITICAL] Unbounded Memory Leak**: `_sensing_engines` in `behavior.py` has no eviction logic. It will grow infinitely as new `session_id`s are generated, guaranteeing an eventual Out-of-Memory (OOM) crash in production.~~ ✅ **Resolved**: `OrderedDict` LRU with `_SENSING_ENGINE_MAX = 500` cap implemented.
- **[LOW] Non-Distributed State**: In-memory `_sensing_engines` prevent true horizontal scaling. A user's turns routed to different worker nodes will result in reset emotional states. *(Acceptable for single-worker deployments; tracked for P4 scale phase)*

## Phase G / Subsystem 4: Memory & Retrieval Layer
- ~~**[CRITICAL] Embedding Space Collapse**: `embedding_cache.py` keys cache by text hash only. If a fallback occurs, a mix of Gemini and Cohere vectors will be ingested into the DB, permanently ruining similarity search for those sessions.~~ ✅ **Resolved**: Cache key now includes provider name: `aura:emb:{provider}:{hash}`.
- ~~**[HIGH] Supabase Threading Spikes**: `asyncio.to_thread` calls to the synchronous Supabase client can easily exhaust the ASGI thread pool under high concurrent load, slowing down the entire `/api/analyze` sync path.~~ ✅ **Resolved**: All Supabase calls migrated to native `AsyncClient` awaits.

## Subsystems 5 & 6: Degradation & Frontend
- ~~**[HIGH] Zombie Threads (Degradation)**: Circuit Breaker timeouts cancel the async awaitable, but leave synchronous DB threads running in the background, accelerating thread starvation.~~ ✅ **Resolved**: No more `asyncio.to_thread` wrappers on Supabase calls — native async eliminates zombie thread risk.
- ~~**[CRITICAL] Stale Instruction Injection (Frontend)**: The UI injects behavioral context that is permanently one turn behind the actual conversation state.~~ ✅ **Resolved**: Frontend now sends atomic single-turn payloads after awaiting current analysis.
