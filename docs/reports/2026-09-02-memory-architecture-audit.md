# Memory Architecture Audit — 2026-09-02

**Verdict: ARCHITECTURALLY INCONSISTENT**

| Field              | Value                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Audit date         | 2026-09-02                                                                                                      |
| Repo               | `/home/tensorttx/Projects/Personal/AURA_CHAT/AURA_CHAT` (inner repo)                                            |
| Baseline commit    | `5e3b9b9` — `feat(cognitive): wire global Social Presence layer` (2026-08-31)                                   |
| Audited target     | **Current working tree**, baseline used only for divergence detection                                           |
| Working tree state | 219 modified tracked, 311 untracked                                                                             |
| Method             | Code read + call-graph tracing + read-only runtime probes. Tests were NOT accepted as proof of production path. |
| Changes made       | None. No edits, no commits, no staging, no reset.                                                               |

Headline: the production memory path is severed in four independent places, and every one of them fails silently. A memory can be written to Postgres and never read; a memory can be read and never injected; the endpoint the frontend retrieves from is not registered on the served app at all.

---

## 1. Complete Memory Architecture Map

```
USER SPEECH
   │
   ├─ Gemini (voice-primary) ──── never calls /api/analyze ────────────────┐
   │                                                                       │
   └─ OpenRouter / Sarvam ─→ POST /api/analyze ─→ eager return (mem="")    │
                          └─→ POST /api/analyze/stream (cognitive_block)   │
                                                                           │
FRONTEND COGNITIVE PATH (the only live memory path)                        │
   RuntimeManager.processCognitiveTurn:125                                 │
     └─ memoryGateway.retrieveMemories()                                   │
          ├─ mode "supabase" → GET /api/memory/model/{id} → 404 → []  ✗    │
          └─ mode "local"    → localStorage aura_memories_{tier}_{uid} ✓   │
     └─ ConversationExecutive.plan → MemoryPolicy.decide → topMemory (1)   │
     └─ ConversationInterpreter:107 → [RELEVANT MEMORY] block ─────────────┘
     └─ storeMemory():231 → localStorage only (supabase mode = no-op)

BACKEND MEMORY PATH (computed, then discarded)
   run_turn_pipeline (BackgroundTask, main.py:653)
     └─ pipeline.py:350 get_chromadb_enrichment_v2 → RPC match_memories_v2 ✓
     └─ pipeline.py:368 result.memory_enrichment = <text> → TASK ENDS, DROPPED ✗

   /chat:1096 store_and_backup_memory → aura_chroma_backup  [0 frontend callers] ✗
   /api/cron/consolidate → MemoryConsolidator → episode rows ✓ (degraded, see D7)
```

---

## 2. Infrastructure / Database Matrix

| Store                | Status                                       | Reads                                              | Writes                          | Authoritative            | Cache/Fallback | Caller                                                                                                                                  | Evidence            |
| -------------------- | -------------------------------------------- | -------------------------------------------------- | ------------------------------- | ------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Supabase Postgres    | **ACTIVE**                                   | `aura_storage`, `aura_seeds`, `aura_chroma_backup` | same                            | Yes (only durable store) | —              | `main.py:178` `async_create_client`                                                                                                     | `main.py:83-84,178` |
| pgvector             | **ACTIVE but unreachable in prod read path** | `match_memories_v2`                                | `embedding` col                 | Yes for vectors          | —              | `chroma.py:154` ← `sync.py:248` ← `pipeline.py:350`                                                                                     | Probe 3/4           |
| `aura_chroma_backup` | **WRITE-MOSTLY ORPHAN**                      | only pipeline background task                      | `/chat` + cron                  | Yes                      | —              | `sync.py:181`, `consolidator.py:227`                                                                                                    | §7 D1               |
| `aura_storage`       | **ACTIVE**                                   | `user_model_{id}`, `state_vector_{id}`             | pipeline, memory_endpoints      | Yes                      | —              | `pipeline.py:270,303`                                                                                                                   | verified            |
| `aura_seeds`         | **ACTIVE-WRITE / DEAD-READ**                 | `sync.py:39` via `/session/start`                  | `sync.py:59` via `/session/end` | Yes                      | —              | **0 frontend callers**                                                                                                                  | §5                  |
| Redis                | **ACTIVE (degraded-optional)**               | analysis cache, embedding cache                    | same                            | No                       | Cache          | `main.py:186`                                                                                                                           | verified            |
| Valkey               | **DEAD — mention only**                      | —                                                  | —                               | —                        | —              | `StorageSettings.tsx:739` label, `README.md:178` prose                                                                                  | grep                |
| Pinecone             | **DEAD — key accepted, never used**          | —                                                  | —                               | No                       | —              | `main.py:485-488` stores key; `main.py:1532` `"active": False`; zero `import pinecone`                                                  | verified            |
| ChromaDB             | **DEAD — name fossil only**                  | —                                                  | —                               | —                        | —              | zero `import chromadb`; absent from `requirements.txt`; `chroma_behavior_db/` does not exist though `main.py:216` passes it as `db_dir` | verified            |
| localStorage         | **ACTIVE — de-facto only working store**     | `aura_memories_{tier}_{uid}`                       | same                            | Yes, by accident         | —              | `local-memory.ts:196,203,214`                                                                                                           | verified            |
| Embedding provider   | **ACTIVE = Cohere (not Gemini)**             | —                                                  | 768-dim                         | —                        | Chain          | `embedding_provider.py:45-84`                                                                                                           | Probe 8             |
| Redis worker         | **DEAD — empty file**                        | —                                                  | —                               | —                        | —              | `backend/bus/consumer.py` is **1 byte**                                                                                                 | Probe 10            |

