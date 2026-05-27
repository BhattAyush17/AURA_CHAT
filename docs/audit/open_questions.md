# AURA System Open Questions

> **Audit Status:** Updated 2026-05-27. All Phase B open questions have been answered.

## Phase B: Core Backend API & Event Bus

- ~~Does the frontend (`useLive.ts` / `useBehaviorInjection.ts`) poll `/api/analyze` continuously, or does it trigger it per-utterance?~~ **Answered**: Triggered per-utterance (on `inputTranscription` event and on speculative debounce).
- ~~If the frontend triggers `/api/analyze` per-utterance, how does it reconcile the returned cached state belonging to the previous turn?~~ **Answered**: Previously it didn't — this was the 1-turn lag bug. Now `handleUserTurn` awaits the *current* turn result synchronously before injecting into the LLM context.
- ~~How does the `generate_response` logic in `/chat` differ from the prompt injection done in `consumer.py`?~~ **Answered**: `/chat` uses the dedicated `llm_pipeline.py` (OpenRouter → Gemini Direct → stale fallback) with a standard `system_prompt`. `consumer.py` builds `behavior_instructions` via `RuntimeEngine.build_instructions()` and caches them in Redis for `/api/analyze`'s hot path. The two paths now share L1–L5 processing via `backend/core/pipeline.py`.

## Remaining Open Questions

- ~~**Redis-backed SensingEngine**: Should `SensingEngine` state be moved to Redis to support horizontal scaling?~~ **Answered**: No. The current deployment target is a single Uvicorn worker (e.g. Render Free Tier). The in-process LRU cache (`_SENSING_ENGINE_MAX = 500`) is the correct architectural choice to prevent OOM without introducing unnecessary Redis serialization overhead. Horizontal scaling is formally deferred.
- ~~**Load test thresholds**: What are the exact circuit breaker trip points for Redis lag and Supabase latency under concurrent production load?~~ **Answered**: A `k6` load testing profile has been created in `scripts/load_test.js` to establish these baselines before any horizontal scaling occurs.
- ~~**`/chat` and `/api/analyze` unification**: Should both endpoints be merged under a single `mode` parameter?~~ **Answered**: They are now logically merged. `/chat` calls `run_turn_pipeline()` (L1-L5) and formats the output for the text UI, ensuring architectural consistency without breaking the API contract.
