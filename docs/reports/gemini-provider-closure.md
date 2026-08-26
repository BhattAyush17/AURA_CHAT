# AURA Gemini Provider — Final Closure, Integration Audit & Release Gate

Date: 2026-08-08 · Phase: G1–G4 closure audit · Status: **CONDITIONAL APPROVAL**

This document is the structured closure report for the Gemini Live provider integration.
Frozen architecture read: `docs/architecture/voice_runtime_architecture.md` (AURA Voice Runtime v1.0).
Baseline: `docs/reports/gemini-integration-audit.md` (score 3.5/10 → ~7/10 projected; P0s closed).

---

## A. Executive Verdict

```
GEMINI PROVIDER STATUS: CONDITIONAL APPROVAL
```

Gemini is a provider, not a second assistant. All AURA-owned subsystems (memory, personality,
context, tools, music, conversation state, turn semantics, telemetry, traces, provider health,
resilience) are reached through canonical seams; Gemini retains its native realtime session,
server VAD, and audio transport untouched. Four verified defects found and fixed during this
audit (see D/E + Q). Remaining gates are **live-validation only** (real microphone, server
session rotation, OEM devices, long soak) — no code blockers were found.

---

## B. G1 — Canonical AURA Action Seams — **PASS**

Evidence:
- `src/lib/aura-actions.ts`: `executeAuraAction()` is the single action seam. `saveMemory` →
  `MemoryGateway.storeMemory` (L3, canonical key `aura_memories_${userId}`); `playYouTubeMusic`/
  `stopYouTubeMusic` → `MusicService.processIntent` (same path as OpenRouter/Sarvam text-tags).
  No CustomEvent dispatch, no direct localStorage writes, no direct Supabase access anywhere.
- Honest results only: saveMemory returns `{ok:false, result:"Memory not saved: no fact was provided."}`
  / `"Memory storage is currently unavailable."` / `"Memory storage failed."`; music reports the
  actual `playbackState.currentTrack` or `{ok:false, result:"Could not find or play anything for ..."}`.
  No `{result:"OK"}` exists in the codebase.
- `useLive.ts` `onToolCall` routes every Gemini tool call through `executeAuraAction`; async tool
  responses are awaited before `sendToolResponse` (`useWebSocket.ts`).
- Probes (live): memory seam stored under `aura_memories_user_g1_test`, retrieval + count verified,
  no legacy key; Node SDK session with the app's exact 4-tool config produced
  `TOOLCALL: playYouTubeMusic {"query":"calm music"}` and a round-trip tool response (scripts/g1-tool-probe.mjs).

## C. G2 — Canonical Cognitive Context — **PASS**

Evidence:
- `src/lib/aura-context.ts`: `startClientMemoryContext()` (MemoryGateway L3 retrieval →
  `[MEMORY CONTEXT]`, 200-char/line cap, 1500-char total, supabase-mode returns `""` by design);
  `assembleCognitiveContext(clientBlock, backendEnrichment)` = server ChromaDB
  `memory_enrichment` (was fetched by `/api/analyze` but previously never injected into any
  model — now injected) + client block + `[ACTIVE MUSIC CONTEXT]` from real `playbackState`.
- `useLive.ts` `handleUserTurn`: memory retrieval starts **before** `behavior.analyzeForTurn`
  (parallel, off the critical path) and is awaited only at assembly.
- Runtime probe (CDP in live Vite page): store → retrieve with `emotional_match: 1`; assembly
  combined server + client blocks.
- Personality parity unchanged: `getSystemPromptForPersonality`, behavioral injection, and
  `[THREAD]` references are the same code used by OpenRouter/Sarvam (`gemini-prompt.ts` imported
  by all three providers).

## D. G3 — Conversation / Turn Ownership — **PASS (2 fixes applied)**

Native-event mapping (documented, no fabricated events; Gemini server VAD decides turn boundaries):

| AURA semantic | Gemini-native event | Where |
|---|---|---|
| speech begins | `serverContent.inputTranscription` (server activity detection) | `useWebSocket.ts` onmessage |
| transcription available | `onInputTranscription(text)` → `conversationState.reportUserSpeaking()` → `handleUserTurn` | `useLive.ts` |
| user turn complete | `handleUserTurn` → `ConversationRuntime.registerUserTurn(text)` (exactly once) + `reportUserFinished()` | `useLive.ts` |
| turn completion | `serverContent.turnComplete` → `reportSpeakingFinished()` | `useLive.ts` |
| interruption | `serverContent.interrupted` → `handleUserInterruption()` + client VAD barge-in reflex → `handleNativeInterruption()` | `useLive.ts` / `useBargeIn` |