**Probe 8 — embedding provider actually selected**

```
ACTIVE EMBEDDING PROVIDER (with only .env.local loaded): cohere
is_available: True
```

CLAIM: Gemini is the primary embedder.
EVIDENCE: `embedding_provider.py:45-52` prefers `GEMINI_API_KEY`, but `main.py:58` loads **only `.env.local`**, and `GEMINI_API_KEY` lives in `.env` — never loaded.
VERDICT: **FALSE in the working tree.**
IMPACT: production embeds via Cohere MRL-truncated vectors (`:131`); `SUPABASE_URL`/`SUPABASE_KEY` resolve to `None`, so `startup_event:177` skips client creation — `supabase = None`, `chroma_service.is_ready = False`.

**Probe 10 — Render worker + cron entrypoints**

```
$ wc -c backend/bus/consumer.py                        → 1
$ python -m backend.bus.consumer                       → RC=0 (exits instantly, no loop)
$ python -m backend.memory.consolidator --all --purge   → RC=0 (no __main__, no argparse)
```

`render.yaml:8-12` declares a worker running the empty module; `render.yaml:14-19` declares the daily cron running a module with no CLI entrypoint. Both no-ops.

---

## 3. Memory Write Path

Traced one real write: `/chat` → Postgres.

| Stage              | File:function:line                                         | Status                                                            |
| ------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Input              | `main.py:1033 chat_endpoint`                               | reachable only if frontend calls `ENDPOINTS.chat` — **0 callers** |
| Significance gate  | `sync.py:109-114` energy<0.3 & engagement<0.3, arc_turns<2 | works                                                             |
| Classification     | `sync.py:117-126` metadata dict                            | no semantic classification exists                                 |
| Embedding          | `sync.py:133-139` → `embedding_provider.embed`             | works, 768-dim                                                    |
| Record build       | `sync.py:142-151`                                          | works                                                             |
| Buffer             | `sync.py:154` `_buffer_memory_record`                      | works                                                             |
| **Telemetry line** | **`sync.py:156` uses `t_start` — never defined**           | **raises `NameError`**                                            |
| Flush              | `sync.py:176-185` at 10 records                            | works, never reached in-process                                   |

**Probe 1 — the write path throws on every call**

```
BUFFERED: 1
KEYS: [created_at, embedding, embedding_id, metadata, session_id, turn_text, user_id]
HAS EMBEDDING: True DIM: 768
LOGS: [('warn', 'memory_buffer_failed', "name 't_start' is not defined")]
```

