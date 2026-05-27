# Audit Working State: Context Compression

## [Phase A - Project Mapping]
- **Architecture Summary:** React/Vite frontend orchestrated via `ConnectionProvider` targeting a FastAPI backend. Extreme focus on resilience via circuit breakers, multi-tier embedding fallbacks (Gemini->Cohere->FastEmbed->FTS), LLM fallbacks, and Voice provider fallbacks (Sarvam->WebSpeech). Data sits in Postgres (Supabase) + Redis. Memory logic is abstracted via a gateway to support local and cloud storage seamlessly.
- **Strengths:** Highly resilient design with explicit degradation paths. Clear separation between L1 (Sensing), L2 (Behavior), L3 (Memory), and L4 (LLM). Comprehensive fallback mechanisms.
- **Weaknesses:** High complexity in the orchestration layer (both frontend connection state and backend async/sync paths). Heavy reliance on global singletons and Redis connectivity for optimal performance.
- **Risks:** Potential race conditions in the async Redis worker path vs synchronous fallback path in `/api/analyze`. State synchronization issues between local memory and Supabase.
- **Recommended Next Audit Target:** Core backend API & Event Bus (`/api/analyze` sync/async duality and Redis `consumer.py`).

## [Phase B - Core Backend API & Event Bus]
- **Architecture Summary:** API relies on a dual-path system. Fast-path (`/api/analyze`) publishes to Redis stream and returns a hot-cached result (often 1 turn behind) for <50ms latency. Worker (`consumer.py`) processes the stream async, running the heavy NLP/embedding pipeline. Fallback path (`/chat`) runs synchronously for traditional text chat.
- **Strengths:** Excellent fail-open circuit breakers (`degradation.py`). Worker handles signals properly and utilizes heartbeat/lag monitoring.
- **Weaknesses:** Pipeline logic is duplicated between `main.py` sync fallback and `consumer.py` async processor, risking drift.
- **Risks:** 1-turn lag in `/api/analyze` could misalign emotional responses if frontend isn't designed for it. `_vocab_cache` in worker could cause OOM spikes under high burst loads.
- **Recommended Next Audit Target:** AI Orchestration Pipeline / LLM generation (`llm_pipeline.py` & frontend `useLive.ts`).

## [Phase C/D - AI Orchestration Pipeline]
- **Architecture Summary:** Frontend `useLive.ts` orchestrates the Gemini Live WebSocket, handling VAD, latency simulation, and background behavior injection. The backend `llm_pipeline.py` provides a robust 4-model fallback cascade on OpenRouter.
- **Strengths:** Excellent cascading fallback (OpenRouter -> Gemini -> Stale). `useGeminiWebSocket` gracefully handles model rejections and network reconnects with backoff.
- **Weaknesses:** Highly complex timing interplay in `useLive.ts`. The frontend manually fires `turnComplete: true` on `inputTranscription`, interfering with the native Gemini Live VAD.
- **Risks:** The 1-turn lag identified in Phase B was confirmed to be unhandled by the frontend; the LLM is always injected with the previous turn's memory and emotion. A race condition exists between behavior injection and turn completion WebSocket sends.
- **Recommended Next Audit Target:** Emotional Routing Layer (`backend/core/sensing.py`, `emotion.py`) to verify how the state vectors are built.

## [Phase E - Test Strategy Discipline]
- **Architecture Summary:** Custom, dependency-free testing scripts manually executed via `python` or `bun`/`ts-node`.
- **Strengths:** Lightweight, simple to run, validates core unit logic (seed limits, context engines).
- **Weaknesses:** No standard framework (no fixtures, test parallelization). Lack of integration and e2e WebSocket testing.
- **Risks:** The most complex part of the system (distributed orchestration & async lag) is entirely untested, resulting in critical production bugs remaining undetected.
- **Recommended Next Audit Target:** Subsystem 3 (Emotional Routing Layer) or Subsystem 4 (Memory/Retrieval Layer).

## [Subsystem 3 - Emotional Routing Layer]
- **Architecture Summary:** The emotional core uses `SensingEngine` for acoustic/temporal mapping (energy, trust, tension) via half-life decay, and `RuntimeEngine` for semantic tracking via `EmotionalStateRouter` (frustration, withdrawal, playfulness).
- **Strengths:** Temporal decay math beautifully avoids step-function emotion shifts. `response.py` elegantly handles composite emotions.
- **Weaknesses:** Poor separation of concerns regarding state management. Dictionaries are stored globally on the worker process.
- **Risks:** The `RuntimeEngine` shares `turn_history` globally, allowing catastrophic cross-contamination between concurrent users. `_sensing_engines` has no TTL, causing a guaranteed OOM leak.
- **Recommended Next Audit Target:** Subsystem 4 (Memory/Retrieval Layer).

## [Subsystem 4 - Memory & Retrieval Layer]
- **Architecture Summary:** Manages embedding generation via multi-tier fallback (Gemini → Cohere → FastEmbed → FTS), cached in Redis. Retrieves using `chroma_service.py` with strict timeouts (`sync.py`), defaulting to present-moment framing on failure.
- **Strengths:** Excellent fault tolerance. Uses MRL truncation properly for Cohere v3 embeddings. Graceful fallback chains block retrieval timeouts from crashing the response pipeline.
- **Weaknesses:** Embedding cache lacks provider namespace. Supabase calls use synchronous `asyncio.to_thread`.
- **Risks:** [CRITICAL] Falling back from Gemini to Cohere will return old Gemini vectors from the Redis cache, permanently corrupting the vector similarity space. [HIGH ROI] Synchronous DB calls will exhaust ASGI thread pools at scale.
- **Recommended Next Audit Target:** Subsystem 5 (Fallback + Degradation Logic).
