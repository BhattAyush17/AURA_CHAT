# AURA Voice Runtime v1.0 — Frozen Production Baseline

Date: 2026-08-08 · Status: **FROZEN — approved for production** · Supersedes Latency Runtime v2 and all prior drafts (v1→v2→v3 → Phase 7 → Proposal D + 6 → Latency Runtime v2 → final adversarial audit)

This is the frozen architecture for AURA Voice. It emerged from months of real-device testing (RC-1/RC-2 across desktop Linux, Samsung Android, realme Android), multiple adversarial reviews, and one definitive audit. The lesson that stabilized it: **browser speech APIs are not the architecture — they are one provider.**

**Optimization targets:** lowest perceived latency · lowest CPU · lowest battery · lowest memory · minimum engineering complexity · maximum future extensibility · predictable behavior across Android, iOS, desktop, tablets, and low-end devices.

---

## 1. The One Pipeline (forever)

```
                    ┌────────────────────────────┐
                    │      Conversation Runtime │
                    │ Executive • Memory • Tools │
                    │ Personality • Emotion      │
                    └─────────────▲──────────────┘
                                  │
                          Speech Events
                                  │
                    ┌─────────────┴──────────────┐
                    │       Turn Engine          │
                    │ endpoint • state • grace   │
                    │ interruption decisions     │
                    └───────▲───────────▲────────┘
                            │           │
                Speech Events│           │Response Segments
                            │           │
               ┌────────────┘           └──────────────┐
               ▼                                       ▼
     ┌────────────────────┐              ┌────────────────────┐
     │ SpeechInputProvider │              │ SpeechOutputProvider│
     │ Browser             │              │ Browser            │
     │ Groq                │              │ Sarvam             │
     │ Whisper             │              │ ElevenLabs         │
     │ Realtime Adapter    │              │ Realtime Adapter   │
     └──────────▲──────────┘              └──────────▲─────────┘
                │                                    │
                └──────────────┬─────────────────────┘
                               │
                      Provider Transport
                 capabilities • auth • leases
                               │
                      ┌────────▼────────┐
                      │  Media Runtime  │
                      │ Mic • DSP • AEC │
                      │ Playback • BT   │
                      └─────────────────┘
```

UI (React) connects through **thin hook adapters only**. No other layer touches React. Nothing forks. Providers plug in.

---

## 2. The Seven Laws (frozen forever)

### Law 1 — Media owns sound.
Nobody else touches the microphone, AudioContext, playback graph, or VAD. Ever. Output providers own the *queue/epoch/cancellation*; Media owns the *physical playback graph*. The only shared data flows are explicit read-only streams.

### Law 2 — Conversation never knows providers.
Conversation sees only `SpeechStarted · PartialTranscript · TranscriptRevision · FinalTranscript · SpeechEnded · ProviderError` plus confidence, language, timestamps, timing, optional evidence. The names Groq, Sarvam, Browser, Whisper, Realtime never appear above the provider seam. `if (provider === "groq")` is forbidden.

### Law 3 — Turn Engine never performs IO.
It consumes events and emits decisions only. No fetch, no websocket, no provider. Pure reducer.

### Law 4 — Providers are pure modules.
Never React hooks. Stack is always: UI Adapter (thin hook) → Provider Module → Transport. Never: React → Everything.

### Law 5 — Provider Transport owns mechanics, not decisions.
Mechanics: reconnect, retry, lease, TTL, backoff, heartbeat, session, single-flight.
NOT: warmup, readiness, failover, debt, provider selection. Those belong to the owners. A Transport Session Manager is allowed strictly as mechanics (see §3.1).

### Law 6 — Only one VAD.
Not browser VAD, not Groq VAD, not music RMS, not barge RMS, not turn RMS. One Silero VAD in Media Runtime emitting `SpeechStarted / SpeechEnded / Energy / Probability`. Everyone subscribes. Barge-in is a media-layer reflex (direct path, 10–50ms, bypassing React); the conversational consequence is a Turn Engine decision.

### Law 7 — SpeechEventAssembler is mandatory.
No provider emits raw transcripts upward. Every provider: Raw Provider → Assembler → Normalized Events. Forever.

---

## 3. The Three Additions