CLAIM: `store_and_backup_memory` completes successfully.
EVIDENCE: `sync.py:156` references `t_start`; AST dump confirms it is neither local nor module-level (locals: `emb, embedding_id, embedding_ms, metadata, record, store_mode, t_embed`).
VERDICT: **FALSE.**
IMPACT: buffering still happens (line 154 precedes the throw), but the function always exits via `except` at `:159`, logging `memory_buffer_failed`. Every successful write is recorded as a failure. `git diff 5e3b9b9 -- backend/memory/sync.py` is empty → **pre-existing at baseline**.

**Probe 2 — buffer semantics**

```
after 9 records  → flushes: []   buffer_len: 9
after 10 records → flushes: [10] buffer_len: 0
```

CLAIM: buffered memories reach Postgres.
EVIDENCE: `sync.py:163-174`, flush at `_BUFFER_SIZE=10`; no shutdown hook, no `atexit`, no flush-on-session-end anywhere.
VERDICT: **PARTIAL.**
IMPACT: up to 9 memories sit in a module-global list and are lost on every restart. On Render free tier (documented crash-prone at `redis.py:188-191`) this is the normal case.

---

## 4. Memory Read / Retrieval Path

**Probe 3 — the RPC contract is correct**

```
RPC CALLED: match_memories_v2
PARAM KEYS: [match_count, match_threshold, max_age_days, p_user_id, query_embedding, recency_weight]
p_user_id: u1  threshold: 0.65  recency_weight: 0.15
FORMATTED:
[MEMORY CONTEXT]
[Earlier today] you mentioned: "I love mountains"
[/MEMORY CONTEXT]
```

**Probe 4/5 — enrichment reaches the pipeline, then dies**

```
=== ENRICHMENT RETURNED TO PIPELINE ===
[MEMORY CONTEXT]
[Earlier today] (sim=0.81) I love mountains
[/MEMORY CONTEXT]

=== is_ready=False (Supabase down) ===
[CONTEXT ENRICHMENT] … No historical match — respond from present moment. [END ENRICHMENT]
```

CLAIM: retrieved memory reaches the LLM.
EVIDENCE: `pipeline.py:350-368` computes it; `pipeline.py:381-383` folds it into `result.sensing_injection`; the pipeline is invoked as `background_tasks.add_task(run_turn_pipeline, …)` at `main.py:653`. FastAPI discards a BackgroundTask return value. Meanwhile `/api/analyze` has already returned `memory_enrichment=""` at `main.py:690`.
VERDICT: **FALSE — retrieved but never injected.**
IMPACT: full embed + vector search cost paid every turn, result discarded.

Intended recovery wire is also dead: `main.py:626` reads Redis key `speculative_mem:{sid}`, written only by `prefetch_memory:525`, reachable only via `POST /api/speculate:540` — zero frontend callers, not in `ENDPOINTS`.

**Probe 6 — the frontend's retrieval endpoint is not registered**

```
=== REGISTERED ROUTES ON SERVED app ===
   /api/analyze, /api/analyze/stream, /api/cron/consolidate, /api/proactive/{session_id},
   /api/redis/*, /api/speculate, /api/telemetry, /api/turn-*, /api/webhooks/process_memory,
   /api/ytmusic/*, /chat, /health, /session/end, /session/end/sync, /session/start, ...

MISSING  /api/memory/model/{user_id}
MISSING  /api/memory/consolidate
PRESENT  /api/cron/consolidate
```

CLAIM: `/api/memory/model/{user_id}` serves frontend retrieval.
EVIDENCE: `main.py:111` creates `app`, `:126`/`:129` attach cron+memory routers, then **`main.py:150` rebinds `app = FastAPI(...)`**, discarding both. The second app re-attaches webhooks (`:159`) and cron (`:165`) but never `memory_router`. `git show 5e3b9b9` shows the same double-assignment at `:103`/`:142` → pre-existing.
VERDICT: **FALSE — route does not exist.**
IMPACT: `memory-gateway.ts:166` sees `!res.ok`, returns `[]` at `:171`. In supabase mode, frontend retrieval always returns zero memories. `/api/memory/consolidate` (called by `SessionLifecycleManager.ts:51`) is likewise 404.

Ranking / dedup / budgeting, where they exist:

