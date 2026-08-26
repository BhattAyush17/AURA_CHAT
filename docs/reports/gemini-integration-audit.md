# AURA × GEMINI — SOUL/PROVIDER INTEGRATION AUDIT

- Date: 2026-08-08
- Scope: Forensic, code-level integration audit of the Gemini Live pipeline (`src/providers/gemini/*`) against the full AURA cognitive/capability stack. Read-only — no code modified.
- Baseline: `docs/architecture/voice_runtime_architecture.md`, `docs/contracts/speech_events.md`, `docs/contracts/provider_capabilities.md`
- Model under test: `models/gemini-3.1-flash-live-preview` (post-upgrade)

---

## 1. EXECUTIVE VERDICT

**Gemini is NOT currently a true AURA provider. It is a second, independent assistant living beside AURA.**

The Gemini provider shares AURA's *prompt content* (personality prompt, seed, behavior text, cognitive directive strings) but does not participate in AURA's *runtime*: no Executive, no MemoryGateway, no ConversationStateManager, no Turn Engine, no AURA telemetry. Gemini decides everything itself inside its Live session. The "AURA SOUL = SOUL, PROVIDER = BODY" principle is structurally not violated by Gemini's realtime audio architecture (that part is valid and correct) — it is violated by the *soul itself* not being connected on the Gemini path.

**CURRENT GEMINI INTEGRATION SCORE: 3.5/10** (details in §30)

---

## 2. ACTUAL GEMINI ARCHITECTURE (what the code executes)

```
getUserMedia(16kHz)                                  useLive.ts:452+ (startSession)
  → AudioWorklet pcm-capture-processor.js (1024-smpl chunks, 64ms)
  → ws.sendRealtimeInput({audio: base64})            useWebSocket.ts (native realtime input)
  → gemini-3.1-flash-live-preview Live session       useWebSocket.ts:265 (ai.live.connect)
       ├─ config: Modality.AUDIO, server auto-VAD (HIGH start / LOW end, silence 1300ms)
       ├─ systemInstruction: personality+seed+[ADAPTIVE MIRRORING]+[INTERRUPTION BEHAVIOR]  useWebSocket.ts:284-293
       ├─ tools: saveMemory, updateAnalysis, playYouTubeMusic, stopYouTubeMusic  useWebSocket.ts:294-337
       └─ input/outputAudioTranscription: {} enabled
  ← serverContent: audio parts + output transcript → onModelText (useLive.ts:556+)
  ← inputTranscription → onInputTranscription → handleUserTurn (useWebSocket.ts:390 → useLive.ts:579)
  ← functionCall (tool calls) → handler (useLive.ts:585-618)
  ← audio out → WebAudio playback → speaker
```

Turn path (`handleUserTurn`, useLive.ts:335-419): server transcript → `RuntimeManager.processCognitiveTurn(text, result)` (:374) → cognitive directive string → `speechStyleDetector.detectStyle(text)` (:375) → style instruction → `behaviorText` (analyzeForTurn :348 / speculative :581) → layer-2 prepend on emotion change (:384-386) → single `ws.sendRealtimeText(turnText)` (:388). `[THREAD]` reference injected every 5 turns (:406-416). Greeting :509. Reconnect recovery via sendRealtimeText (~534).

Auth: header `x-goog-api-key` (SDK internal); key from `getGeminiKey` (`aura_gemini_api_key` / `VITE_GEMINI_API_KEY`). Model cascade `LIVE_MODELS = ["models/gemini-3.1-flash-live-preview"]` (types.ts).

---

## 3. AURA SOUL INVENTORY (operational status)

