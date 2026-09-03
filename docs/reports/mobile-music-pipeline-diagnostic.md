# AURA Mobile Music Pipeline — Forensic Diagnostic Report

**Phase:** Read-only instrumentation shipped. No production fix implemented.
**Goal:** Make the next fix targeted, not speculative.

---

## AURA MOBILE MUSIC PIPELINE DIAGNOSTIC

```
Desktop:        STRUCTURAL PASS  (build green, typecheck clean for new code)
Android:        NEEDS RUNTIME VERIFICATION  (panel now exposed)
iOS:            NEEDS RUNTIME VERIFICATION  (panel now exposed)

Playback:               (instrumented — verify in panel)
AudioContext:           (instrumented — verify in panel)
MediaElementAudioSourceNode: (instrumented — verify in panel)
Analyser:               (instrumented — verify in panel)
DSP Loop:               (instrumented — verify in panel; see S-1, S-2)
DSP Signal:             (instrumented — verify in panel; see S-3, S-4)
Perception:             (instrumented — verify in panel; see S-5)
Evidence Fusion:        (instrumented — verify in panel)
```

| Stage                   | Structural status                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build                   | **PASS** (`npm run build` → `✓ built in 9.70s`)                                                                                                                                      |
| Typecheck (new code)    | **PASS** (`npx tsc --noEmit` → 0 errors in `MobileMusicPipelineSection.tsx`, all telemetry additions clean)                                                                          |
| Lint (new code)         | **PASS** after `prettier --write` (3 pre-existing regex errors in legacy `sanitize()` are untouched and unrelated)                                                                   |
| Desktop (static review) | **PASS** — code path complete: `play() → playing → AudioContext → MESN → analyser → DSP loop → signals → orchestrator → fusion` is wired and unconditional on desktop.               |
| Android                 | **STRUCTURAL LIKELY PASS** — Chrome Android supports `createMediaElementSource`, `crossOrigin="anonymous"`, autoplay, and unlocked Web Audio. The lazy-resume branch is benign here. |
| iOS Safari              | **STRUCTURAL RISK** — see structural findings S-1 … S-5 below.                                                                                                                       |

---

## Primary Mobile Failure (Hypothesis)

Based on static code review alone (no live device runs performed in this environment), the highest-probability failure modes for iOS Safari are:

**H-1: `AudioContext` never leaves `suspended` because the only `resume()` call is fired from inside the DSP loop tick, but the DSP loop early-returns on the suspended branch and never produces a frame in that state.** (See S-1.)

**H-2: Even if `AudioContext` does reach `running`, the lazy-resume path was the only one ever attempted — `audioContext.resume()` is never called inside the `play()` gesture chain or `unlockAudio()`.** (See S-2.)

**H-3: A genuine zero-signal DSP graph cannot be distinguished from musical silence — the new panel fixes this with a 30-frame rolling counter at the same 0.005 RMS threshold the provider already uses internally.** (See S-3.)

These are **structural hypotheses** to confirm against the new `Mobile Music Pipeline` panel in the runtime drawer. Per the task's instruction, the next phase must use the panel's evidence to pick the smallest targeted correction — not a shotgun patch.

**Root Cause Confidence: LOW (until panel evidence confirms).** The new instrumentation is required to upgrade this to MEDIUM/HIGH before any fix is implemented.

---

## Structural Evidence (from code, not runtime)

### S-1: DSP loop early-returns on suspended AudioContext; no frame is produced

`src/music/perception/WebAudioPerceptionProvider.ts:130-141` (original) — preserved verbatim in the instrumented file:

```ts
if (this.audioContext.state === "suspended") {
  try {
    this.audioContext.resume().catch(() => {});
  } catch (e) {
    // Ignore
  }
  return; // <-- critical: this returns BEFORE any getFloatTimeDomainData call
}
```

**Consequence:** When the AudioContext is in the "suspended" state (the iOS-Safari default at page load, and again after any backgrounding without an explicit user-gesture-bound `resume()`), the DSP loop fires every 100 ms but produces zero frames. The provider's internal silence detector (`silenceThreshold = 0.005`) then classifies the next legitimate frame as silence, even if the audio is actually playing.