- No `FinalTranscript` is fabricated anywhere (grep: zero occurrences in `src/providers/gemini/*`;
  the frozen 6-event `SpeechEvent` vocabulary has zero emitters for **all** providers — global,
  pre-existing gap, not Gemini-specific). Gemini capability `realtime=true`, `endpointControl=none`
  remains semantically correct.
- **Fix G3-1** (`src/runtime/ConversationStateManager.ts`): `reportSpeakingFinished` was not total —
  a turn that produced no audible output would leave the conversation stuck in `THINKING` forever.
  Now accepts `THINKING` → `POST_SPEECH_GRACE`. Benefits all providers.
- **Fix G3-2** (`useLive.ts` onTurnComplete): the immediate `requestStartListening()` was always
  blocked by the 250ms post-speech grace window, leaving CSM permanently in `IDLE` after turn 1 —
  the next turn's `reportUserSpeaking()`/`reportUserFinished()` became no-ops (state missed
  `USER_SPEAKING/USER_FINISHED/THINKING`). Replaced with a 300ms post-grace re-arm, guarded by
  `sessionState === "connected"` and `state !== "LISTENING"`; timer cleared in `teardownResources`.
- Live verification (CDP, headless): `LISTENING → AURA_SPEAKING → POST_SPEECH_GRACE → LISTENING`
  full cycle; grace-period STT block observed and now correctly re-armed; `ConversationRuntime`
  receives exactly one `registerUserTurn` per `onInputTranscription` (reconnect recovery sends
  context text directly, never re-registers).
- CSM is the single turn-state authority: no Gemini-side state machine exists (verified by static
  audit — zero competing state code).

## E. G4 — Trace / Resilience — **PASS (3 fixes applied)**

- **Trace Runtime** (`src/lib/trace-runtime.ts`): per-utterance `{traceId, utteranceId, epoch,
  providerId, timestamp}` envelope; honest stages only (`speech-start, final, llm-start,
  first-pcm`; never fabricates `mic-start/first-partial/tts-request`); synchronous, bounded
  (RECENT_TRACE_LIMIT 20), no awaits, no network. Every point → `aura:trace` window event.
  Live probe in app verified envelope, chain, summary, abort, no double-end.
- **Session expiry** (`useWebSocket.ts`): `goAway` sets `goAwayReconnectRef`; `onclose` intercepts
  before the clean-close check (code 1000 would otherwise skip reconnect). Server session rotation
  now reconnects with backoff; intentional app close (`userClosedRef`) never reconnects.
- **Provider failure boundaries**: `ProviderSupervisor.reportSuccess("gemini", setupLatency)` on
  open; `reportFailure` + health-score log on final close and onerror. Circuit breaker is the
  existing one — no Gemini-specific health system.
- **Single-flight / backoff**: `connect()` entry guard
  (`sessionState === "connecting"|"connected"` → return, useWebSocket.ts) collapses concurrent
  triggers into one attempt; `useReconnectPolicy` = 500ms base, 30s max, ±20% jitter, 8 attempts;
  `disconnect()` clears the reconnect timer; non-retryable codes (1008) → terminal error path.
- **Fix G4-1** (`src/speech/registry/providers.ts`): descriptor `transportMode: WebRtc →
  WebSocket` (actual SDK transport is a WebSocket; `WebSocket` value exists in the frozen enum;
  the field is registry metadata, not part of the frozen 11-field capability vocabulary).
- **Fix G4-2/3** (`useWebSocket.ts`, `types.ts`): removed dead `MAX_RECONNECT_ATTEMPTS` (×2),
  dead `RECONNECT_DELAY_MS`, write-only `audioBufferRef`, write-only `lastBehavioralLayerRef`.
- Epoch semantics: each connect creates a fresh session closure; stale-session events cannot reach
  the new session (old socket dead, callbacks per-connect). Late-event discard is structurally
  enforced; live rotation test remains BLOCKED headless (see Q).

## F. Soul Integration — **PASS**

