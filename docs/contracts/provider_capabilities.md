# Provider Capability Vocabulary — AURA Voice Runtime v1.0

> Frozen baseline. Authoritative source: `src/speech/types/capabilities.ts`.
> Architecture context: `docs/architecture/voice_runtime_architecture.md` §6.2.

## Purpose

There are **no arbitrary capability strings** in the runtime. Every capability
is a typed field on `SpeechCapabilities`, and classified dimensions
(runtime class, transport, endpoint control) use explicit enums. This
vocabulary must not drift without an architecture review.

## Enums

### `ProviderRuntimeClass`
Where the provider actually runs. A runtime class, **never** a provider name —
provider names live only in the Provider Registry.

| Value    | Meaning                             |
|----------|-------------------------------------|
| `browser`| Browser-managed API (`SpeechRecognition`, `speechSynthesis`) |
| `cloud`  | Remote API                          |
| `local`  | On-device inference                 |

### `TransportMode`
The provider's transport mechanism.

| Value               | Meaning                             |
|---------------------|-------------------------------------|
| `browser-native`    | Browser-managed API                 |
| `http`              | Request/response or pseudo-stream over HTTP |
| `websocket`         | Persistent WebSocket                |
| `webrtc`            | WebRTC (peer connection)            |
| `realtime-session`  | Full-duplex realtime session (e.g. Gemini Live) |

### `EndpointControl`
Who decides when a turn ends. **Frozen semantics:**

| Value      | Meaning                                                            |
|------------|--------------------------------------------------------------------|
| `provider` | The provider autonomously emits `FinalTranscript` (Browser STT).   |
| `runtime`  | A final is only produced when the runtime calls `endUtterance()` (Groq pseudo-stream, Sarvam REST — VAD boundary via Media's VAD). |
| `none`     | The provider never emits finals; the Turn Engine decides turns (Realtime sessions). |

## `SpeechCapabilities` — the frozen set

All fields are **required** — no optional drift.

| Field              | Meaning                                                                 |
|--------------------|-------------------------------------------------------------------------|
| `speechInput`      | Produces transcripts (STT side of the seam).                            |
| `speechOutput`     | Produces audio/segments (TTS side of the seam).                         |
| `realtime`         | Full-duplex session: audio in AND audio out in one session (Gemini Live, OpenAI Realtime). |
| `streaming`        | Emits chunked/final results progressively rather than only at the end.  |
| `partials`         | Emits `PartialTranscript` events.                                       |
| `revisions`        | Emits `TranscriptRevision` events (stable-prefix agreement).            |
| `offline`          | Works without a network connection.                                     |
| `local`            | Runs on-device.                                                         |
| `interruptible`    | Playback/output can be interrupted (barge-in).                          |
| `wordTimestamps`   | Provides word-level timestamps (`evidence`).                            |
| `gestureRequired`  | Requires a user gesture before the provider can start (iOS/mobile).     |
| `audioOutput`      | Output includes raw audio frames (`OutputAudioFrame`).                  |

## Registry Mapping

The frozen descriptors table in `src/speech/registry/providers.ts` pairs each
provider id with a `SpeechCapabilities` row plus classified metadata
(`LatencyClass`, `CostClass`, `CredentialRequirement`). Capabilities are
**declared by the registry, never inferred at runtime** — providers do not
self-report.

## Changes to this file

Any change (field addition, enum value, semantic change) requires an
architecture review and a version bump. This is a frozen contract per
AURA Voice Runtime v1.0.
