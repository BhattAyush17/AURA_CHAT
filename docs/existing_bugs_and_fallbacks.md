# AURA System — Bugs and Fallbacks Tracking

## Current Status: ✅ All Regressions + Hardening Complete

As of the 2026-05-19 production hardening pass. All 8 regressions + 12 hardening items resolved.

### Regression Audit Log (2026-05-19 — All Resolved)

---

### [BUG-R01] | RESOLVED ✅

- **Target:** `useVoiceOrchestrator.ts -> useVoiceOrchestrator()`
- **Pipeline Affected:** Both
- **Severity:** High (Memory leak — triple hook initialization)
- **Core Issue:** All three provider hooks were unconditionally initialized, tripling brain sub-hook and AudioContext allocation.
- **Fix Applied:** Orchestrator now passes `"__inactive__"` sentinel to non-active hooks. Each hook checks `isInactive` and skips cleanup registration, `startSession` guards, and resource-heavy initialization.

---

### [BUG-R02] | RESOLVED ✅

- **Target:** `backend/api/main.py:146 -> startup_event()`
- **Pipeline Affected:** Both (Backend)
- **Severity:** High (Blocks startup — broken import path)
- **Core Issue:** Three bare module imports (`behavior_engine_consumer`, `vocab_learner`, `relationship_tracker`) pointed to root ghost files instead of new `backend.*` paths.
- **Fix Applied:** Updated to `from backend.bus.consumer import run_behavior_consumer`, `from backend.core.vocab import set_vocab_learner_clients`, `from backend.core.relationship import RelationshipTracker`.

---

### [BUG-R03] | RESOLVED ✅

- **Target:** `backend/api/main.py:1084 -> __main__ block`
- **Pipeline Affected:** Both (Backend)
- **Severity:** Medium (Latent — local dev broken)
- **Core Issue:** `uvicorn.run("server:app")` still referenced old module path.
- **Fix Applied:** Changed to `uvicorn.run("backend.api.main:app", ...)`.

---

### [BUG-R04] | RESOLVED ✅

- **Target:** `src/providers/sarvam/useSarvam.ts:195 -> speakChunk()`
- **Pipeline Affected:** Path B (Sarvam)
- **Severity:** Medium (ArrayBuffer detach + GC stall)
- **Core Issue:** `decodeAudioData(bytes.buffer)` detaches the buffer in Chromium; `atob` loop is O(n) with temp string.
- **Fix Applied:** Replaced with `Uint8Array.from(atob(base64), c => c.charCodeAt(0))` and `bytes.buffer.slice(0)` to pass a safe copy.

---

### [BUG-R05] | RESOLVED ✅

- **Target:** `src/providers/sarvam/useSarvam.ts:551 -> MediaRecorder.onstop`
- **Pipeline Affected:** Path B (Sarvam)
- **Severity:** Medium (Race condition — STT silently dropped)
- **Core Issue:** If both Sarvam STT and browser STT returned empty, the turn was silently dropped.
- **Fix Applied:** Empty transcript now shows "Couldn't hear that, try again..." and auto-restarts the recognition cycle after 500ms instead of going idle.

---

### [BUG-R06] | RESOLVED ✅

- **Target:** `src/providers/sarvam/useSarvam.ts:432 -> drainQueue() -> speakChunk()`
- **Pipeline Affected:** Path B (Sarvam)
- **Severity:** Medium (False "speaking" UI state during TTS network fetch)
- **Core Issue:** `isSpeakingRef` was set before the Sarvam TTS network call completed, creating 200-600ms false speaking state.
- **Fix Applied:** `isSpeakingRef.current = true` and `setStatus("speaking")` moved to just before `source.start(0)`. `isSpeakingRef.current = false` added to `source.onended`.

---

### [BUG-R07] | RESOLVED ✅