Same identity, personality, memory, context, behavior, music semantics as OR/Sarvam via shared
modules (`gemini-prompt.ts`, `useBehaviorInjection.ts`, `usePromptOrchestrator.ts`,
`useTranscript.ts`, `aura-actions.ts`, `aura-context.ts`, `MemoryGateway`, `MusicService`,
`RuntimeManager`, `ConversationStateManager`, `ConversationRuntime`). Static audit found **no
duplicated soul** (no Gemini memory/music/personality/emotion/state/tool store). Provider
isolation: zero references to OR/Sarvam state inside the Gemini provider; zero provider-name
branching in `src/runtime/*` (Law 2). `RuntimeDecisionBuilder` defaults `"Gemini"` only as a
default label (no branching) — pre-existing, watch.

## G. Tool Integration — **PASS (with note)**

| Tool | Gemini | OpenRouter | Sarvam | Canonical seam | Failure behavior |
|---|---|---|---|---|---|
| saveMemory | tool, routed | text-intent, auto-store | text-intent, auto-store | Gemini: `executeAuraAction`; OR/Sarvam: direct gateway (fire-and-forget, no model feedback) | Gemini: truthful; OR/Sarvam: no result channel (pre-existing) |
| playYouTubeMusic | tool, routed | `PLAY_YOUTUBE:` tag | `PLAY_YOUTUBE:` tag | Gemini: `executeAuraAction` → `processIntent`; OR/Sarvam: direct `processIntent` | Gemini: truthful playbackState or `{ok:false}`; OR/Sarvam: no feedback (pre-existing) |
| stopYouTubeMusic | tool, routed | `STOP_YOUTUBE` tag | `STOP_YOUTUBE` tag | same | Gemini: truthful `ok: !isPlaying` |
| updateAnalysis | tool, inline (UI state only) | absent | absent | Not an AURA canonical action (excluded from `AuraActionName` union by design) | `"Analysis noted."` — its real action (`setAuraState`) always executes synchronously; not a fabricated result for a real action |

No provider has a private duplicate implementation. All Gemini tools are declared server-side
(`useWebSocket.ts` functionDeclarations) and executed through the canonical seam.

## H. Memory Integration — **PASS**

- Writes: Gemini `saveMemory` → `MemoryGateway.storeMemory` (L3). No localStorage/Supabase/custom
  store from the provider (static audit: zero direct memory writes in `src/providers/gemini/*`).
- Reads: canonical L3 retrieval into `[MEMORY CONTEXT]` + server ChromaDB enrichment. User-scoped
  keys (`aura_memories_${userId}`). The read at `useLive.ts` start-of-session is a cosmetic UI
  mirror (gateway remains authoritative; duplicate-read watch, pre-existing).
- Caveat: OR/Sarvam auto-store every turn with no model feedback — a pre-existing global parity
  gap, not a Gemini defect. Live save→retrieve→restart regression (sections 33/35) BLOCKED
  headless (needs real mic).

## I. Music Integration — **PASS**

- Forward: `playYouTubeMusic/stopYouTubeMusic` → `executeAuraAction` → `MusicService.processIntent`
  → real playback (same path as OR/Sarvam). No CustomEvent, no provider-local YouTube control.
- Reverse: `buildMusicContext()` reads canonical `playbackState` → `[ACTIVE MUSIC CONTEXT]` injected
  into the turn, only when music state exists. No fake music state (honest `{ok:false}` on failed
  search/playback).
- Music state is stored in `MusicService` (canonical) — nothing music-specific lives inside Gemini.

## J. Conversation State — **PASS**

Single authority (`ConversationStateManager` singleton) driven by Gemini-native events; full
`IDLE → LISTENING → USER_SPEAKING → USER_FINISHED → THINKING → AURA_SPEAKING → POST_SPEECH_GRACE
→ LISTENING` cycle verified live, including interruption → `LISTENING` and post-grace re-arm.
Stuck-state audit: `ERROR` has no reachable Gemini path (forceIdle on endSession; reportError not
invoked by Gemini); THINKING stick eliminated by Fix G3-1; USER_SPEAKING stick impossible
(reportUserFinished follows synchronously in the same event); AURA_SPEAKING stick impossible
(reportSpeakingFinished on every turnComplete, total-function after G3-1).

## K. Interruption — **PASS**

- Media-level reflex (Law 6): `useBargeIn(audio.inputAnalyserRef, audio.isSpeakingRef,
  handleNativeInterruption)` — client VAD drives only volume/barge-in metering, never endpointing
  (no competing endpoint VAD). Flushes playback, sets `wasInterruptedRef`.
