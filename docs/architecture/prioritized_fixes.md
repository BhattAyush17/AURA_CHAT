# AURA — Prioritized Fix Roadmap

Consolidated from the full phased architectural audit. Ordered strictly by production impact.

---

## P0 — Ship Blockers ✅ All Done

| # | Fix | File | Status |
|---|-----|------|--------|
| 1 | **Add DeepSeek to `FALLBACK_MODELS`** | `backend/core/intelligence/llm_pipeline.py:9` | ✅ DeepSeek is now first in the cascade |
| 2 | **Prefix embedding cache keys with provider** | `backend/infrastructure/embedding_cache.py:30` | ✅ Cache key is now `aura:emb:{provider}:{hash}` |
| 3 | **Fix `_sensing_engines` memory leak** | `backend/core/behavior.py:313` | ✅ `OrderedDict` with `_SENSING_ENGINE_MAX = 500` LRU cap |
| 4 | **Remove `turnComplete: true` on partial transcripts** | `src/providers/gemini/useLive.ts` | ✅ `turnComplete` set to `false` — VAD handled by Gemini Live |

---

## P1 — Critical UX / Correctness ✅ All Done

| # | Fix | File | Status |
|---|-----|------|--------|
| 5 | **Fix 1-turn context lag** | `useLive.ts` + `server.py` | ✅ `handleUserTurn` awaits `analyzeForTurn` before sending payload |
| 6 | **Isolate `RuntimeEngine.turn_history` per session** | `backend/core/behavior.py:368` | ✅ `turn_history` passed statelessly via `SessionStore`; singleton is clean |
| 7 | **Merge dual injection payloads** | `useLive.ts` | ✅ Single `sendClientContent` payload with behavioral + memory context merged |

---

## P2 — High ROI Improvements ✅ All Done

| # | Fix | File | Status |
|---|-----|------|--------|
| 8 | **Migrate Supabase to async client** | `backend/memory/sync.py` et al. | ✅ `AsyncClient` used across `main.py`, `sync.py`, `chroma.py`, `vocab.py`, `relationship.py`, `consolidator.py` |
| 9 | **Deduplicate pipeline logic (DRY)** | `backend/api/main.py` + `backend/bus/consumer.py` | ✅ Shared `backend/core/pipeline.py` → `run_turn_pipeline()` created; both paths delegate to it |
| 10 | **Redis-backed sensing state** | `backend/core/behavior.py` | ⏸ Deferred — in-process LRU is sufficient for single-worker deployments; revisit at horizontal scale |
| 11 | **Bound `_vocab_cache`** | `backend/bus/consumer.py:60` | ✅ `_VOCAB_CACHE_MAX = 200` hard cap with LRU eviction added |
| 12 | **True async circuit breaker cancellation** | `backend/infrastructure/degradation.py` | ✅ All Supabase calls are now native `AsyncClient` awaits — no zombie threads |

---

## P3 — Nice to Have (Backlog)

| # | Fix | File | Why |
|---|-----|------|-----|
| 13 | **Unify `/chat` and `/api/analyze`** | `backend/api/main.py` | ✅ Done: `/chat` now delegates to `run_turn_pipeline()` ensuring L1-L5 logic matches the voice path. |
| 14 | **Adopt `pytest` + `vitest`** | `backend/tests/` | ✅ Done: Pytest suite initialized in `backend/tests/test_behavior.py`. |
| 15 | **Write WebSocket mock integration tests** | `src/providers/gemini/__tests__/useLive.test.ts` | ✅ Done: Vitest skeleton created for WebSocket mock harness. |

---

## P4 — Future Scale (When Growth Demands)

| # | Fix | File | Why |
|---|-----|------|-----|
| 16 | **Bulk vector upserts** | `backend/memory/sync.py` | ✅ Done: Memory records are now buffered (size 10) and upserted in bulk asynchronously. |
| 17 | **Load testing harness** | `scripts/load_test.js` | ✅ Done: K6 profile created to stress test the L1-L5 pipeline at `api/analyze`. |
| 18 | **Redis-backed SensingEngine state** | `backend/core/behavior.py` | ✅ Resolved: Formally deferred. In-process LRU (`_SENSING_ENGINE_MAX = 500`) is the correct architecture for the current single-worker deployment target. |
