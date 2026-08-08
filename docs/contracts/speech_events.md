# Speech Event Contract — AURA Voice Runtime v1.0

> Frozen baseline. Authoritative source: `src/speech/types/events.ts`.
> Architecture context: `docs/architecture/voice_runtime_architecture.md` §6.1.

## Purpose

This is the **only** speech contract above the provider seam. The Conversation
Runtime, Turn Engine, and every other consumer understand exactly the events
defined here and nothing else. Provider names never appear in event payloads —
except for the single `providerId` envelope field, which exists only for
diagnostics and traces.

## Envelope (every event)

| Field        | Type   | Semantics                                                        |
|--------------|--------|------------------------------------------------------------------|
| `utteranceId`| string | Identifies the user turn.                                        |
| `sequence`   | number | Monotonic per utterance. **Supersession law**: a higher sequence supersedes any lower sequence event for the same utterance. |
| `epoch`      | number | Monotonic per transport session. **Staleness law**: any event from an old epoch is stale and must be dropped. |
| `providerId` | string | Provider id (registry key). The only place a provider id may appear in the event path. |
| `traceId`    | string | Links the event to its trace envelope (Trace Runtime).           |
| `timestamp`  | number | Epoch ms when the event was produced.                            |

## Event Types

### `SpeechStarted`
First event of an utterance. The Turn Engine's conversation begins here.

### `PartialTranscript`
Progressive text while the user is still speaking.
- `transcript: string` — current best text.
- `language?: string` — detected language when the provider reports it.

### `TranscriptRevision`
Replaces the previously emitted partial for this utterance (stable-prefix
agreement). Consumers must render the new value atomically.
- `transcript: string` — replacement text.

### `FinalTranscript`
Ends the transcript stream for the utterance.
- `transcript: string`, `language: string` — final text and language.
- `confidence: number` — [0,1]; `undefined` is not allowed as a value — use a
  sentinel (e.g. `-1`) when the provider does not report confidence.
- `evidence?: readonly { word; start; end }[]` — word-level timestamps when the
  provider supports them.

### `SpeechEnded`
The user's turn is over (silence detected / endpoint reached). Always follows
`FinalTranscript` when the utterance was recognized; may follow `SpeechStarted`
directly on empty/no-speech turns.

### `ProviderError`
- `code: ProviderErrorCode` — frozen enum: `rate-limit`, `auth`, `network`,
  `decode`, `timeout`, `gesture-required`, `unsupported`.
- `retryable: boolean` — whether the Transport may retry.
- `detail: string` — human-readable detail for diagnostics.

## Ordering Guarantees

1. `SpeechStarted` is always first for an utterance.
2. Partials/revisions are monotonically ordered by `sequence`; consumers render
   the highest sequence seen so far.
3. `FinalTranscript` precedes `SpeechEnded` when a transcript exists.
4. `ProviderError` may appear anywhere; after a terminal error the utterance is
   finished and no further events for that `utteranceId` may be emitted.
5. Events from an epoch lower than the current session epoch are dropped by
   the consumer without inspection.

## Output-Side Types

| Type | Shape | Purpose |
|------|-------|---------|
| `ResponseSegment` | `{ text: string; style?: string }` | TTS input segment. |
| `OutputAudioFrame` | `{ pcm: Float32Array; sampleRate: number }` | Raw audio emitted by realtime/output providers. |

## Changes to this file

Any change (field addition, semantic change, enum value) requires an
architecture review and a version bump of the contract. This is a frozen
contract per AURA Voice Runtime v1.0.