- **Target:** `src/routes/index.tsx:42-44 -> needsSettings computation`
- **Pipeline Affected:** Path B (Sarvam)
- **Severity:** Low (Missing credential check)
- **Core Issue:** No validation for `VITE_SARVAM_API_KEY` — users could start Sarvam with only the LLM key, silently falling back to browser speech.
- **Fix Applied:** Added `getSarvamKey()` helper. `needsSettings` and `hasActiveBrainCredentials()` now require both OpenRouter AND Sarvam keys when `activeBrain === "sarvam"`.

---

### [BUG-R08] | RESOLVED ✅

- **Target:** `src/providers/sarvam/useSarvam.ts:571 -> recognition.onstart`
- **Pipeline Affected:** Path B (Sarvam)
- **Severity:** Low (MediaRecorder orphaned on restart)
- **Core Issue:** `MediaRecorder.start()` called without checking state — could throw if still recording from a previous cycle.
- **Fix Applied:** Added `mr.state === "inactive"` guard before `.start()`. Also reset `fallbackTranscriptRef` on each new recognition start to prevent stale transcript bleed.

---

## Historical Log (Resolved Issues)

### Backend Hardening (Pipeline Audit)

- **13.1 & 13.2 (memory_sync.py)**: `get_chromadb_enrichment` was completely broken. **Fixed** by rewriting as proper async functions delegating to `chroma_service`.
- **13.3 (behavior_engine_consumer.py)**: `t0` shadowing corrupted timing logs. **Fixed** by using `t_mem = time.monotonic()`.
- **13.4 (chroma_service.py)**: Embedding mismatch. **Fixed** by standardizing entirely to `gemini-embedding-001`.
- **13.5 (verify_pgvector.py)**: KeyError crash. **Fixed** by correcting the column mapping and applying the `sys.path` workaround to avoid Supabase CLI shadowing.
- **13.6 (relationship_tracker.py)**: `increment_session()` never called. **Fixed** by wiring it into `/session/start`.
- **13.7 (proactive_engine.py)**: `mark_return_greeting()` dead. **Fixed** by wiring into `/session/start`.
- **13.8 (server.py)**: Sync Supabase call blocking. **Fixed** by wrapping `SessionStore.get()` in `asyncio.to_thread`.
- **13.11 (context-budget.ts)**: Manager unused. **Fixed** by wiring into `useGeminiLive.ts` history truncation.
- **13.12 (memory_consolidator.py)**: No LLM summarization. **Fixed** by upgrading to `gemini-1.5-flash` async generation.
- **13.13 & 13.18 (cron automation)**: No Render cron for purging/consolidation. **Fixed** by modifying `render.yaml` to run `docs/scripts/run_consolidation.py --all --purge`.
- **13.14 (embedding_cache.py)**: Stats ephemeral. **Fixed** by migrating to Redis INCR commands.
- **13.15 (server.py)**: Rate limit bypass silent. **Fixed** by adding warning logs.
- **13.16 (memory_sync.py)**: RPC failure silent. **Fixed** by logging `rpc_missing` specifically.
- **13.17 (embedding_cache.py)**: Used stdlib logging. **Fixed** by swapping to structlog.
- **13.19 (proactive_engine.py)**: 60s TTL lost on restart. **Fixed** by bumping to 1-hour Redis TTL.
- **13.20 (behavior_engine_consumer.py)**: Missing Supabase client. **Fixed** by passing the client upon initialization.

### Frontend Voice Fixes (Gemini Live)

- **Voice Fix 1**: Model mismatch causing hang. **Fixed** by pinning `gemini-2.0-flash-exp` in `LIVE_MODELS`.
- **Voice Fix 2**: `onerror` endless spinner. **Fixed** by resetting state to `idle` upon error.
- **Voice Fix 3**: Connection timeout missing. **Fixed** by adding a 12s safety net.
- **Voice Fix 4**: Missing API key crashing silent. **Fixed** by actively validating length before connecting.
- **Voice Fix 5**: `bargeIn` null refs. **Fixed** by passing stable refs rather than `.current` into `useInterruptionHandler`.
- **Voice Fix 6**: `sendAudio` dead code. **Fixed** by removing the legacy block entirely.

---