### 3.1 Transport Session Manager
Inside Provider Transport. Owns per-provider connection state machines, retry/backoff, lease TTL enforcement, reconnection, epoch generation, single-flight. It is **mechanics, not policy**: it never decides when to warm, how much debt is allowed, which provider is active, or failover. If it ever emits "ready" or decides "reconnect now," it has become the banned Warmup Runtime and must be cut back.

```
Provider Transport
├── Credentials
├── Capability
├── Lease
├── Session
```

### 3.2 Trace Runtime
Not another runtime — just tracing. Every utterance automatically carries a trace: `Mic Start → Speech Start → First Partial → Final → LLM Start → First Token → TTS Request → First PCM → Playback`. One trace per `utteranceId`, from microphone capture to playback. The telemetry sink exists from Phase 1; benchmarking is Phase 6.

### 3.3 Latency Budget
Every feature declares Cost · Latency · Memory · Battery — plus its **revert criterion / effectiveness metric** — before it is merged. This is a declaration contract, not a component (the "Cost Manager" is permanently rejected). It is what keeps the architecture honest as providers and features accumulate.

---

## 4. Permanent Rejections (god objects — never build)

- ❌ Intent Preparation Runtime
- ❌ Perception Runtime
- ❌ Readiness Runtime
- ❌ Event Bus
- ❌ Speech Runtime
- ❌ Coordinator Runtime
- ❌ Warmup Manager
- ❌ Cost Manager
- ❌ Provider Manager Runtime

Every one of these becomes a god object within two years.

---

## 5. Warmup Is a Per-Runtime Attribute Set (never a runtime)

Each runtime independently applies to its own resources: **deadline · readiness vector · warm debt · telemetry**. No central orchestrator. Policy constants and the frozen metric list live in one shared module; the telemetry sink is the existing one.

### 5.1 Deadline-based warmup
Every warmable resource has an independent deadline measured from its trigger (AudioContext 80ms, transport 250ms, credentials 150ms, STT 300ms, speculative LLM before endpoint). Miss → proceed cold, never wait.

### 5.2 Readiness vector
Fixed enum per resource: `uninitialized | warming | ready | expired`. Consumers treat `warming` ≡ `not ready`.

### 5.3 Warm debt
Per-resource counters (attempts/hits/misses/discarded/reconnects/lifetime). Two budgets: speculative (paid — tokens, hit-rate adapted) and free-resource instances (bounded). No cross-resource accounting, no general cost model.

### 5.4 Telemetry (frozen metric list — do not expand)
1. Warm Effectiveness · 2. Readiness Coverage · 3. Warm Hit % · 4. Deadline Miss % · 5. Average Warm Debt · 6. Warm Waste %.

### 5.5 Cold path always works
If all warmup is disabled, AURA must still function fully. Warmup is optimization, never dependency. Cold-path drills are mandatory: periodically discard all warm state in production; "no warm anything" is a tested scenario. Cold-path hazards codified: no blocking on `getVoices()`, AudioContext resume inside the tap gesture, capability probing at cold start per device.

### 5.6 Leases
Every warm resource is a lease: epoch-stamped, TTL-bounded, cancellable, single-flight, mandatory release. **In-use leases are pinned** (TTL enforced at turn boundaries, never mid-utterance). Tier downgrades release at the next turn boundary. Release has a deadline, not just a trigger. Radio-aware refresh (weak signal → mark stale, skip refresh).

### 5.7 Device policy (three tiers, hysteresis, no fourth tier)
Tier A (high-end, battery healthy): warm transport + AudioContext + STT + speculative. Tier B (mid): transport only. Tier C (battery saver): cold path only. Network quality degrades *deadlines*; tiers select *which* resources warm.

### 5.8 Strong signals (only these)
Microphone press · wake word armed (future) · Bluetooth headset connected · active conversation resumed · user interrupted AURA · continuous voice mode. Never on page load, never ML prediction. Cooldown decay window: ~20–30s after the last utterance, then release.

---

## 6. Provider Contract

### 6.1 Speech events
`SpeechStarted | PartialTranscript | TranscriptRevision | FinalTranscript | SpeechEnded | ProviderError` (+ confidence, language, timestamps, timing, optional evidence; output side adds `ResponseSegment` and `OutputAudioFrame` for raw-audio/realtime output).