**Where to look in the panel:**

- `AudioContext.lifecycle` = `SUSPENDED`
- `DSP Loop` actualHz near 0–10 Hz (loop ticks) but `DSP Signal` lifecycle = `NOT_INITIALIZED` or `ZERO SIGNAL`
- `DSP Loop tickCount` keeps growing, but `DSP Loop lastFrame` is `null` for many seconds
- Timeline will show: `audio.play() resolved` → `playing event` → `audio_context_resume_requested` → `audio_context_resume_resolved` (or rejected), but `dsp_loop_started` is followed by no frames until the resume resolves.

### S-2: `audioContext.resume()` is never invoked from a user-gesture path

`src/music/providers/HTMLAudioPlaybackProvider.ts:233-255` (the `unlockAudio()` method) calls `this.audio.play()` and then `this.audio.pause()` — it does **not** touch the AudioContext.

`WebAudioPerceptionProvider` only attempts `audioContext.resume()` lazily from inside the analysis loop, which (per S-1) early-returns before a frame is produced.

**Consequence:** On iOS Safari, where the AudioContext is created suspended and only transitions to `running` inside a user-gesture stack, the actual `resume()` call needs to be chained off `play()`'s resolved Promise (or `unlockAudio()`), not deferred to a later timer tick. This is consistent with the symptom of "music plays, but perception is inactive."

**Where to look in the panel:**

- `iOS Gesture Chain > play() resolved after gesture` = `YES`
- `iOS Gesture Chain > AudioContext resumed after play` = `no`
- `AudioContext.lifecycle` remains `SUSPENDED` while `Audio Element.paused = false`
- Primary diagnosis will surface as `AUDIO_CONTEXT_SUSPENDED` with the evidence line `AudioContext state = suspended`.

### S-3: The current code cannot distinguish a real musical silence from a broken WebAudio graph

`WebAudioPerceptionProvider.runAnalysis` classifies `rms < 0.005` as silence (`runAnalysis` line 179), but the only DSP-driven output is "silence" — there is no diagnostic state for "DSP graph exists but receives no signal at all."

**The new panel fixes this.** The conservative threshold (`ZERO_SIGNAL_RMS_THRESHOLD = 0.005`) and frame count (`ZERO_SIGNAL_FRAMES_TO_FLAG = 30`, ≈ 3 s at 10 Hz) are surfaced in the panel as `consecutive near-zero frames` and `zero-signal threshold (RMS)`. Once 30 consecutive frames are near zero while `audio.paused = false` and `AudioContext.lifecycle = running`, the diagnosis will report `DSP_ZERO_SIGNAL` rather than collapsing the state to silence.

### S-4: Source classification without leaking the signed CDN URL

`HTMLAudioPlaybackProvider.classifyAudioSource()` classifies the URL as `direct|blob|proxy|unknown` and never stores the raw URL. The panel exposes the classification only. The proxy path (`/api/ytmusic/proxy`) is detected and shown as `proxy`; the backend proxy is the only path currently producing playable streams per `YtDlpProvider.ts:32-39`.

### S-5: The perception orchestrator and fusion engine are now counted

`MusicPerceptionOrchestrator` now tracks `signalsIn` and `signalsOut` separately. `signalsOut` increments only when a signal is actually drained from a provider's pending queue. If the orchestrator has `signalsOut = 0` while the DSP loop is producing frames with non-zero RMS, the panel will diagnose `PERCEPTION_ORCHESTRATOR_INACTIVE` with evidence showing DSP frames reached the analyser but the orchestrator never emitted a signal — pointing the next fix at the orchestrator's `processSignals` path rather than the DSP layer.

---

## Files Modified