- Vector ranking: `002_match_memories_v2.sql:60-63`, cosine `<=>`, 85/15 semantic/recency blend, threshold `>0.65`
- Relevance filter: `MemoryPolicy.ts:58-68` — `≥0.6` Required, `≥0.3` Optional, else Ignore
- **Budgeting: `memoryContent: memory.topMemory ? [memory.topMemory] : []`** — `ConversationExecutive.ts:262`. Only **one** memory ever survives regardless of how many were retrieved.
- Dedup: local only, `local-memory.ts:350`, 5-second window
- `cognitive-budget.ts` imported only by OpenRouter (`:47`) and Sarvam (`:42`) as `boundCognitiveBlock` — **Gemini never budgets**

---

## 5. LIVE → SEED → DEEP → DURABLE Matrix

| Layer       | Implementation                            | Caller                        | Persistence                                                                                            | Trigger                              | Reachable?                  |
| ----------- | ----------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------ | --------------------------- |
| **LIVE**    | `IdentityEvolution.observe_turn_live:226` | `pipeline.py:312`             | `_live_state_cache` (30 min TTL, `:18`) → `aura_storage/user_model_{id}` via `_persist_live_state:277` | every turn, `user_id != "anonymous"` | **YES** ✓                   |
| **SEED**    | `behavior.py:515 generate_memory_seed`    | `main.py:1250` `/session/end` | `aura_seeds` via `sync.py:59`                                                                          | session end                          | **NO** ✗                    |
| **DEEP**    | `IdentityEvolution.consolidate:381`       | `memory_endpoints.py:92`      | `aura_storage/user_model_{id}`                                                                         | `POST /api/memory/consolidate`       | **NO** ✗ route unregistered |
| **DURABLE** | `MemoryConsolidator.consolidate_user:102` | `cron.py:32`                  | `aura_chroma_backup` episode rows                                                                      | daily cron                           | **PARTIAL** ⚠               |

**Probe 13 — endpoint caller counts**

```
sessionStart callers=0   sessionEnd callers=0   sessionEndSync callers=0   chat callers=0
analyze callers=7        analyzeStream callers=2   health callers=11
```

SEED is a dead transition. Same at baseline (`git grep` on `5e3b9b9` → empty). No seed is ever generated, `aura_seeds` never written, `get_latest_seed` never fires. Downstream, `usePromptOrchestrator.ts:83` initialises `seedRef` to `{content:""}` and never assigns it, so `gemini-prompt.ts:901` omits `AURA_MEMORY_PROMPT` on every Gemini session.

Parallel frontend seed system is entirely dead code: `auraSeedToLegacy`, `legacyToAuraSeed`, `parseCrystallizationOutput`, `buildSeedInjection`, `createDefaultSeed` — zero callers outside `aura-memory.ts`. Two competing seed formats, neither reachable.

DEEP is blocked twice: route unregistered, and `SessionLifecycleManager.ts:51` hardcodes `http://localhost:8000` (breaks in any deployed build). It also reads `localStorage["aura_session_id"]`, a key with no writer anywhere in `src/` → always `"unknown_session"`.

DURABLE is reachable but degraded: `cron.py:44` selects `user_id` with no `.limit()`, pulling every unconsolidated row to dedupe client-side. `consolidator.py:296` requests `gemini-1.5-flash`; on failure falls back to a template summary at `:313`. Soft-delete/purge logic is sound (`:247`, `:174`).

---

## 6. Provider Parity Matrix

|                               | Gemini                                              | OpenRouter                    | Sarvam                        |
| ----------------------------- | --------------------------------------------------- | ----------------------------- | ----------------------------- |
| Calls `/api/analyze`          | **No**                                              | Yes `useProvider.ts:1045`     | Yes `useSarvam.ts:1149`       |
| `behavior_instructions` → LLM | No                                                  | **No** (never referenced)     | Fallback only `:1595`         |
| `memory_enrichment` → LLM     | No                                                  | No                            | No                            |
| `sensing_injection` → LLM     | No                                                  | Backend-side, fallback branch | Backend-side, fallback branch |
| Memory actually seen          | `buildInitialCognitiveSnapshot:249` at connect only | `cognitive_block` per turn    | `cognitive_block` per turn    |
| Budgeted                      | **No**                                              | Yes                           | Yes                           |
| Prompt builder                | `getSystemPromptForPersonality:247`                 | same `:1423`                  | same `:1558`                  |
| Runtime status                | Works                                               | **Throws pre-request**        | **Throws pre-request**        |

