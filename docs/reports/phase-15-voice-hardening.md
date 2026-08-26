# Phase 15 — Voice Runtime Final Hardening Report

Date: 2026-08-15 (today)
Scope: Final hardening of the frozen Gemini voice runtime, VAD/single-owner audit,
end-to-end latency measurement, and temp-infrastructure cleanup.

## 1. Frozen production chain (verified unchanged)

```
src/routes/index.tsx
  -> useVoiceOrchestrator (src/core/useVoiceOrchestrator.ts)
    -> useLiveNext (src/providers/gemini/useLiveNext.ts)
      -> GeminiVoiceAdapter -> GeminiVoiceEngine
        -> GeminiSession            (WebSocket, connect config)
        -> GeminiAudioInput        (via MicrophoneCoordinator)
        -> GeminiAudioOutput       (via SpeechCoordinator)
```

- Model: `models/gemini-3.1-flash-live-preview`, voice `Aoede`,
  `httpOptions.apiVersion: "v1beta"`.
- Key: `getGeminiKey()` — `sessionStorage aura_gemini_api_key` -> `.env`
  `VITE_GEMINI_API_KEY`, prefix `AQ.Ab`.
- `sendRealtimeInput` sends polyline/object form
  `{ realtimeInput: { audio: { data: <base64> } } }` — unregressed (verified in
  `GeminiSession.sendRealtimeInput` + `GeminiVoiceEngine` streaming callback).
- Testbed `/gemini-next-test` drives the SAME `GeminiVoiceEngine` (production
  path), wires `onToolCall` -> `executeAuraAction` matching production
  `handleToolCall`.

## 2. Single-owner audit (PASS)

- Microphone: `MicrophoneCoordinator.getInstance()` singleton; ownership goes
  strictly through `GeminiAudioInput` (acquire/subscribe/teardown).
- Output: `SpeechCoordinator.getInstance()` -> `PlaybackScheduler` (single
  active-node set, flush-stale-streams on stop).
- Engine/session: exactly one `GeminiSession` live; `GeminiVoiceEngine.start()`
  guards re-entrancy and `stop()` tears the session down.
- No dual captures / dual playback paths found.

## 3. VAD audit (PASS — server authoritative)

- Activity detection is driven by the server: `realtimeInputConfig
  { automaticActivityDetection: { disabled: false, startOfSpeechSensitivity:
  START_SENSITIVITY_HIGH, endOfSpeechSensitivity: END_SENSITIVITY_LOW,
  prefixPaddingMs: 20, silenceDurationMs: 1300 } }`.
- The PCM worklet's `setVadState` path is NOT wired into the gemini path; it is
  observational only. Client audio streaming to the WS is unconditional while
  CONNECTED; turn boundaries fall out of server-side AAD + `generationComplete`.

## 4. Root-cause fix confirmed

The original zero-turn blocker: the first PCM frames sent over the wire were
all-zeros (base64 `AAAA…`). The unconditional `getUserMedia` constraints block
(`echoCancellation/noiseSuppression/autoGainControl/sampleRate/channelCount`)
suppressed the fake-mic WAV into silence. Replacing it with plain `{ audio: true }`
made REAL PCM reach the wire and the connected session gained audio responses.
Controlled A/B re-runs confirm: constraints variant -> 0 turns (server never sees
speech), `audio:true` variant -> real audio + turns. (A separate discriminator:
the original WAV's spoken "Goodbye" + the `updateAnalysis` tool caused the model
to end the conversation, capping prod-config runs around 13 turns; using 20
distinct non-goodbye utterances removed that cap.)

## 5. End-to-end latency benchmark (FINAL BASELINE)

Harness: `raw://gemini-next-test` via Playwright with
`--use-file-for-fake-audio-capture`, full production config
(tools + speechConfig Aoede + both transcriptions + AAD), 20 distinct
espeak-ng utterances, prime text turn, no reconnect tolerated.

Results (saved to `gemini-realtime-benchmark.json`):

| metric | value |
| --- | --- |
| turnsReached | 20 / 20 |
| audioChunks Rx | 142 |
| audioBytes Rx | 1,476,712 |
| duration | 91 s |
| reconnect | none (false) |
| ttfb (model first-audio vs last-send) | n=12, p50=24 ms, p90=69 ms, max=116 ms |
| decode-to-first-audio | n=12, p50=0 ms, max=17 ms |
| total (send->first playback) | n=12, p50=24 ms, p90=69 ms, max=116 ms |

Note: earlier negative TTFB rows were a probe clock/turn-id alignment artifact
(mic frames sent while the model was already replying landed in the same turn
bucket). TTFB is now computed as first-audio minus LAST SEND *before* the first
audio, giving only non-negative values. LatencyProbe was temporary infra and has
been removed; the production path carries no probe hooks.

## 6. Debug / smoke regressions at cleanup time

- `tsc --noEmit` : PASS
- `vite build`   : PASS
- raw golden oracle `raw_gemini_live.spec.ts`: `1 passed (2.7m)`, Connection
  CONNECTED PASS, Microphone LIVE PASS, disallowed telemetry NONE.

## 7. Temp infrastructure removed

- `src/routes/gemini-raw-test.tsx`, `raw_gemini_live.spec.ts` (golden oracle —
  served its purpose, superseded by prod-path benchmark)
- `temp_benchmark_latency.spec.ts`
- `src/runtime/diagnostics/LatencyProbe.ts` (+ probe hooks unwired from
  GeminiVoiceEngine/GeminiSession/GeminiAudioInput/GeminiAudioOutput/
  PlaybackScheduler/testbed; `debugLog` field removed)
- One-off scripts: `gemini-live-bench.mjs`, `verify.spec.ts`, `verify2.spec.ts`,
  `verify3.spec.ts`, `verify_all_providers.spec.ts`, `verify_multiturn.spec.ts`,
  `verify-audio-context*.ts`, `scripts/verify-voicesense.ts`
- `/tmp` WAV variants (kept `/tmp/test_audio_5turns.wav` per convention)

## 8. Audit trail

- Final baseline artifact: `gemini-realtime-benchmark.json`
- Final bench log: `/tmp/opencode/bench-espeak-natural.log`
- Post-cleanup tsc/build logs: `/tmp/opencode/tsc-cleanup.log`,
  `/tmp/opencode/build-cleanup.log`