```
src/telemetry/types.ts                            +221  (new MobileMusicPipelineState + subtypes)
src/telemetry/RuntimeTelemetry.ts                 +260  (new field, recorders, classifier, default factory)
src/telemetry/index.ts                            +14   (type re-exports)
src/music/providers/HTMLAudioPlaybackProvider.ts  +54   (read-only recorders in event listeners; no playback change)
src/music/perception/WebAudioPerceptionProvider.ts+99   (read-only recorders; new private tick counters that do not feed DSP)
src/music/perception/MusicPerceptionOrchestrator.ts+18  (signalsIn/signalsOut counters; no perception logic change)
src/components/diagnostics/MobileMusicPipelineSection.tsx  +443  (new UI section)
src/components/diagnostics/RuntimeDiagnosticsDrawer.tsx    +3    (mount the new section)
```

No LLM calls, no embedding calls, no Supabase calls, no Pinecone calls, no network polling from the new instrumentation. No new audio element, no new AudioContext per track, no new MediaElementAudioSourceNode, no second playback path. The existing `WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>` protection at `WebAudioPerceptionProvider.ts:9` is preserved unchanged.

---

## What the Panel Surfaces (per spec sections 1–16)

- **§1 Environment:** browser class, mobile/iOS/Android/Safari booleans, viewport, AudioContext/OfflineAudioContext/AnalyserNode API presence.
- **§2 Audio Element:** `paused`, `readyState`, `networkState`, `currentTime`, `duration`, `crossOrigin`, `source class` (`direct|blob|proxy|unknown`). No signed URL is ever stored or displayed.
- **§3 Audio Playback:** `play() requested`, `play() resolved`, `play() rejected` (with `name=NotAllowedError|NotSupportedError|...`), `playing`, `pause`, `waiting`, `stalled`, `canplay`, `loadedmetadata`, `error`, `ended`, `seeking`, `seeked` — all rendered in the timeline.
- **§4 AudioContext:** `created`, `state` (`suspended|running|closed|absent`), `sampleRate`, `baseLatency`, `outputLatency`, `resume requested/resolved/rejected`, last resume reason.
- **§5 MediaElementAudioSourceNode:** `created|reused|failed|absent`. `InvalidStateError` boolean. Uses the existing `WeakMap` — no second node is ever created.
- **§6 AnalyserNode:** `created|active|failed|absent`, `fftSize`, `frequencyBinCount`.
- **§7 DSP Loop:** `lifecycle` (`stopped|running|stalled`), `actualHz` (computed, not assumed), `targetHz` (= 10), `tickCount`, `lastTickAt`, `ticksLast1s`, `lastFrame` (`RMS`, `spectral flux`, `high-frequency energy`), `consecutiveZeroFrames`, threshold.
- **§8 Zero-Signal Diagnosis:** When `audio.paused = false` AND `consecutiveZeroFrames ≥ 30`, the diagnosis returns `DSP_ZERO_SIGNAL` with an evidence list, **not** "musical silence." Threshold is visible.
- **§9 CORS:** `audio.crossOrigin`, `source class`. The panel reports `CORS suspected` (never confirmed) only when `source class = direct` AND `crossOrigin = anonymous` and the DSP graph reports zero signal — it never claims CORS is the cause without the zero-signal evidence.
- **§10 iOS Gesture:** `user gesture` timestamp, `play() resolved after gesture`, `AudioContext resumed after play`. Distinguishes "play() works but AudioContext stays suspended."
- **§11 Visibility:** `document.visibilityState`, `document.hidden`, `visibilitychange`, `pagehide`, `pageshow` events. If the page goes hidden and the DSP loop stops, the diagnosis surfaces `DSP_INTERRUPTED_BY_LIFECYCLE`.
- **§12 Mobile Browser Info:** Normalized to `iOS Safari | iOS Chrome | Android Chrome | Android Firefox | Desktop Chrome | Desktop Safari | Desktop Firefox | Unknown`. iPadOS 13+ (which masquerades as Mac with `maxTouchPoints > 1`) is correctly classified as iOS.
- **§13 Analysis Loop Health:** `lifecycle`, `actualHz` (rolling), `tickCount`, `lastTickAt`, `ticksLast1s`. Distinguishes "loop expected but not running" / "running but analyser unavailable" / "running but signal zero" / "running and valid signal."
- **§14 Perception Signal:** Per-signal-type counters (last timestamp, last media position are exposed by the orchestrator's `getPerceptionContext`). Orchestrator lifecycle: `inactive|active|degraded`.
- **§15 Evidence Fusion:** `signalsReceived`, `evidenceGenerated`, `momentsGenerated`, `lastMomentAt`, `lastSourceCategories` (`chapter|acoustic|temporal|fused`).
- **§16 Mobile vs Desktop Health Matrix:** Rendered as the spec's `✓ ACTIVE / ⚠ DEGRADED / ✕ FAILED / — NOT INITIALIZED` rows for Playback, AudioContext, Media Source, Analyser, DSP Loop, DSP Signal, Perception, Evidence Fusion.
- **§17 Pipeline Timeline:** Most recent 60 events, each with HH:MM:SS.mmm timestamp and a human label (`audio.play() requested` → `MediaElementAudioSourceNode created` → ...). Capped at 80 events in store.
- **§18 Diagnosis + Evidence[]:** Final primary diagnosis with `evidence[]`. See spec for the full enum (`PIPELINE_ACTIVE` / `PLAYBACK_NOT_STARTED` / `AUDIO_CONTEXT_UNAVAILABLE` / `AUDIO_CONTEXT_SUSPENDED` / `MEDIA_SOURCE_FAILED` / `ANALYSER_UNAVAILABLE` / `DSP_LOOP_NOT_RUNNING` / `DSP_ZERO_SIGNAL` / `DSP_INTERRUPTED_BY_LIFECYCLE` / `CORS_SUSPECTED` / `PERCEPTION_ORCHESTRATOR_INACTIVE` / `NO_SIGNALS_YET` / `UNKNOWN`).

---

## Verifying on Real Devices

Open the **Runtime Diagnostics** drawer in the SPA. The new `Mobile Music Pipeline` section appears directly below `Music Context`.

1. **Desktop Chrome / Safari** (baseline, expect `PIPELINE_ACTIVE`):
   - Press play on a track.
   - Verify: AudioContext = `RUNNING`, Media Source = `REUSED` (or `CREATED` on first track), DSP Loop ≈ 9.5–10.5 Hz, DSP Signal = non-zero (`RMS > 0.01`), Perception = `ACTIVE`, Evidence Fusion = `ACTIVE` (after a few seconds of play).
2. **Android Chrome** (expect similar to desktop; `crossOrigin=anonymous` and `proxy` source class should both work).
3. **iOS Safari** (the suspect device). On first track after page load, expect:
   - `iOS Gesture Chain > user gesture` timestamp populated.
   - `iOS Gesture Chain > play() resolved after gesture` = `YES`.
   - `AudioContext.lifecycle` may show `SUSPENDED` initially, then transition to `RUNNING` only if a gesture-bound `resume()` was reached.
   - The timeline will show the chain. Capture the snapshot if the diagnosis is anything other than `PIPELINE_ACTIVE`.
4. **iOS Chrome / Android Firefox** (if available): note the browser class normalization. iOS Chrome runs on WebKit and inherits the same `crossOrigin=anonymous` quirks as iOS Safari.

---

## What is NOT Done (per the task's explicit "Diagnose Before Fixing" instruction)

- No code change to the DSP loop, AudioContext, MediaElementAudioSourceNode, playback path, unlock path, seek behavior, ducking, SSR F protection, or media proxy.
- No new `audio.play()` call, no new `AudioContext` per track, no new `MediaElementAudioSourceNode`, no second playback path.
- No additional LLM, embedding, Supabase, Pinecone, or backend call from the new instrumentation.
- No polling network endpoint from the DSP provider.

The next phase — once the panel has confirmed the actual mobile failure — is a single, targeted correction (most likely: bind `audioContext.resume()` to the `play()` resolved-Promise / `unlockAudio()` gesture chain). The exact fix depends on what the panel shows on real devices, and per the task instructions, that evidence must be collected before any production change is made.