CLAIM: the same retrieved memory reaches all three providers.
EVIDENCE: three independent divergences — Gemini retrieves once at session start with an empty query (`RuntimeManager.ts:249`), never per-turn; OpenRouter/Sarvam retrieve per-turn (`:125`); only Sarvam ever injects `behavior_instructions`, and only on its fallback branch.
VERDICT: **FALSE.**
IMPACT: Gemini is memory-frozen for the whole session; the other two are memory-fresh but broken.

**Probe 12 — OpenRouter and Sarvam call methods that do not exist**

```
useProvider.ts(1072,38): error TS2339: Property 'getLastAtmosphereDecision' does not exist on type 'RuntimeManager'.
useProvider.ts(1119,58): error TS2339: Property 'getLastExecutivePrompt' does not exist on type 'RuntimeManager'.
useSarvam.ts(1176,38):   error TS2339: Property 'getLastAtmosphereDecision' does not exist on type 'RuntimeManager'.
useSarvam.ts(1230,58):   error TS2339: Property 'getLastExecutivePrompt' does not exist on type 'RuntimeManager'.
[25 total tsc errors]
```

`git show 5e3b9b9` → zero hits for either name in `useProvider.ts` or `RuntimeManager.ts`.
VERDICT: **working-tree regression, not in baseline.**
Line 1072 sits _before_ the `try {` at `:1097`, so the `TypeError` escapes `processTurn`; call sites `:2018`/`:2269` are bare `await` with no catch and there is no `unhandledrejection` handler.
IMPACT: OpenRouter and Sarvam turns die before a request body is built. Vite does not typecheck, so this ships (confirmed present in `dist/assets/index-gcbvoPwU.js`).

Also silently dropped: `processCognitiveTurn` passed 5 args, declared with 3 (`RuntimeManager.ts:101`); `buildInitialCognitiveSnapshot` gets 3 for 2 (`:245`).

---

## 7. Dead / Duplicate Path Report

| ID  | Item                                                                                                                                                                                                                                            | Evidence                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| D1  | `aura_chroma_backup` written only via `/chat` (0 callers) + cron                                                                                                                                                                                | §3                         |
| D2  | `chroma.store_memory:277` — 0 callers                                                                                                                                                                                                           | grep                       |
| D3  | `get_chromadb_enrichment` v1 `sync.py:189` — 0 callers                                                                                                                                                                                          | grep                       |
| D4  | `match_memories` v1 `chroma.py:80` — reachable only from D3 → dead; passes `match_user_id: None` = **all-users search**                                                                                                                         | `chroma.py:102`, `001:130` |
| D5  | `get_cached_memories` `redis.py:248` — 0 callers; `write_cached_analysis` has 0 producers                                                                                                                                                       | grep                       |
| D6  | `/api/speculate` + `prefetch_memory` — 0 callers, not in `ENDPOINTS`                                                                                                                                                                            | §4                         |
| D7  | `consumer.py` empty (1 byte) + `consolidator` has no `__main__` → both Render services no-ops                                                                                                                                                   | Probe 10                   |
| D8  | Pinecone: key ingested, `"active": False`, no import                                                                                                                                                                                            | `main.py:1532`             |
| D9  | ChromaDB: no import, not in requirements, `chroma_behavior_db/` absent                                                                                                                                                                          | verified                   |
| D10 | Valkey: 2 string mentions only                                                                                                                                                                                                                  | grep                       |
| D11 | Duplicate HNSW indexes on `embedding` (`001:50` + `004:6`) and duplicate GIN FTS (`003:60` + `004:12`) — different names, both build                                                                                                            | migrations                 |
| D12 | **`match_memories_v2` defined twice with different signatures** — `002:26` (6 params, `p_user_id`) and `004:17` (4 params, `filter_user_id`, returns `content` not `turn_text`). `CREATE OR REPLACE` with changed arity creates an **overload** | migrations                 |
| D13 | `aura-memory.ts` seed bridge — all exports uncalled                                                                                                                                                                                             | §5                         |
| D14 | `aura-context.ts assembleCognitiveContext` imported at `useLiveNext.ts:39`, never invoked                                                                                                                                                       | grep                       |
| D15 | `applyBehavioralInjection` `useBehaviorInjection.ts:158` — exported, never called                                                                                                                                                               | grep                       |
| D16 | `ProviderAdapter.ts:19` — nothing implements it; `ProviderManager.ts` — 0 consumers                                                                                                                                                             | grep                       |
| D17 | `match_memories_fts` `003:103` — no Python caller; `_query_fts` uses `.or_()` ILIKE instead                                                                                                                                                     | migrations                 |
| D18 | `rebuild_from_supabase` `chroma.py:308` — `pass`                                                                                                                                                                                                | read                       |
| D19 | Three FTS mechanisms coexist: stored `fts_vector`, expression index, client-side ILIKE                                                                                                                                                          | migrations                 |

