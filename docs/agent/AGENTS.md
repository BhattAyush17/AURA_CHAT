# AURA_CHAT — Agent Instructions

## Project Overview

AURA is a **voice-first AI companion** with emotional intelligence. Frontend (React/Vite/TanStack) connects to Gemini 2.5 Flash Native Audio via WebSocket for real-time voice. Backend (FastAPI/Python) runs a "5 Brain" cognitive pipeline for emotional analysis, memory, and behavior injection.

**Deploy:** Frontend → Vercel, Backend → Render (uvicorn), Consumer → Render worker, Memory consolidation → Render cron.

## Developer Commands

```bash
# Frontend (dev server on :3000)
npm run dev
npm run build          # Vite build → dist/
npm run lint           # eslint .
npm run format         # prettier --write .

# Backend (dev on :8000 with reload)
python server.py       # or: uvicorn server:app --host 0.0.0.0 --port 8000 --reload

# Consumer (Brain 3 async worker)
python behavior_engine_consumer.py

# Tests (no test framework configured — ad-hoc scripts only)
python test_runner.py
python test_demo_flow.py
python test_router.py
```

**No pytest, no typecheck script, no CI.** Tests are standalone scripts. Verify changes manually or add tests as needed.

## Architecture — The 5 Brains

| Brain | File(s)                                                                                                                                       | Role                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **1** | `src/hooks/useGeminiLive.ts` + `src/hooks/gemini/*`                                                                                           | Voice I/O via Gemini WebSocket, audio pipeline, barge-in      |
| **2** | `behavior_engine.py`, `sensing_engine.py`, `emotional_router.py`, `response_director.py`, `frustration_detector.py`, `withdrawal_detector.py` | Emotional analysis, StateVector (15-dim), response directives |
| **3** | `redis_bus.py`, `behavior_engine_consumer.py`                                                                                                 | Redis Stream async message bus + background consumer          |
| **4** | `memory_sync.py`, `chroma_service.py`                                                                                                         | Supabase pgvector memory storage/retrieval                    |
| **5** | `vocab_learner.py`                                                                                                                            | Per-user vocabulary + language pattern tracking               |

**Supporting modules:** `proactive_engine.py` (unprompted engagement), `relationship_tracker.py` (long-term stages), `degradation.py` (circuit breakers), `rate_limiter.py` (Redis sliding window), `embedding_cache.py` (Redis-backed embedding cache), `memory_consolidator.py` (episode summarization cron).

## Critical Path — Single Turn Flow

1. User speaks → VAD fires → `turnComplete` to Gemini WS
2. Frontend fires `POST /api/analyze` (500ms timeout, fails silently)
3. **Brain 3 path (primary):** Publish to Redis Stream → read cached result from previous turn → return <20ms
4. **Sync fallback (cold cache/Redis down):** Run full `RuntimeEngine.analyze()` inline → embed → pgvector query → return
5. Frontend injects `behavior_instructions` into Gemini as invisible "user" turn
6. Gemini generates audio response using enriched context

## API Endpoints

| Endpoint                      | Method | Rate Limit         | Notes                                          |
| ----------------------------- | ------ | ------------------ | ---------------------------------------------- |
| `/api/analyze`                | POST   | 60/min per session | Core analysis. Origin check enforced.          |
| `/session/start`              | POST   | 5/min              | Query params: `user_id`, `seed?`, `device_id?` |
| `/session/end`                | POST   | 5/min              | Generates memory seed via Gemini LLM call      |
| `/session/end/sync`           | POST   | 5/min              | Background seed generation                     |
| `/api/proactive/{session_id}` | GET    | 10/min per session | Polled every 15s during idle                   |
| `/health`                     | GET    | 30/min per IP      | Redis + consumer + Supabase probes             |
| `/supabase/setup-sql`         | POST   | Origin check       | Proxy to Supabase Management API               |

## Environment Setup

**Backend:** `.env.local` (loaded by `server.py` and `behavior_engine.py`). Requires:

- `GEMINI_API_KEY` — Gemini API (embedding-001 + Flash for seed generation)
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — pgvector + storage
- `ENVIRONMENT` — `development` or `production` (controls OpenAPI, error detail exposure)
- Redis on default localhost:6379 (no env var needed)

**Frontend:** `.env.local` (Vite). Requires:

- `VITE_GEMINI_API_KEY` — Same key, compiled into bundle
- `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE` — Optional, defaults to `http://localhost:8000`