Every async event carries `utteranceId + sequence + epoch`.

- **Supersession law:** latest sequence wins. A Partial/Revision/Final for an utteranceId with a higher sequence aborts the in-flight LLM dispatch and re-dispatches. LLM dispatch is keyed by (utteranceId, sequence).
- **Boundary-only failover:** providers switch only between utterances. Never mid-utterance. No retry of a finalized utteranceId. Input-side provider exclusivity (stop-then-start). No input re-arm while AURA speaks.
- **Endpoint control is a capability:** `provider | runtime | none`. Realtime = `none` (continuous partials; Turn Engine decides the turn).

### 6.2 Capability vocabulary (frozen — 11 fields, no drift without architecture review)
```
id · streaming · realtime · offline · interruptible ·
endpointControl: "provider"|"runtime"|"none" ·
wordTimestamps · languages[] · gestureRequired ·
latencyClass 1–4 · costClass 1–4 · credentials: "userKey"|"oauth"|"none"
```

### 6.3 Credentials
sessionStorage only, never localStorage, never server, never proxied. Voice-mode gate per brain (e.g., OpenRouter/Sarvam modes require the provider key + Groq key; missing → mic disabled with exact reason, one-time prompt, text chat unaffected). Adding the key re-enables the mic live.

---

## 7. Latency Reality (after this design — honest numbers)

| # | Bottleneck | Est. impact |
|---|---|---|
| 1 | LLM first token (server-side) | 300–800ms · 50–60% of perceived |
| 2 | STT finalize (provider-bound) | 150–400ms · 20–30% |
| 3 | Adaptive turn delay (intentional) | ~0.3–1s |
| 4 | TTS first frame | 100–500ms · 10–15% |
| 5 | Cold/warm re-entry | 0–150ms warm, 300–800ms cold |

The seams buy determinism, provider independence, and OEM invariance — **not** STT speed. LLM first token remains the dominant lever and is server-side; it can only be overlapped (speculative LLM start, incremental TTS), never removed client-side.

---

## 8. Approval Conditions (mandatory, from final audit)

1. Framework-free providers; React acts only as UI adapter.
2. Single Media-owned VAD for endpointing and barge-in.
3. SpeechEventAssembler normalizes all provider output before the Turn Engine.
4. Boundary-only provider failover.
5. Realtime session adapters are first-class (both seams, `endpointControl: none`, `OutputAudioFrame`).
6. Transport Session Manager: mechanics only (boundary per §3.1).
7. Per-utterance traces from microphone capture to playback.

---

## 9. Implementation Roadmap

1. **Phase 1 — Foundation:** framework-free provider modules · provider registry (static table) · capability descriptors · credential gate (Groq key, Sarvam key, etc.) · trace envelope + telemetry sink (instrumentation from day one).
2. **Phase 2 — Speech seams:** SpeechInputProvider · SpeechOutputProvider · SpeechEventAssembler.
3. **Phase 3 — Transport:** Transport Session Manager · Lease Manager · shared HTTP/WebSocket transport (injectable HTTP for deterministic tests).
4. **Phase 4 — Media:** single MediaRuntime · single Silero VAD · unified playback · audio routing.
5. **Phase 5 — Turn orchestration:** Turn Engine consumes only normalized events · Conversation Runtime unchanged except for the new event contract.
6. **Phase 6 — Observability:** per-utterance traces formalized · latency budgets · provider benchmarking · A/B of warm vs cold paths (RC-2 harness).

Warmup attributes (deadlines/vector/debt) ship *inside* each phase — they are per-runtime attributes, not a phase. Warm-path tuning is telemetry-gated (Phase 6) and reverted on negative ROI per device tier.

---

## 10. The Shift That Made This Stable

Originally: *browser speech APIs are the architecture.*
After RC-1/RC-2 and the reviews: **browser speech APIs are just one provider.**

Browser STT · Groq STT · Whisper · Parakeet · Canary · Gemini Live · OpenAI Realtime · Local Whisper · Sarvam TTS · Browser TTS · ElevenLabs — all simply providers. Conversation never knows which is active. The runtime stays stable while providers are replaced as browser capabilities and AI services evolve.

**Frozen as AURA Voice Runtime v1.0.**