| Module | Status | Evidence |
|---|---|---|
| Executive (`src/executive/ConversationExecutive.ts`, 19 files) | OPERATIONAL but Sarvam-only | imported only by `src/providers/sarvam/useSarvam.ts`; ZERO refs in `src/providers/gemini/` |
| RuntimeManager (`src/runtime/RuntimeManager.ts`) | OPERATIONAL, Gemini-connected | `processCognitiveTurn` called at useLive.ts:374 |
| ConversationInterpreter (`src/runtime/conversationInterpreter/`) | OPERATIONAL via RuntimeManager | reached through processCognitiveTurn |
| validation suite (`src/runtime/validation/*`, 4 files) | DEAD / BROKEN | imports nonexistent `../integration/IntegrationTelemetry` (TS2307); nothing imports them |
| backend metacognition (`backend/core/pipeline.py`, ATF) | DEAD / BROKEN | `ModuleNotFoundError: backend.core.thought_field.Ecology` on import; never reachable |
| MemoryGateway (`src/lib/memory-gateway.ts`) | OPERATIONAL, NOT on Gemini path | openrouter:42,889,1503,1515; sarvam:38,1243,2174,2186; ZERO imports in `src/providers/gemini/` |
| StorageManager + BrowserAdapter | OPERATIONAL, Gemini-connected (seed only) | useLive.ts:74,225-233,477 (`loadSeed/saveSeed/load/save`, key `aura_storage_conversations`) |
| ConversationStateManager | OPERATIONAL, NOT on Gemini path | only `src/providers/sarvam/useSarvam.ts`, `src/providers/openrouter/useProvider.ts`; zero global subscribers |
| Turn Engine (conversationInterpreter + planners) | OPERATIONAL, partially reached | via RuntimeManager string injection; exact cross-brain wiring incomplete |
| Voice Orchestrator (`src/core/useVoiceOrchestrator.ts`) | OPERATIONAL, serves all | initializes RuntimeManager (:35); routes providers (:172) |
| Behavior client (`src/lib/behavior-client.ts`) | OPERATIONAL, Gemini-connected | analyzeForTurn :348, fireSpeculative :581; backend `analyzeBehavior` reachable |
| MusicService + QueueManager + PlaybackState + PlayerStateMachine | OPERATIONAL but ORPHANED on Gemini path | no listener for the events Gemini dispatches (§11) |
| PlaybackEngine (UI route) | DEAD | `setProvider()` never called anywhere; UI actions never reach MusicService |
| MusicSense | OPERATIONAL but unconsumed | collects; no consumer |
| Vision / VisionSense | NOT IMPLEMENTED | `src/vision/` — see §12 |
| ProviderRegistry / CredentialManager / ProviderHealth / VoiceSettings | OPERATIONAL | `src/lib/registry.ts`, `credentials.ts`; Gemini uses `getGeminiKey` (env/sessionStorage, outside CredentialManager) |
| Media Runtime / VAD / SpeechEventAssembler / Trace Runtime / Latency Budget | FROZEN (contracts); not runtime-executed by Gemini | Gemini uses own worklet + server auto-VAD + own state machine |
| FlightRecorder (`src/lib/flight-recorder.ts`) | DEAD | not imported by any provider path |
| ResilienceOrchestrator | OPERATIONAL (device scoring) | console: `[ResilienceOrchestrator] Started. Device score: 68` |
| ConversationTelemetry / IntegrationTelemetry | BROKEN | IntegrationTelemetry missing module; validation dead (§9) |

---

## 4. GEMINI INTEGRATION MATRIX

| AURA Soul Component | Gemini | OpenRouter | Sarvam | Correct State |
|---|---|---|---|---|
| Executive | BYPASSED (RuntimeManager string only) | PARTIAL (RuntimeManager string only) | FULL (ConversationExecutive imported) | All three through ONE AURA executive seam |
| Personality | PARTIAL (shared prompt + seed + mirroring block) | FULL (shared prompt) | FULL (shared prompt) | ONE authoritative personality source |
| Memory | BYPASSED (seed + broken local write) | FULL (MemoryGateway) | FULL (MemoryGateway) | MemoryGateway for all |
| MemoryGateway | MISSING (0 imports) | FULL (:889,1503,1515) | FULL (:1243,2174,2186) | Same |
| Context | PARTIAL (buildContext(mode) + THREAD refs) | PARTIAL | PARTIAL | AURA-owned context assembler |
| Emotion | PARTIAL (backend text analysis + raw audio; sensing_state null) | PARTIAL (acoustic XML) | PARTIAL (acoustic XML) | One AURA behavior pipeline |
| Behavior | PARTIAL (behaviorText injected) | PARTIAL | PARTIAL | Same |
| Metacognition | MISSING (not operational anywhere) | MISSING | MISSING | Operationalize or remove |
| Music | BROKEN (tools → zero listeners) | PARTIAL (processIntent → MusicService) | PARTIAL | AURA-owned music action seam |
| MusicSense | BYPASSED | BYPASSED | BYPASSED | Feed context to all |
| Vision | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | Future |
| Tools | PARTIAL (4 decls; 2 broken) | PARTIAL | PARTIAL | AURA-owned tool registry |
| Conversation State | DUPLICATED (own state machine; CSM bypassed) | FULL (CSM) | FULL (CSM) | CSM authoritative; Gemini keeps session mechanics |
| Turn Engine | PARTIAL (string directives) | PARTIAL | PARTIAL | Full normalization |
| VAD | PROVIDER-SPECIFIC/CORRECT (server auto-VAD = session mechanics) | AURA VAD | AURA VAD | Provider mechanics OK; AURA turn policy on top |
| Telemetry | PARTIAL (latency events, shadow timing) | PARTIAL | PARTIAL | One trace model |
| Resilience | PARTIAL (transport reconnect + cascade) | PARTIAL | PARTIAL | One resilience policy |

---

## 5. EXECUTIVE AUDIT

**Real path for Gemini:**
```
USER → Gemini Live → inputTranscription → handleUserTurn
  → RuntimeManager.processCognitiveTurn(text, result)   useLive.ts:374
  → ConversationInterpreter.processTurn
  → returns "[COGNITIVE ORCHESTRATION]..." + "[HUMAN EXPRESSION ARCHITECTURE]..." STRINGS
  → prepended to turn text → sendRealtimeText → Gemini
```