**Probe 7 — `cosine_similarity` import is broken and swallowed**

```
$ from backend.memory.chroma import cosine_similarity
IMPORT FAILED -> ImportError: cannot import name 'cosine_similarity' from 'backend.memory.chroma'

Replaying memory_endpoints.py:153-178:
CAUGHT: ImportError -> cannot import name 'cosine_similarity' ...
FINAL SCORES (semantic ranking silently skipped): [{'base_score': 0.7, 'score': 0.7}]
```

`memory_endpoints.py:157` imports it from `chroma`; actually defined at `IdentityEvolution.py:320`. Caught by `except Exception` at `:172`, degrading to base scores. Absent from `chroma.py` at baseline too → pre-existing. Moot in practice since the route is unregistered.

---

## 8. Data Consistency Risks

1. **No RLS on `aura_chroma_backup` or `aura_seeds`.** RLS exists only on `aura_storage` (`supabase-setup.sql:11-15`), and `update_own` has `USING` without `WITH CHECK`, permitting `user_id` reassignment. Backend uses the service-role key, bypassing RLS regardless.
2. **Cross-user leak by design in v1.** `chroma.py:102` passes `match_user_id: None`; `001:130` documents "NULL means search all users." Currently unreachable (D4) but one call away.
3. **`aura_chroma_backup` has no `CREATE TABLE` in the repo.** Only `ALTER`s exist. No PK/UNIQUE is version-controlled, so `.upsert()` at `sync.py:181` and `chroma.py:300` — neither passing `on_conflict` nor `id` — behaves as plain INSERT. `embedding_id` is deterministic (`f"{session_id}_{turn_number}"`), so replays duplicate rather than replace.
4. **`aura_seeds` has no DDL at all.** `sync.py:39` uses `.order(updated_at desc).limit(1)`, the shape you write when duplicates are possible.
5. **`updated_at` type collision.** `aura_storage.updated_at` is `TIMESTAMPTZ` (`supabase-setup.sql:5`), but `memory_endpoints.py:52` and `pipeline.py:307` write `time.time()` floats while `sync.py:64,92` and `vocab.py:214` write ISO strings.
6. **Frontend bootstrap creates an incompatible schema.** `SupabaseConnect.tsx:47` creates `aura_storage` with `id uuid PK`, `key UNIQUE`, and **no `user_id`** — every `user_id` upsert fails on UI-provisioned projects.
7. **Cohere `input_type: "search_document"` for both store and query** (`embedding_provider.py:126`) — asymmetric embedding degrades cosine similarity; Cohere is the active provider.
8. **Last-writer-wins on `unresolved_items`**, acknowledged at `pipeline.py:286-287`.
9. **`match_memories_v2` (002) has no NULL guard**: `WHERE m.user_id = p_user_id` at `002:67`, no default, so NULL returns zero rows silently — unlike `001:131`/`003:136`/`004:30`.
10. **Migration order hazard**: `004:2` adds the `embedding` column that `001:50` and `002:56` already depend on.
11. **`004`'s overload filters `metadata->>'user_id'`** (`:30`) instead of the indexed column, bypassing `idx_chroma_user_id`.
12. **Consolidated episodes are re-retrievable**: `002` has no `consolidated_at IS NULL` predicate, so soft-deleted turns stay searchable for 30 days alongside their own summary.
13. `MAX_ENTRIES = 50` (`local-memory.ts:36`) is dead — `TIER_CAPS` governs (`:42`).

---

## 9. Runtime Verification Results