**⚠️ `.env` and `.env.local` contain real API keys.** Never commit. The repo has no `.gitignore` entries for these — verify before any commit.

## Supabase Import Collision (server.py:53-58)

The local `./supabase/` directory (Supabase CLI) shadows the pip `supabase` package. `server.py` works around this by temporarily removing `''` from `sys.path` before importing. **Do not refactor this away** — it's a known fragile but necessary workaround.

## Session ID Convention

- Frontend creates tab-scoped IDs: `{baseId}__tab_{tabId}`
- `get_base_session_id()` strips the `__tab_` suffix for backend lookups
- All tabs sharing a base session share the same `active_sessions` cache entry
- This is intentional for cross-tab continuity but can cause state interference

## Key Patterns

- **Fail-open everywhere:** Redis down, Supabase down, rate limiter failure — never block the user experience
- **Circuit breakers:** 4 independent circuits (redis, supabase, worker, embedding_api) with auto-recovery
- **Hysteresis for prompt stability:** L2 behavioral prompt only re-sent on mode change, Euclidean distance >0.25, or 120s refresh
- **Speculative pre-fetch:** `/api/analyze` fires during user speech (before `turnComplete`), debounced 500ms/4-word min
- **Temporal decay:** Wall-clock-based emotional decay (half-lives: energy ~2min, warmth ~3.3min, trust ~5.6min, tension ~45sec)
- **Bilingual first-class:** Hindi (Devanagari), Hinglish, English detection with abuse vocabulary normalization

## Known Issues / Gotchas

1. **`was_interrupted` field** in `AnalyzeRequest` Pydantic model — sent by frontend but **ignored** by backend
2. **`sessionEndInProgress`** is module-scoped global, not user-scoped — concurrent tab session-ends can block each other
3. **Sync fallback path** calls `get_chromadb_enrichment()` inline with 400ms timeout — can block response on slow embedding calls
4. **No input sanitization** on `user_text` — flows directly into Gemini prompts
5. **VocabLearner race** in consumer: `load()` is async but profile existence check is sync — potential double-load
6. **Embedding costs:** Every memory store/retrieval hits Gemini embedding-001. Cache only does exact MD5 match, no semantic dedup
7. **`SessionStore.local_cache`** is process-scoped — lost on Render free tier spin-down
8. **No auth on `/api/analyze`** beyond Origin header check — sufficient for browser, not for server-to-server

## What Not to Touch Unless Asked

- `node_modules/`, `dist/`, `.tanstack/`, `__pycache__/`, `extracted_data/`
- Generated files: `routeTree.gen.ts`
- Lock files: `package-lock.json`
- Build artifacts and cache directories

## File Structure (Core Only)

```
AURA_CHAT/
├── server.py                    # FastAPI entry, all endpoints
├── behavior_engine.py           # Brain 2: RuntimeEngine, keyword/template managers
├── sensing_engine.py            # Brain 2: StateVector, temporal decay, arc resolution
├── emotional_router.py          # Brain 2: Multi-detector emotion scoring
├── frustration_detector.py      # Brain 2: Frustration scoring + prompts
├── withdrawal_detector.py       # Brain 2: Withdrawal scoring + silence machine
├── response_director.py         # Brain 2: Arc → 11 response modes mapping
├── redis_bus.py                 # Brain 3: Redis Stream + hot cache
├── behavior_engine_consumer.py  # Brain 3: Async worker coroutine
├── memory_sync.py               # Brain 4: Supabase pgvector operations
├── chroma_service.py            # Brain 4: Embedding + RPC query wrapper
├── vocab_learner.py             # Brain 5: Per-user vocab tracking
├── proactive_engine.py          # Unprompted engagement triggers
├── relationship_tracker.py      # Long-term relationship stages (5 levels)
├── degradation.py               # Circuit breaker manager (5 levels)
├── rate_limiter.py              # Redis sliding window rate limiter
├── embedding_cache.py           # Redis-backed embedding API cache
├── memory_consolidator.py       # Episode summarization (cron)
├── src/
│   ├── hooks/useGeminiLive.ts   # Brain 1: Composition orchestrator
│   ├── hooks/gemini/            # Sub-hooks (WS, audio, behavior, prompt, etc.)
│   ├── lib/gemini-prompt.ts     # 3-layer prompting (L1/L2/L3)
│   ├── lib/behavior-client.ts   # HTTP client for /api/analyze + speculative fetch
│   └── routes/index.tsx         # Main UI (mic, waveform, personality selector)
└── extracted_data/              # Pre-extracted keyword/template JSON data
```