**What is real:** `processCognitiveTurn` executes and its directive string reaches Gemini (verified at useLive.ts:374 → :383-388). RuntimeManager registers the user turn (:82).

**What is fake:** `RuntimeManager.evaluateDecision(...)` returns void and only feeds HRTE shadow telemetry (console: `[SHADOW TIMING] ... HRTE: 300ms`). There is NO decision gate — Gemini is never told "respond this way" vs "do not respond". The cognitive result is advisory prose, not executive control. The `ConversationExecutive` class (src/executive/) is Sarvam-only.

**Verdict: scenario B** — "Gemini decides everything" is the real execution model. AURA contributes prompt-text enrichment, not decisions.

---

## 6. MEMORY AUDIT

**AURA → Gemini (retrieval):** `MemoryGateway.retrieveMemories`/`formatForPrompt` NEVER called on the Gemini path (0 imports of memory-gateway in `src/providers/gemini/`). Gemini receives:
- Seed block (localStorage `aura_seed_${userId}`) via StorageManager — useLive.ts:225-233 (mounted into systemInstruction as `seedBlock`, useWebSocket.ts:288)
- Session history natively inside the Live session (128k window)

**Gemini → AURA (write):**
- `saveMemory` tool → `addMemory` → `localStorage.setItem("aura_memories", ...)` (useLive.ts:109,117)
- Reader (`src/lib/local-memory.ts:62`) reads `aura_memories_${userId}` → **KEY MISMATCH — writes are never read; saved memories are orphaned.**
- Per-turn history saved via StorageManager (`aura_storage_conversations`) at useLive.ts:228,232,477 (session-scoped, not L3 memory).

**Consequence:** Gemini bypasses MemoryGateway entirely. Long-term memory for Gemini users never persists in the AURA memory system (and even the local fallback is broken by the key mismatch). `[MEMORY CONTEXT]` blocks that OpenRouter/Sarvam users get from `formatForPrompt` never appear for Gemini.

---

## 7. PERSONALITY / CONTEXT AUDIT

**Personality — mostly shared, correct:**
- `getSystemPromptForPersonality(activeOpts.personality, activeOpts.seedBlock)` (useWebSocket.ts:288) — same authoritative prompt source as OpenRouter/Sarvam (`src/lib/gemini-prompt.ts`).
- Gemini adds `[ADAPTIVE MIRRORING]` + `[INTERRUPTION BEHAVIOR]` blocks (:289-290) — provider-native, justified (language mirroring for a speech session; interruption behavior for auto-VAD). Correct provider-specific addition.

**Context — partial:**
- `prompts.buildContext(currentMode)` (useLive.ts:372) → per-mode context block → sent as mid-session realtime text with every turn (:383).
- `[THREAD]` reference every 5 turns (:406-416) — lightweight topic continuity.
- `[MUSIC CONTEXT]` PROMISED BUT NEVER INJECTED: `gemini-prompt.ts` states *"When music is active, you will see [music state] in your context — use it to enrich your responses"* — nothing ever injects music state into any provider's context (Gemini, OpenRouter, Sarvam). The model is told about a context field that never arrives.

**Duplication:** personality content is assembled per-provider (Gemini: `getSystemPromptForPersonality` + local mode blocks; Sarvam/OpenRouter: same source). Minor duplication, same source of truth — acceptable.

---

## 8. EMOTION / BEHAVIOR AUDIT

**Raw audio → Gemini's own model:** real — the Live session is audio-in/audio-out; the model perceives prosody natively.

**Audio → AURA behavior → structured evidence → Gemini:** PARTIAL.
- `analyzeForTurn(audio.currentRmsRef, pauseSinceLastTurnRef)` at useLive.ts:348 → `behavior-client.analyzeBehavior(text)` → backend HTTP `analyzeBehavior` → **text-only regex analysis** (server code, main.py) → `behaviorText` injected into turn text (:383). Sensing_state: backend sets `sensing_state=None` in eager path (main.py:530,622) → `useResponseTiming` always sees null → defaults. Line 873-874 (where sensing_state is built) is inside the broken pipeline.py path — unreachable.
- Speculative analysis on every input transcription (:581) — runs in parallel, does not block the turn.
- `speechStyleDetector.detectStyle(text)` (:375) → style instruction block (:377) — server-side text analysis.
- Acoustic XML (pitch/energy/rate) is generated for OpenRouter/Sarvam only; Gemini never receives it.
- `emotion_sounds` assets are paralinguistic TTS clips — not used by Gemini (used by OR/Sarvam paths).

**Verdict:** Gemini receives AURA *text-based* behavior enrichment, never acoustic emotion evidence; the model's own audio perception is the dominant emotion channel. `updateAnalysis` tool is UI-only state (useLive.ts:590-597).

---

## 9. METACOGNITION AUDIT

**"There is currently no operational metacognition runtime to integrate."**