### Production Hardening Pass (2026-05-19 — All Applied)

#### [HARDEN-01] | Type Safety ✅

- **Target:** `IVoicePipeline.ts` + `useVoiceOrchestrator.ts`
- **Issue:** `providerName` union missing `"sarvam"` — orchestrator used unsafe `as any` cast.
- **Fix:** Added `"sarvam"` to union type, removed cast.

#### [HARDEN-02] | Inactive Guard ✅

- **Target:** `useProvider.ts` (OpenRouter) — `startSession()`
- **Issue:** When `isInactive`, still set error/status state, leaking error UI to inactive provider.
- **Fix:** Added `if (!isInactive)` guard before `setLastError` and `setStatus`.

#### [HARDEN-03] | Memory Cap ✅

- **Target:** `useProvider.ts` + `useSarvam.ts` — message buffer
- **Issue:** `messages` state array grew unbounded during long sessions — memory leak.
- **Fix:** Capped at 50 messages via `addMessages()` helper that slices when exceeding cap.

#### [HARDEN-04] | Fetch Timeout (LLM) ✅

- **Target:** `useProvider.ts` + `useSarvam.ts` — `processTurn()`
- **Issue:** No timeout on OpenRouter API fetch — UI stuck in "thinking" forever on network hang.
- **Fix:** 15s `AbortController` timeout on each model attempt. `clearTimeout` in catch block.

#### [HARDEN-05] | Fetch Timeout (STT/TTS) ✅

- **Target:** `sarvamSTT.ts` + `sarvamTTS.ts`
- **Issue:** No timeout on Sarvam API fetches — could hang indefinitely.
- **Fix:** 10s `AbortController` timeout with graceful fallback (STT returns null → browser fallback; TTS returns null → `speakChunkNative`).

#### [HARDEN-06] | Mic Stream Leak ✅

- **Target:** `useProvider.ts` + `useSarvam.ts` — `endSession()`
- **Issue:** `teardownMicAnalyser()` not called in `endSession` — mic stream stayed open after session ended.
- **Fix:** Added `teardownMicAnalyser()` call and added it to dependency array.

#### [HARDEN-07] | MediaRecorder Cleanup ✅

- **Target:** `useSarvam.ts` — `endSession()`
- **Issue:** MediaRecorder not stopped/nulled on session end — could orphan recording state.
- **Fix:** Stop if not inactive, null ref, clear audio chunks array.

#### [HARDEN-08] | Dead Code Removal ✅

- **Target:** `useProvider.ts` + `useSarvam.ts` — `speakQueue()`
- **Issue:** `speakQueue` function defined but never called — dead code.
- **Fix:** Replaced with explanatory comment noting inline drain in `processTurn`.

#### [HARDEN-09] | LatencyMeter Key Check ✅

- **Target:** `LatencyMeter.tsx` — `getSarvamKey()`
- **Issue:** Only checked `VITE_SARVAM_API_KEY` env var, not `sessionStorage` where users actually save it.
- **Fix:** Check `sessionStorage` first, then env var fallback.

#### [HARDEN-10] | Hook Dependency Arrays ✅

- **Target:** `index.tsx` — `handleMicClick` + `handleAudioReset`
- **Issue:** `activeBrain` and `hasActiveBrainCredentials` used in closure but missing from deps — stale closure bugs.
- **Fix:** Added missing dependencies to both `useCallback` arrays.

#### [HARDEN-11] | Sarvam STT Dynamic Language ✅

- **Target:** `sarvamSTT.ts`
- **Issue:** `language_code` hardcoded to `"en-IN"`, model pinned to outdated `saaras:v1`.
- **Fix:** Language now reads from `aura_voice_language` setting; model upgraded to `saaras:v2`.

#### [HARDEN-12] | Sarvam TTS Dynamic Language ✅

- **Target:** `sarvamTTS.ts`
- **Issue:** `target_language_code` hardcoded to `"en-IN"` — Hindi users got English TTS.
- **Fix:** Language now reads from `aura_voice_language` setting dynamically.