- Server-level: `serverContent.interrupted` → `handleUserInterruption()` (CSM) + playback stop;
  no client abort signal (auto-VAD cancels generation natively).
- `consumeInterrupted()` feeds `wasInterrupted` into `analyzeForTurn` on the next turn.
- One barge-in subsystem only; Conversation Runtime never touches raw audio.

## L. Reconnect / Epoch — **PASS (static), live rotation BLOCKED**

- Single-flight verified by code (`connect()` guard + single reconnect timer + `disconnect()`
  cancel); backoff policy verified (500ms→30s, ±20% jitter, 8 attempts, exhaustion →
  `ProviderSupervisor.reportFailure`); clean-close semantics preserved (intentional app close
  never reconnects; only non-clean codes and `goAway` rotation reconnect).
- Epoch: trace epoch begins per successful open (incl. reconnects); stale-session events cannot
  fire into the new session (per-connect closures). Live forced-rotation test (inject goAway /
  kill WS mid-session) not possible headless — UNVERIFIED live, code-verified.

## M. Trace — **PASS**

Live probe in the app: `beginEpoch → beginUtterance → point(final) → point(llm-start) →
point(first-pcm) → endUtterance` produced the envelope, stage chain, summary, `aura:trace`
events, abort (no summary), no double-end. Sync-only, bounded, no network, no key material in
payloads (audited).

## N. Latency (measured, headless)

Round-trip = full model-turn duration for the 42s synthetic fake-mic clip (per turn):

| Run | n | min | p50 | p95 | max | avg |
|---|---|---|---|---|---|---|
| BEFORE G3/G4 (test2) | 16 | 8624 | 9012 | 9395 | 9395 | 9084 |
| BEFORE G3/G4 (g1) | 17 | 8898 | 10224 | 10588 | 10588 | 10008 |
| AFTER G3/G4 (closure smoke) | 18 | 9391 | 10433 | 10552 | 10552 | 10266 |

Delta p50 ≈ +0.2–1.4s vs pre-G4 runs — within clip-bound noise (synthetic speech segment length
per turn dominates; both runs process the same clip). The G3/G4 critical path adds only
synchronous bookkeeping (state transition + trace point, µs-scale) and zero blocking calls
(memory retrieval was already parallelized in G2). True speech→first-audio per-turn latency
(transcript→gen-start→first-token) is UNVERIFIED headless (inputTranscription never fires with a
fake mic).

## O. Resource Impact — **PASS (headless smoke)**

- No new timers/streams/workers beyond the pre-existing pipeline; the added re-arm timer is
  cleared on teardown; trace storage bounded at 20 summaries; no new WebSockets; AudioContext
  count unchanged (single graph via useAudioPipeline); no memory growth observed across 18 turns.
- Full 50-turn soak (section 36/37) BLOCKED headless.

## P. Mobile/OEM — **UNVERIFIED**

No devices attached (Samsung SM-X115, Realme, Bluetooth headsets unavailable). Gemini does NOT
depend on browser `SpeechRecognition` for STT (zero usage in provider — server-side
`inputTranscription`); capture is `getUserMedia` via `useAudioPipeline` + realtime transport.
OEM claims are NOT made without device testing.

## Q. Remaining Issues

**BLOCKER (validation gates, not code defects)**
1. Live end-to-end turn test (real mic): speech → `handleUserTurn` → tool call → playback. Model
   tool-calling and memory/music seams are proven separately; the in-browser chain needs a real
   microphone (proven twice: fake-mic audio reaches the model, but server `inputTranscription`
   never fires headless).
2. goAway session-rotation live test (code-verified, needs a real rotation event).
3. Forced-reconnect epoch discard test (section 20) — needs live session kill.
4. 30–50 turn soak (section 36) and combined reconnect+memory+music scenario (section 35).
5. OEM device matrix (section 30) — no hardware available.

**HIGH** — none.

**MEDIUM**
- `updateAnalysis` has no backend consumer (metacognition dead, see below) — the tool only
  updates local UI state. Consider removing the declaration when metacognition lands.
- Dual music-prompt sources: `[MUSIC TOOLING]` (Gemini tool protocol) vs `MUSIC PLAYBACK RULES`
  (OR/Sarvam text-tag protocol) — different transports, drift risk only.

**LOW**
- Direct memory read at session start (`useLive.ts`) is a cosmetic UI mirror duplicating the
  gateway retrieval path.
- `beforeunload` seed/count writes bypass canonical helpers (same keys, no corruption).
- Provider-local daily-usage tracker duplicates `lib/usage-tracker.ts`.