| #   | Probe                                                 | Result                                                                                                      |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Write path executed with fake state                   | Buffered w/ 768-dim embedding, then `NameError: t_start` → logged as failure                                |
| 2   | Buffer flush threshold                                | Flushes at exactly 10; ≤9 lost on restart, no shutdown hook                                                 |
| 3   | `match_memories_v2` param contract                    | Matches `002` signature exactly ✓                                                                           |
| 4   | `get_chromadb_enrichment_v2` output                   | Correct `[MEMORY CONTEXT]` block ✓                                                                          |
| 5   | Fallback when `is_ready=False`                        | Clean `[CONTEXT ENRICHMENT]` degrade ✓                                                                      |
| 6   | Registered routes on served `app`                     | `/api/memory/model/{user_id}` **MISSING**, `/api/memory/consolidate` **MISSING**                            |
| 7   | `from chroma import cosine_similarity`                | ImportError, silently caught                                                                                |
| 8   | Embedding provider resolution                         | **cohere**, not gemini                                                                                      |
| 9   | Supabase client at import                             | `supabase = None`; `SUPABASE_URL`/`GEMINI_API_KEY` not loaded (only `.env.local` read; they live in `.env`) |
| 10  | `python -m backend.bus.consumer`                      | RC=0 instantly; file is 1 byte                                                                              |
| 11  | `python -m backend.memory.consolidator --all --purge` | RC=0; no `__main__`                                                                                         |
| 12  | `npx tsc --noEmit`                                    | 25 errors, incl. 4 × missing `RuntimeManager` getters                                                       |
| 13  | `ENDPOINTS.*` caller counts                           | `sessionStart/End/EndSync/chat/turnDetect` = **0**                                                          |
| 14  | `dist/` bundle                                        | Contains the broken getter calls (built 2026-08-31 20:37, same minute as `5e3b9b9`)                         |

Not verified: live Supabase/Redis connectivity (no credentials loaded; secret values not read); voice path (needs real audio devices); whether `match_memories_v2` 002 vs 004 is actually applied in the live DB.

---

## 10. Findings by Severity

### CRITICAL

| ID  | Finding                                                                                                                              | Baseline?          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| C1  | `app` rebound at `main.py:150` drops `memory_router` → both memory routes unreachable → frontend supabase-mode retrieval always `[]` | Pre-existing       |
| C2  | `sync.py:156` `NameError: t_start` on every write                                                                                    | Pre-existing       |
| C3  | `pipeline.py:368` memory computed in a BackgroundTask, discarded; `/api/analyze` returns `memory_enrichment=""`                      | Pre-existing       |
| C4  | OpenRouter + Sarvam call non-existent `RuntimeManager` getters → `TypeError` before request                                          | **NEW regression** |
| C5  | Seed layer fully dead — session endpoints have 0 callers                                                                             | Pre-existing       |

### HIGH

| ID  | Finding                                                                                 |
| --- | --------------------------------------------------------------------------------------- |
| H1  | `consumer.py` empty + `consolidator` lacks `__main__` → both Render services are no-ops |
| H2  | `.env` never loaded → no Supabase, no Gemini embeddings; silently degrades to Cohere    |
| H3  | `aura_chroma_backup` / `aura_seeds` have no DDL and no RLS                              |
| H4  | `match_memories_v2` defined twice with incompatible signatures (D12)                    |
| H5  | Buffered memories lost on restart (≤9)                                                  |
| H6  | Gemini memory-frozen at session start; no per-turn retrieval                            |
| H7  | `SessionLifecycleManager.ts:51` hardcodes `localhost:8000`                              |
| H8  | Upserts without `on_conflict` on a table with no known unique key → duplicates          |

### MEDIUM

M1 `memoryContent` capped at 1 memory (`ConversationExecutive.ts:262`) · M2 Cohere `input_type` asymmetry · M3 `updated_at` type collision · M4 duplicate HNSW/GIN indexes · M5 `cosine_similarity` wrong import · M6 `cron.py:44` unbounded scan · M7 consolidated + soft-deleted rows both retrievable · M8 `aura_session_id` never written · M9 25 tsc errors ship unchecked · M10 frontend bootstrap schema incompatible

### LOW