- `src/runtime/validation/*` (4 files) import `../integration/IntegrationTelemetry` which does not exist → TS2307, dead on import; zero importers.
- `src/lib/aura-psyche.ts`, `src/lib/prompt-cache.ts` exist but are not on any provider runtime path.
- Backend `pipeline.py` (where metacognition/ATF/sensing_state logic lives) fails to import: `ModuleNotFoundError: No module named 'backend.core.thought_field.Ecology'`.
- `ConversationTelemetry`/`IntegrationTelemetry` — the module validation imports is missing from the repo.

No artificial Gemini gap exists here — the subsystem itself is not operational for ANY provider. This is a P3 global cleanup (operationalize or remove), not a Gemini integration defect.

---

## 10. MUSIC AUDIT

**Gemini request direction (USER: "Play something calm."):**
```
USER → Gemini Live → model calls playYouTubeMusic(query)
  → useLive.ts:598-608 handler
  → console.log("[AURA] 🎵 Playing YouTube Music: ...")
  → window.dispatchEvent(new CustomEvent("playYouTubeMusic", {detail: query}))   :602
  → ???
```
**The ??? is empty.** `rg "playYouTubeMusic|stopYouTubeMusic" src/` matches ONLY the two dispatcher files (useWebSocket.ts declarations, useLive.ts handler). **ZERO `addEventListener` anywhere in the app.** MusicService (src/music/) never receives the event. The model gets `{result: 'Playing "…" on YouTube now.'}` — a lie; nothing plays.

**Reverse direction (playback state → Gemini):** `[MUSIC CONTEXT]` promise in gemini-prompt.ts is never fulfilled (see §7). No playback state ever reaches Gemini.

**Parallel engine audit:** `useMusicPlayer` routes UI actions through `playbackEngine`; `PlaybackEngine.setProvider()` is NEVER called → UI play/pause/queue controls reach nothing. MusicService (which CAN actually play via hidden YouTube IFrame) is reachable only through OpenRouter/Sarvam `processIntent` paths. So: TWO broken paths (Gemini events → nobody; UI → dead engine), ONE working path (OR/Sarvam intent → MusicService).

**Live evidence (2026-08-08, headless):** 42s of repeated synthetic speech "Please play something calm on YouTube for me" → 16 model turn round-trips → **zero tool calls** (no 🎵 log, no dispatch, no playback). Combined with the static zero-listener proof, the Gemini music path is decisively BROKEN.

---

## 11. VISION AUDIT

**Not implemented.** The Live session is audio-only (responseModalities: [Modality.AUDIO], useWebSocket.ts:268). No camera, no image capture, no frame injection anywhere in `src/` (no VisionSense content, no `getUserMedia({video})` calls outside of nothing). Vision is a P4 future capability for ALL providers. Gemini's native multimodal realtime would actually be the most natural host when it arrives — but nothing exists today to audit or wire.

---

## 12. TOOLS AUDIT

Registered (useWebSocket.ts:294-337): `saveMemory`, `updateAnalysis`, `playYouTubeMusic`, `stopYouTubeMusic`.

| Tool | Invocation | Execution | Reaches real system? |
|---|---|---|---|
| saveMemory | works | localStorage `aura_memories` (:109) | **NO — key mismatch with reader `aura_memories_${userId}`** (local-memory.ts:62) |
| updateAnalysis | works | sets React state (UI-only) :590-597 | NO (no consumer) |
| playYouTubeMusic | never fired in live test; if fired → dispatch | CustomEvent :602 | **NO — zero listeners** |
| stopYouTubeMusic | same | CustomEvent :613 | **NO** |

Tool ownership rule: **AURA owns action semantics; Gemini requests them.** Today Gemini requests actions that AURA's runtime never executes. The minimum fix is a listener seam (or routing the event into MusicService's existing command path) + fixing the memory key.

---

## 13. CONVERSATION-STATE AUDIT

**Duplicate ownership confirmed:**
- AURA: `ConversationStateManager` (src/runtime/ConversationStateManager.ts) — imported ONLY by sarvam/openrouter; zero global subscribers even there; Gemini: not imported.
- Gemini: owns its own session state machine (`wsState`/`sessionState` refs, `transition()`, `useStateMachine`) + server-side auto-VAD turn detection.

**AURA vs Gemini disagreement risk:** AURA UI status (listening/thinking/speaking) is driven by Gemini's own callbacks (onStatusChange("listening") useWebSocket.ts:354); AURA's ConversationStateManager is not in the loop, so no contradiction is *currently possible* only because AURA state is not exercised on this path at all. Per §16-17 of the architecture: Gemini's session mechanics (server VAD, session state) are a VALID provider-native exception. What is missing is an AURA turn-policy layer on top (e.g., cooldown, topic state, initiative) — not present for Gemini.

---

## 14. VOICE RUNTIME AUDIT

Frozen contracts (voice_runtime_architecture.md) vs Gemini reality:

| Contract | Gemini reality | Verdict |
|---|---|---|
| Media owns physical sound | ✓ own worklet/playback | CORRECT |
| Conversation never knows provider identities | ✗ turn path is provider-internal | BYPASSED |
| Turn Engine owns turn state | ✗ Gemini server VAD + own refs | BYPASSED (provider mechanics ok, AURA policy absent) |
| Providers framework-free | ✓ (hooks + ws lib) | CORRECT |
| One Media-owned Silero VAD | ✗ server auto-VAD + worklet noise gate | ACCEPTABLE (native realtime) — must document as exception |
| SpeechEventAssembler normalization | ✗ raw callbacks (inputTranscription/outputTranscription/functionCall) | PARTIAL — semantic contract equivalent exists (turn-complete/interruption events), no FinalTranscript (correct: do not fake) |
| Transport Session Manager | ✗ bypassed (own connect/reconnect/cascade) | PARTIAL — should adopt for connection-state/retry/epoch mechanics |
| Trace Runtime | ✗ no traces | MISSING |
| Latency Budget | ~ (measurements exist; budget contract not enforced) | PARTIAL |

---

## 15. REALTIME-PROVIDER COMPATIBILITY

`ProviderRuntimeClass = cloud`, `TransportMode = realtime-session`, `realtime = true`, `audioInput = true`, `audioOutput = true`, `endpointControl = none` — all consistent with actual behavior and with the frozen contracts' spirit (the architecture explicitly makes realtime providers first-class; SpeechEventAssembler must accept session events; fake FinalTranscripts are prohibited — correctly absent).

The seam lives at: **the turn/text boundary** — AURA assembles context → hands normalized turn content to the provider; provider hands AURA normalized session events (turn complete, transcript, tool request, interruption). That seam currently exists in code but is thin: AURA enrichment is inlined into text, and provider events are consumed provider-internally.

---

## 16. FAILURE / FALLBACK AUDIT

| Failure | Gemini behavior (code + measured) | Remains alive? |
|---|---|---|
| Model rejected/exhausted | cascade `LIVE_MODELS` → `All models in cascade exhausted.` (measured: 1008 × 2.5-flash) | ✗ session dies; no cross-provider fallback |
| Connect timeout | connectTimeoutId → cleanup | partial |
| Server goAway | closes session (:362-367), NO auto-reconnect logic → user must restart | partial |
| Network drop | transport-level reconnect recovery via sendRealtimeText (~534) | partial |
| API key invalid | 1007 abort (measured) | ✗ |
| Microphone/audio fail | no explicit handling beyond AudioContext resume (:736) | partial |
| AURA cognitive fail | analyzeForTurn wrapped in try/catch → falls back to raw text (:395-401) | ✓ Gemini stays usable |
| Tool execution fail | tool returns `{result:"OK"}` regardless (:617) — failure invisible | ✗ silent lie |

**Desired principle violated:** Gemini failure ≈ partial AURA failure because there is no cross-provider swap (e.g., fallback to OpenRouter) and no AURA resilience policy on this path. `ResilienceOrchestrator` scores devices but doesn't gate provider choice for Gemini.

---

## 17. LATENCY CRITICAL PATH

```
speech → server VAD → inputTranscription (server-side)
  → handleUserTurn
    → analyzeForTurn (sync backend text analysis — BLOCKING)        useLive.ts:348   CRITICAL PATH
    → RuntimeManager.processCognitiveTurn (sync string assembly)    :374            CRITICAL PATH (small)
    → detectStyle (sync)                                            :375            CRITICAL PATH
    → sendRealtimeText                                              :388
→ model generation → audio → speaker
```

Classification:
- analyzeForTurn (backend HTTP round-trip on the turn path when autoAudioTurn is on): **CRITICAL PATH — the single largest avoidable tax.** Speculative analysis runs in parallel (:581) but the authoritative path still awaits the backend.
- processCognitiveTurn/detectStyle: string assembly, milliseconds — fine.
- Memory retrieval: **absent** (not a tax, but also not enrichment).
- Personality/seed: assembled at connect time only — negligible.
- Telemetry/latency emits: async window events — PARALLEL.
- getResponseDelay (useResponseTiming :156,:539): sensing_state always null → constant defaults; adds a fixed post-first-audio delay per turn — small, currently deterministic.

**Measured (headless, gemini-3.1, 2026-08-08):**
- connect+setup: 548ms (run after-2), 795ms (cold music run)
- greeting → firstToken: ~1.2s (both runs)
- response delay applied: 245–279ms
- output chunk interval: 64ms nominal (170.9ms observed max gap in music run)
- 16 full turn round-trips over 42s of continuous speech (real-time steady state, no accumulation) → realtime path stable under load.

**AURA SOUL ≠ LATENCY TAX:** currently false in exactly one place — the synchronous backend behavior analysis on the turn path. Everything else is parallel or negligible.

---