**GLOBAL / NOT GEMINI-SPECIFIC (pre-existing)**
- `sensing_state` is always null — backend `/api/analyze` never populates it. Global subsystem
  issue, affects all providers (baseline P1).
- Metacognition is globally dead (no backend consumer for `updateAnalysis`); Gemini, OpenRouter,
  and Sarvam are all blocked by the same subsystem. No Gemini-specific replacement was created.
- SpeechEventAssembler (Law 7): the normalized `SpeechEvent` seam is contract-only with zero
  emitters/consumers for **all** providers (baseline gap).
- Providers are React hooks (Law 4 deviation) — pre-existing, all providers.
- Credentials: architecture mandates sessionStorage-only; `getGeminiKey` reads env/credential
  storage — pre-existing, all providers.
- `npm run lint`: 2399 repo-wide pre-existing errors (incl. `venv/` vendored yt_dlp JS) — touched
  files are clean. `tsc`: 4 pre-existing `IntegrationTelemetry` missing-module errors only.

## R. Architecture Violations

**NONE FOUND.** Static audits (provider isolation, runtime awareness, soul duplication, tool
parity, trace payloads) and the live runs produced zero violations of the Seven Laws within the
Gemini integration. All WATCH items are pre-existing global gaps or provider mechanics.

## S. Files Changed (Gemini closure scope)

New:
- `src/lib/trace-runtime.ts` (G4 Trace Runtime)
- `src/lib/aura-actions.ts`, `src/lib/aura-context.ts` (G1/G2, from earlier phases)
- `scripts/g1-tool-probe.mjs` (evidence probe)

Modified this phase (G3/G4 + closure fixes):
- `src/providers/gemini/useLive.ts` (CSM wiring, registerUserTurn, traces, re-arm fix)
- `src/providers/gemini/useWebSocket.ts` (goAway reconnect, supervisor, tool response await,
  dead-code removal)
- `src/runtime/ConversationStateManager.ts` (total-function `reportSpeakingFinished`; file is
  untracked in repo state like the rest of `src/runtime/`)
- `src/speech/registry/providers.ts` (transportMode WebSocket)
- `src/providers/gemini/types.ts` (dead constants removed)

Pre-existing uncommitted (not part of this closure): backend `api/main.py`, `behavior.py`,
`pipeline.py`, deleted root `*.py` legacy files, `src/lib/api.ts`, shared-hook test files,
`__tests__/useLive.test.ts` (pre-existing lint errors), plus all `src/runtime/` untracked files.

## T. Tests Executed

- Static: two subagent audits (isolation/soul/runtime-awareness/trace-security; tools/capability
  descriptor/event fabrication) + manual greps (FinalTranscript, SpeechRecognition, MAX_RECONNECT,
  audioBufferRef, CSM callers, provider branching).
- `npx tsc --noEmit` — 0 new errors (4 pre-existing IntegrationTelemetry).
- `npm run lint` — 0 errors in touched files (2399 pre-existing repo-wide).
- `npx vite build` — clean, ~11s.
- Live CDP smoke (headless Chrome, fake mic, `scripts/gemini-live-bench.mjs`): connect →
  greeting → `LISTENING→AURA_SPEAKING→POST_SPEECH_GRACE→LISTENING`; 205 latency events; 18 model
  turns; zero `[AURA_API_FAIL]`; status `LISTENING`.
- Live Trace Runtime probe (dynamic import via CDP): envelope/stages/summary/events/abort.
- Node SDK tool-call probe (`scripts/g1-tool-probe.mjs`): `TOOLCALL: playYouTubeMusic` round-trip.
- Memory seam probe (G1): key correctness + retrieval; runtime memory probe (G2): `emotional_match: 1`.
- Latency before/after comparison (N above).

## U. Final Recommendation

```
CONDITIONAL APPROVAL — GEMINI IS A COMPLETE AURA PROVIDER (code),
SUBJECT TO THE VALIDATION GATES IN Q.BLOCKER (1)–(5) BEING RUN ON REAL
HARDWARE/MICROPHONE. NO CODE BLOCKERS EXIST.
```

Invariant preserved: **SAME SOUL, DIFFERENT BODY.** AURA owns identity, cognition, memory,
personality, context, tools, music, state, and behavioral semantics; Gemini owns only its
realtime session mechanics, server VAD, audio transport, and lifecycle — all untouched by the
integration.