L1 Pinecone key ingest theatre · L2 ChromaDB naming fossil + missing `db_dir` · L3 Valkey mentions · L4 dead seed bridge · L5 `ProviderAdapter`/`ProviderManager` unimplemented · L6 `MAX_ENTRIES` dead · L7 stale `/chat` log messages · L8 `match_memories_fts` uncalled · L9 `rebuild_from_supabase` is `pass`

### Divergence vs `5e3b9b9`

972 insertions across 9 memory files. `chroma.py` +140/−124 is a pure `timing()` wrapper refactor, RPC contract unchanged. `embedding_provider.py`, `memory_endpoints.py` likewise telemetry-only. `IdentityEvolution.py` +312 adds the LIVE layer. `local-memory.ts` +344 adds tiers. **`useProvider.ts` (+1310/−550) and `useSarvam.ts` (+220) introduced C4 — the only new critical defect.**

---

## 11. Recommended Fix Order

1. **C1** — delete the second `app = FastAPI()` at `main.py:150`, or move all `include_router` calls after it. One-line unblock for two dead routes.
2. **C4** — restore or remove the two `RuntimeManager` getters. Unblocks OpenRouter + Sarvam entirely.
3. **C2** — define `t_start` (or drop line 156).
4. **H2** — load `.env` alongside `.env.local`.
5. **C3** — return `memory_enrichment` synchronously, or wire the `/api/speculate` prefetch the frontend never calls.
6. **H1** — implement `consumer.py` and a consolidator `__main__`, or remove both `render.yaml` services.
7. **H3/H4/H8** — commit `aura_chroma_backup` + `aura_seeds` DDL with UNIQUE constraints and RLS; resolve the duplicate `match_memories_v2`.
8. **C5/H6** — decide whether SEED lives or dies; if it lives, call the session endpoints.
9. **H5, H7, M1, M2** — buffer flush hook, remove hardcoded localhost, raise the 1-memory cap, fix Cohere `input_type`.
10. MEDIUM/LOW cleanup; delete Pinecone/Chroma/Valkey surface area.

**Safe commit boundary:** `5e3b9b9` remains clean. C4 lives entirely in `src/providers/openrouter/useProvider.ts` and `src/providers/sarvam/useSarvam.ts` — a fix touching only those two plus `src/runtime/RuntimeManager.ts` is independently committable. C1/C2 are single-line backend edits in `main.py` and `sync.py`, also independent. None overlap the other 214 modified files.

---

## 12. MEMORY ARCHITECTURE VERDICT

**ARCHITECTURALLY INCONSISTENT**

Not merely "broken" — broken implies one design failing to run. Here **three complete, mutually unaware memory architectures coexist**, each partially implemented, none authoritative:

1. **Backend pgvector** — correct schema, correct RPC, correct 768-dim cosine ranking, verified working in isolation. Its retrieval result is discarded by a BackgroundTask. Its write path throws `NameError` every call. Its retrieval endpoint isn't registered.
2. **Frontend localStorage** — tiers, TTLs, caps, dedup, scoring. The **only store that actually persists and retrieves** in production — by accident, because it's the fallback that engages when the Supabase health ping fails.
3. **Seed/crystallization** — two competing formats (`AuraSeed`, `SeedData`), a bridge between them, a backend generator, a table. Zero callers on either side.

The disqualifying evidence is not any single bug but the pattern: **every failure is silent.** `except Exception: pass` at `chroma.py:305`, `sync.py:159`, `memory_endpoints.py:172`; `!res.ok → return []` at `memory-gateway.ts:171`; a 404 route indistinguishable from an empty result; `NameError` logged as `memory_buffer_failed` while the write actually succeeded. The system reports health while storing nothing retrievable. `/health` says `"active_vector_store": "supabase_pgvector"` — literally true, completely misleading, since nothing in production reads from it.

Two of three providers cannot complete a turn (C4). The third never receives per-turn memory. The authoritative store is unreachable from the client. The durable layer's two Render services are a 1-byte file and a module with no entrypoint.

Worth preserving: the pgvector schema and `match_memories_v2` scoring; the LIVE layer (`observe_turn_live` → `aura_storage`, the one end-to-end path that works); the degradation/circuit-breaker design; the embedding fallback chain; the consolidator's soft-delete/purge logic. The foundations are sound. The wiring between them is not.