## 18. PROVIDER-INDEPENDENCE AUDIT

**Test: replace Gemini with OpenRouter. What AURA functionality changes?**
Today: everything cognitive changes (memory, music, conversation state, telemetry) because Gemini bypasses all of it. **The test FAILS.**

**Test: Gemini unavailable tomorrow — do OR/Sarvam keep the same soul?**
Yes — they are wired to MemoryGateway/CSM/Executive/MusicService. **This asymmetry is the core defect.**

**Couplings found (Gemini-specific logic that should be AURA-owned):**
1. Personality/seed/mode context assembly inside useLive/promptOrchestrator (acceptable partial duplication — same prompt source).
2. Behavior injection duplicated per provider (behavior-client shared; injection site provider-local).
3. Music events as window CustomEvents with zero consumers — should be an AURA music command seam.
4. localStorage memory write with its own (broken) key — should be MemoryGateway.
5. Own reconnect/cascade — should adopt Transport Session Manager mechanics.

---

## 19. DUPLICATED / BYPASSED AURA LOGIC

| Item | Status |
|---|---|
| ConversationStateManager | BYPASSED by Gemini (duplicated own state machine) |
| MemoryGateway | BYPASSED by Gemini (seed + broken local write) |
| Executive (class) | BYPASSED by Gemini (RuntimeManager string only) |
| MusicService command seam | BYPASSED (events → zero listeners) |
| PlaybackEngine (UI) | DEAD (setProvider never called) — redundant parallel engine |
| FlightRecorder | DEAD |
| validation suite | DEAD (missing IntegrationTelemetry) |
| backend pipeline.py/ATF | DEAD (Ecology import error) |
| sensing_state path | DEAD (pipeline.py unreachable → always null) |
| `[MUSIC CONTEXT]` promise | UNFULFILLED (prompt lies to the model) |
| saveMemory key | BROKEN (write/read mismatch) |

---

## 20. MUST / SHOULD / DON'T-TOUCH MATRIX

| Change | Gemini | AURA Core | Provider Layer | Required? | Risk |
|---|---|---|---|---|---|
| Fix saveMemory → MemoryGateway.storeMemory (or fix key to `aura_memories_${userId}`) | addMemory (:109) | — | — | MUST | Low |
| Route music tool events into MusicService command path (or add ONE listener seam) | handler :602/:613 | musicEvents bus | — | MUST | Low |
| Remove/fulfill `[MUSIC CONTEXT]` promise | — | gemini-prompt.ts | — | MUST | Low |
| MemoryGateway retrieval in context assembly (retrieveMemories + formatForPrompt prepend to buildContext) | context assembly | — | — | SHOULD | Med (async, off critical path) |
| Register Gemini turns with ConversationStateManager | handleUserTurn | CSM | — | SHOULD | Med |
| Push Gemini traces into AURA telemetry (conversation traces + turn events) | callbacks | telemetry | — | SHOULD | Low |
| Move backend behavior analysis off critical path (use speculative result; emit asynchronously) | useLive.ts:348 | behavior-client | backend | SHOULD | Med (latency win) |
| Operationalize or remove metacognition (validation suite, pipeline.py, IntegrationTelemetry) | — | runtime/validation, backend | — | SHOULD (P3 cleanup) | Low |
| Cross-provider fallback on cascade exhaustion (e.g., OR emergency) | reconnect | resilience | Transport Session Manager | SHOULD | Med |
| Keep: realtime session, audio streaming, server auto-VAD, tools schema, systemInstruction construction, reconnect mechanics | — | — | — | MUST NOT CHANGE | — |
| Vision (realtime frames) | — | — | — | FUTURE | — |

---

## 21. FINAL ARCHITECTURE DIAGRAM

```
                        ┌──────────────────────────────┐
                        │          AURA SOUL           │
                        │ Executive · Personality ·    │
                        │ Memory/MemoryGateway ·       │
                        │ Context · Emotion · Music ·  │
                        │ Tools · ConversationState    │
                        └──────────────┬───────────────┘
                                       │ normalized semantics
                              ┌─────────▼──────────┐
                              │   VOICE RUNTIME    │
                              │ Turn Engine ·      │
                              │ Speech Events ·    │
                              │ Media · Tracing    │
                              └─────────┬──────────┘
                 ┌──────────────────────┼─────────────────────┐
                 ▼                      ▼                     ▼
           Gemini Live             OpenRouter              Sarvam
           realtime session         STT→LLM→TTS             STT→LLM→TTS
                 │                      │                     │
                 └──────────────────────┼─────────────────────┘
                                        ▼
                                      MEDIA
                                 mic / speaker / BT
```

Current reality differs ONLY below the AURA line: Gemini bypasses the "normalized semantics" layer and talks to the Voice Runtime seam with provider-internal events. The diagram above is achievable without touching Gemini's realtime mechanics.

---

## 22. REQUIRED IMPLEMENTATION PHASES (minimum wiring)

- **Phase 1 (P0, low risk):** fix saveMemory key/path; add music listener seam (MusicService command route); fix `[MUSIC CONTEXT]` promise (inject real state or delete the sentence).
- **Phase 2 (P1):** MemoryGateway retrieval into context assembly (async, off critical path); register turns with ConversationStateManager; push conversation traces to telemetry.
- **Phase 3 (P2):** move behavior analysis off the turn critical path (speculative-first); adopt Transport Session Manager mechanics for connect/reconnect/epoch; cross-provider fallback on cascade exhaustion.
- **Phase 4 (P3 cleanup, global):** delete/fix validation suite + pipeline.py + IntegrationTelemetry + FlightRecorder + PlaybackEngine UI path (or wire it).
- **Phase 5 (P4):** Vision frames (Gemini native multimodal), acoustic emotion for Gemini, music state awareness injection.

---

## 23. TEST MATRIX (defined; where run, result recorded)

| # | Test | Setup | Expected | Owner | Measured result |
|---|---|---|---|---|---|
| A | Normal conversation | headless CDP, fake mic | greeting → audio reply | Gemini | PASS (1.2s first token, stable LISTENING) |
| B | Personality | prompt inspection | seed + personality present | Gemini | PASS (systemInstruction contains personality+seed) |
| C | Memory retrieval | code trace | `[MEMORY CONTEXT]` present | AURA | FAIL — no retrieval on Gemini path |
| D | Memory write | code trace + live | saveMemory → readable | AURA | FAIL — key mismatch (useLive:109 vs local-memory:62) |
| E | Executive decision | code trace | decision gates response | AURA | FAIL — RuntimeManager strings advisory only |
| F | Emotion/behavior | code trace | sensing_state in timing | AURA | FAIL — sensing_state always null |
| G | Music command | LIVE (synthetic speech) | tool call → playback | Gemini→AURA | FAIL — 16 turns, 0 tool calls; 0 listeners |
| H | Music state awareness | code trace | `[MUSIC CONTEXT]` injected | AURA | FAIL — promised, never injected |
| I | Vision | code trace | frames in session | AURA | FAIL — not implemented (P4) |
| J | Tools | live/code | 4 tools declared | Gemini | PARTIAL — 2 broken targets |
| K | Interruption | not testable headless (no concurrent speech) | auto-VAD truncation | Gemini | NOT MEASURED |
| L | Reconnect | code trace | transport reconnect | Gemini | PARTIAL — text-based recovery exists |
| M | Provider failure → fallback | measured (old models) | cascade exhaustion | Gemini | FAIL — dies, no cross-provider swap |
| N/O | OR/Sarvam after Gemini | code trace | independent | OR/Sarvam | PASS — fully independent paths |
| P/Q/R/S/T | Long conversation, rapid turns, music+talk, vision+voice, cognitive failure | — | — | — | NOT TESTED headless (no speech harness); cognitive-failure fallback verified in code (:395-401) |

---

## 24–25. SCORES

| Dimension | Current | Projected (after minimum wiring, Phases 1–3) |
|---|---|---|
| AURA architecture compatibility | 4 | 7 |
| Executive integration | 1 | 5 |
| Personality | 7 | 8 |
| Memory | 2 | 7 |
| Context | 5 | 7 |
| Emotion | 4 | 6 |
| Metacognition | 1 | 3 (global cleanup) |
| Music | 1 | 7 |
| Vision | 0 | 0 (P4) |
| Tools | 3 | 8 |
| Conversation state | 3 | 6 |
| Voice Runtime | 3 | 6 |
| Provider abstraction | 5 | 7 |
| Resilience | 4 | 7 |
| Diagnostics | 6 | 8 |
| Latency | 8 | 8 (behavior moved off critical path) |

**CURRENT GEMINI INTEGRATION SCORE: 3.5/10**
**PROJECTED SCORE AFTER MINIMUM WIRING: ~7/10**

---

## 26. CRITICAL FINDINGS

- **P0-1 — Gemini is a second independent assistant, not an AURA-governed provider.** Executive, ConversationStateManager, MemoryGateway, AURA telemetry all bypassed; Gemini decides everything. Violates "ONE AURA".
- **P0-2 — Music path is broken end-to-end for Gemini:** tools declared, dispatch with ZERO listeners; UI engine dead; prompt promises context that never exists; model lied to with `{result:"Playing…"}`. Live test: no tool call in 16 turns.
- **P0-3 — saveMemory data loss:** writes to `aura_memories`, reader expects `aura_memories_${userId}`.
- **P1-1 — MemoryGateway bypass:** no L3 retrieval or persist for Gemini users.
- **P1-2 — Metacognition not operational globally** (validation dead, pipeline.py broken, IntegrationTelemetry missing) — cleanup or remove.
- **P1-3 — Emotion limited to text regex + raw audio;** sensing_state path dead; acoustic XML Gemini-excluded.
- **P2-1 — Behavior analysis synchronous on the turn critical path** (backend HTTP) — the only real "AURA soul = latency tax".
- **P2-2 — No cross-provider fallback on cascade exhaustion / goAway** (goAway has no auto-reconnect).
- **P2-3 — Gemini traces not pushed to AURA telemetry** (shadow timing exists, no conversation traces).
- **P3-1 — Dead code:** PlaybackEngine UI path, FlightRecorder, validation suite, pipeline.py, sensing_state path.
- **P3-2 — Shared prompt's magic JSON music instructions (gemini-prompt.ts:42-54) conflict with real function declarations** on the Gemini path.
- **P4-1 — Vision absent everywhere.**
- **P4-2 — Music state awareness injection (fulfill or remove `[MUSIC CONTEXT]`).**

---

## 27. FINAL CTO-STYLE DECISION

1. **Is Gemini currently a true AURA provider?** No. It is a provider in transport terms (realtime session, correct exception) and a partial consumer of AURA prompt content, but AURA's soul does not govern it.
2. **Exactly why?** Every decision-bearing AURA subsystem (Executive, MemoryGateway, ConversationStateManager, telemetry) is bypassed; Gemini's tool outcomes are disconnected from AURA's runtime (music, memory); the only real AURA contribution is text enrichment inlined into the turn.
3. **What already reaches Gemini?** Personality prompt + seed; per-mode context blocks; cognitive/expression directive strings from RuntimeManager; behavior/style text; `[THREAD]` references; server transcript/audio streams; 4 tool declarations.
4. **What does not?** L3 memory (retrieval + persist), music execution + music state, conversation turn authority, AURA telemetry/traces, acoustic emotion, Executive decisions, resilience policy, vision.
5. **What is duplicated inside Gemini?** Session/turn state machine (vs CSM), model cascade/reconnect (vs Transport Session Manager), memory write (vs MemoryGateway), music dispatch (vs MusicService seam).
6. **What should become AURA-owned?** Memory (Gateway), music actions + music state, turn authority (CSM), telemetry traces, tool execution seams, resilience policy.
7. **What should remain Gemini-native?** The entire realtime session: audio in/out, server auto-VAD, session mechanics, reconnect recovery, tools schema shape, systemInstruction construction, interruption handling.
8. **Exact seams:** (a) context seam — MemoryGateway+Context → one normalized turn payload → `sendRealtimeText`; (b) session-event seam — server events → SpeechEventAssembler-compatible normalized events → CSM/telemetry; (c) tool seam — functionCall → AURA command bus → MusicService/memory; (d) timing seam — getResponseDelay with real sensing_state.
9. **Does Gemini need MemoryGateway?** Yes — Phase 1/2. Retrieval async off critical path; writes via `storeMemory`/`saveMemory` tool.
10. **Executive mediation?** Yes, in policy form: AURA continues to send cognitive directives (already working), and must additionally get a real decision gate (evaluateDecision currently void) — this is an AURA-core gap, not a Gemini one.
11. **Music connection:** one AURA-owned music action seam: Gemini tool call → normalized intent → MusicService's existing command path (the same one OpenRouter/Sarvam processIntent already uses); music state → `[MUSIC CONTEXT]` injection on turn assembly (or remove the promise).
12. **Vision:** P4 — when implemented, feed frames through AURA vision context into Gemini's native multimodal session (no intermediate representation needed).
13. **Emotion/Behavior:** keep behavior-client; make backend analysis speculative-first (off critical path); wire sensing_state for Gemini; optionally add acoustic evidence.
14. **Tools:** keep the 4 declarations; route execution through AURA-owned handlers (memory + music seams above). One tool registry, providers request.
15. **ConversationState:** CSM becomes authoritative for AURA turn policy; Gemini's session state stays provider mechanics.
16. **Voice Runtime mapping:** Gemini adopts Transport Session Manager for connection mechanics; SpeechEventAssembler gains realtime-session event semantics (no fake finals); Turn Engine receives normalized events.
17. **Must remain untouched:** realtime session, audio streaming, server VAD, native bidirectional audio, low-latency path, `[ADAPTIVE MIRRORING]`/`[INTERRUPTION BEHAVIOR]` blocks.
18. **Minimum implementation:** 3 MUST changes (memory write fix, music listener seam, prompt promise fix) ≈ a few hours; + 4 SHOULD changes (Gateway retrieval, CSM registration, telemetry push, speculative-first analysis) ≈ 1–2 days. No architecture rewrite required.
19. **Latency impact of wiring:** Phase 1/2 adds only parallel/async work — no critical-path addition; Phase 3 REDUCES critical path (removes sync backend analysis). Soul enrichment is not a latency tax after Phase 3.
20. **Can ONE AURA soul then operate through Gemini, OpenRouter, Sarvam?** Yes — Gemini keeps its realtime exception, all three receive the same AURA-owned memory/context/tools/turn/telemetry semantics through the same seams. That is the target architecture (§21) and it is reachable without breaking any provider.
