import type {
  MusicPerceptionProvider,
  MusicPerceptionSignal,
  MusicPerceptionContext,
  Track,
} from "../types";
import { perceptionTelemetry, type MobileMusicTimelineKind } from "./perceptionTelemetry";

// Global cache to prevent InvalidStateError if the provider is recreated (HMR or reconnect)
const sourceNodeCache = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

const ZERO_SIGNAL_RMS_THRESHOLD = 0.005;
const ZERO_SIGNAL_FRAMES_TO_FLAG = 30;

function recordTimeline(kind: MobileMusicTimelineKind, note?: string): void {
  try {
    perceptionTelemetry.recordMobileMusicTimeline(kind, note);
  } catch {
    /* never let observability crash DSP */
  }
}

function snapshotAudioContext(ctx: AudioContext | null): void {
  if (!ctx) {
    perceptionTelemetry.updateMobileMusicAudioContext({ lifecycle: "absent" });
    return;
  }
  const lifecycle =
    ctx.state === "running"
      ? "running"
      : ctx.state === "suspended"
        ? "suspended"
        : ctx.state === "closed"
          ? "closed"
          : "created";
  perceptionTelemetry.updateMobileMusicAudioContext({
    lifecycle,
    sampleRate: ctx.sampleRate ?? null,
    baseLatency: (ctx as unknown as { baseLatency?: number }).baseLatency ?? null,
    outputLatency: (ctx as unknown as { outputLatency?: number }).outputLatency ?? null,
  });
}

let identityCounter = 1;
const identityMap = new WeakMap<HTMLMediaElement, number>();
function identityKey(el: HTMLMediaElement): number {
  let k = identityMap.get(el);
  if (k == null) {
    k = identityCounter++;
    identityMap.set(el, k);
  }
  return k;
}

export class WebAudioPerceptionProvider implements MusicPerceptionProvider {
  public id = "web_audio_dsp";

  private currentTrack: Track | null = null;
  private currentSessionId: string | null = null;

  private audioElement: HTMLMediaElement | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;

  // Analysis Loop
  private analysisTimer: ReturnType<typeof setInterval> | null = null;
  private pendingSignals: MusicPerceptionSignal[] = [];

  // Buffers
  private timeData: Float32Array | null = null;
  private freqData: Float32Array | null = null;

  // Cooldowns
  private lastTransitionTime = 0;
  private transitionCooldownMs = 3000;
  private lastSilenceEventTime = 0;
  private silenceCooldownMs = 5000;

  // History for rolling baselines
  private energyHistory: number[] = [];
  private fluxHistory: number[] = [];
  private previousFreqData: Float32Array | null = null;

  private isCurrentlySilent = false;
  private silenceStartTime = 0;

  // Track degraded state
  private dspUnavailable = false;

  // DSP loop tick observability (read-only — does not affect DSP math)
  private lastTickAt: number | null = null;
  private tickCount: number = 0;
  private consecutiveZeroFrames: number = 0;

  public initialize(track: Track, sessionId: string): void {
    this.currentTrack = track;
    this.currentSessionId = sessionId;

    // Reset state for new track
    this.lastTransitionTime = 0;
    this.lastSilenceEventTime = 0;
    this.energyHistory = [];
    this.fluxHistory = [];
    this.previousFreqData = null;
    this.isCurrentlySilent = false;
    this.silenceStartTime = 0;
    this.pendingSignals = [];
    this.dspUnavailable = false;
    this.lastTickAt = null;
    this.tickCount = 0;
    this.consecutiveZeroFrames = 0;
    perceptionTelemetry.updateMobileMusicDspLoop({
      tickCount: 0,
      lastTickAt: null,
      ticksLast1s: 0,
      actualHz: 0,
      consecutiveZeroFrames: 0,
      lastFrame: null,
      lifecycle: "stopped",
    });
    perceptionTelemetry.updateMobileMusicPerception({
      lastContextRebuildAt: Date.now(),
      signalsIn: 0,
      signalsOut: 0,
      lastSignalAt: null,
      lastSignalType: null,
      lifecycle: "inactive",
    });
  }

  public setAudioSource(audio: HTMLMediaElement): void {
    if (this.audioElement === audio) return; // already set

    this.audioElement = audio;
    this.dspUnavailable = false;
    perceptionTelemetry.updateMobileMusicMediaElementSource({
      boundElementId: identityKey(audio),
    });

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        console.warn("[WebAudioPerception] Web Audio API not supported.");
        this.dspUnavailable = true;
        perceptionTelemetry.updateMobileMusicAudioContext({ lifecycle: "absent" });
        perceptionTelemetry.updateMobileMusicMediaElementSource({ lifecycle: "absent" });
        return;
      }

      if (!this.audioContext) {
        this.audioContext = new AudioContextClass();
        recordTimeline("audio_context_created");
        snapshotAudioContext(this.audioContext);
      }

      if (!this.analyser) {
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0.5; // Smooths rapid frequency jitter
        this.timeData = new Float32Array(this.analyser.frequencyBinCount);
        this.freqData = new Float32Array(this.analyser.frequencyBinCount);
        perceptionTelemetry.updateMobileMusicAnalyser({
          lifecycle: "created",
          fftSize: this.analyser.fftSize,
          frequencyBinCount: this.analyser.frequencyBinCount,
        });
        recordTimeline("analyser_created");
      }

      // Prevent InvalidStateError by reusing source node if it was already created for this element
      if (sourceNodeCache.has(audio)) {
        this.sourceNode = sourceNodeCache.get(audio)!;
        try {
          this.sourceNode.disconnect();
        } catch (e) {} // Disconnect from previous destination if any
        perceptionTelemetry.updateMobileMusicMediaElementSource({
          lifecycle: "reused",
          invalidStateError: false,
          boundElementId: identityKey(audio),
        });
        recordTimeline("media_element_source_reused");
      } else {
        try {
          this.sourceNode = this.audioContext.createMediaElementSource(audio);
          sourceNodeCache.set(audio, this.sourceNode);
          perceptionTelemetry.updateMobileMusicMediaElementSource({
            lifecycle: "created",
            invalidStateError: false,
            boundElementId: identityKey(audio),
          });
          recordTimeline("media_element_source_created");
        } catch (e: any) {
          console.warn(
            "[WebAudioPerception] Failed to create MediaElementSource. Disabling DSP.",
            e,
          );
          this.dspUnavailable = true;
          const invalid = e?.name === "InvalidStateError";
          perceptionTelemetry.updateMobileMusicMediaElementSource({
            lifecycle: "failed",
            invalidStateError: invalid,
            boundElementId: identityKey(audio),
          });
          recordTimeline("media_element_source_failed", `name=${e?.name || "?"}`);
          return;
        }
      }

      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
    } catch (e) {
      console.warn("[WebAudioPerception] Failed to initialize Web Audio graph:", e);
      this.dspUnavailable = true;
    }
  }

  private startAnalysisLoop() {
    if (this.analysisTimer) return;
    this.analysisTimer = setInterval(() => {
      this.runAnalysis();
    }, 100); // 10Hz
    recordTimeline("dsp_loop_started");
    perceptionTelemetry.updateMobileMusicDspLoop({ lifecycle: "running" });
  }

  private stopAnalysisLoop() {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
      recordTimeline("dsp_loop_stopped");
      perceptionTelemetry.updateMobileMusicDspLoop({ lifecycle: "stopped" });
    }
  }

  private runAnalysis() {
    if (
      this.dspUnavailable ||
      !this.currentTrack ||
      !this.currentSessionId ||
      !this.audioContext ||
      !this.analyser ||
      !this.timeData ||
      !this.freqData ||
      !this.audioElement
    ) {
      return;
    }

    if (this.audioElement.paused) {
      return;
    }

    // Try to resume AudioContext if suspended (e.g. iOS requires user interaction)
    if (this.audioContext.state === "suspended") {
      perceptionTelemetry.updateMobileMusicAudioContext((prev) => ({
        ...prev,
        resumeRequested: prev.resumeRequested + 1,
        lastResumeReason: "playback_started",
      }));
      recordTimeline("audio_context_resume_requested", "auto from DSP loop");
      this.audioContext
        .resume()
        .then(() => {
          perceptionTelemetry.updateMobileMusicAudioContext((prev) => ({
            ...prev,
            resumeResolved: prev.resumeResolved + 1,
          }));
          recordTimeline("audio_context_resume_resolved");
          recordTimeline("audio_context_state_running");
          // Reconnect gesture chain: a play() that resolved inside a user
          // gesture is the only way the AudioContext can transition out of
          // "suspended" without the page being backgrounded.
          perceptionTelemetry.updateMobileMusicGesture({
            audioContextResumedAfterPlay:
              perceptionTelemetry.getMobileMusicPipeline().gesture.playResolvedAfterGesture ?? null,
          });
          snapshotAudioContext(this.audioContext);
        })
        .catch((err) => {
          perceptionTelemetry.updateMobileMusicAudioContext((prev) => ({
            ...prev,
            resumeRejected: prev.resumeRejected + 1,
          }));
          recordTimeline(
            "audio_context_resume_rejected",
            `name=${(err as { name?: string } | undefined)?.name || "?"}`,
          );
        });
      // Important: this code RETURNS here. The suspended branch never
      // produces a DSP frame, which is part of the diagnostic story.
      return;
    }

    const now = Date.now();
    const priorTickAt = this.lastTickAt;
    this.lastTickAt = now;
    const tickCount = (this.tickCount += 1);

    // 1. Get Data
    // timeData and freqData are always created with new Float32Array(size) which uses ArrayBuffer,
    // but TypeScript infers Float32Array<ArrayBufferLike>. Cast to the expected type.
    this.analyser.getFloatTimeDomainData(this.timeData as Float32Array<ArrayBuffer>);
    this.analyser.getFloatFrequencyData(this.freqData as Float32Array<ArrayBuffer>);

    // 2. Compute RMS Energy
    let sumSquares = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      sumSquares += this.timeData[i] * this.timeData[i];
    }
    const rms = Math.sqrt(sumSquares / this.timeData.length);

    // 3. Compute Spectral Flux
    let flux = 0;
    if (this.previousFreqData) {
      for (let i = 0; i < this.freqData.length; i++) {
        const diff = this.freqData[i] - this.previousFreqData[i];
        if (diff > 0) flux += diff;
      }
    } else {
      this.previousFreqData = new Float32Array(this.freqData.length);
    }
    this.previousFreqData.set(this.freqData);

    // 3b. High-frequency energy: sum of freqData above 4 kHz (approximate;
    // bin index 4kHz / (sampleRate/2) * frequencyBinCount). We expose the
    // raw value (negative dB) — never the underlying array.
    const sr = this.audioContext.sampleRate || 48000;
    const binHz = sr / 2 / this.analyser.frequencyBinCount;
    const highStart = Math.max(0, Math.floor(4000 / Math.max(1, binHz)));
    let hfSum = 0;
    for (let i = highStart; i < this.freqData.length; i++) hfSum += this.freqData[i];
    const highFreqEnergy = hfSum / Math.max(1, this.freqData.length - highStart);

    // ── DSP loop observability ────────────────────────────────────
    const ticksLast1s =
      priorTickAt && now - priorTickAt <= 1000
        ? // count of ticks whose timestamp is within the last 1s window — we
          // maintain a rolling estimate by tracking an exponential moving avg
          // of dt between consecutive ticks. 1000 / avg_dt_ms.
          Math.min(60, Math.round(1000 / Math.max(1, now - priorTickAt)))
        : 0;
    const actualHz = ticksLast1s > 0 ? ticksLast1s : 0;
    const zeroFrame = rms < ZERO_SIGNAL_RMS_THRESHOLD;
    const consec = zeroFrame ? this.consecutiveZeroFrames + 1 : 0;
    this.consecutiveZeroFrames = consec;
    if (zeroFrame && consec === ZERO_SIGNAL_FRAMES_TO_FLAG) {
      recordTimeline("dsp_zero_signal_frame", `${consec} consecutive frames near zero`);
    } else if (!zeroFrame && this.consecutiveZeroFrames > 0) {
      recordTimeline("dsp_signal_recovered", `RMS=${rms.toFixed(4)}`);
    }
    perceptionTelemetry.updateMobileMusicDspLoop({
      lifecycle: "running",
      tickCount,
      lastTickAt: now,
      ticksLast1s,
      actualHz,
      lastFrame: {
        rms,
        spectralFlux: flux,
        highFreqEnergy,
        zeroSignalThreshold: ZERO_SIGNAL_RMS_THRESHOLD,
      },
      consecutiveZeroFrames: consec,
    });
    perceptionTelemetry.updateMobileMusicAnalyser({ lifecycle: "active" });
    snapshotAudioContext(this.audioContext);

    // 4. Update Rolling History
    this.energyHistory.push(rms);
    this.fluxHistory.push(flux);

    const maxHistoryLength = 30; // 3 seconds at 10Hz
    if (this.energyHistory.length > maxHistoryLength) this.energyHistory.shift();
    if (this.fluxHistory.length > maxHistoryLength) this.fluxHistory.shift();

    if (this.energyHistory.length < 10) {
      return; // Wait for baseline to stabilize
    }

    // 5. Silence Detection
    const silenceThreshold = 0.005; // tiny RMS
    if (rms < silenceThreshold) {
      if (!this.isCurrentlySilent) {
        this.isCurrentlySilent = true;
        this.silenceStartTime = now;
      } else if (now - this.silenceStartTime > 1000) {
        if (now - this.lastSilenceEventTime > this.silenceCooldownMs) {
          this.lastSilenceEventTime = now;
          this.pendingSignals.push(
            this.createSignal("silence", 1.0, { durationMs: now - this.silenceStartTime }),
          );
        }
      }
    } else {
      this.isCurrentlySilent = false;
    }

    if (this.isCurrentlySilent) return;

    // 6. Detect Transitions (Energy / Flux)
    const baselineEnergy =
      this.energyHistory.slice(0, -3).reduce((a, b) => a + b, 0) /
      Math.max(1, this.energyHistory.length - 3);
    const baselineFlux =
      this.fluxHistory.slice(0, -3).reduce((a, b) => a + b, 0) /
      Math.max(1, this.fluxHistory.length - 3);

    const energyRatio = rms / (baselineEnergy + 0.0001);
    const fluxRatio = flux / (baselineFlux + 0.0001);

    const isEnergySurge = energyRatio > 1.8;
    const isFluxSurge = fluxRatio > 2.0;

    if (
      (isEnergySurge || isFluxSurge) &&
      now - this.lastTransitionTime > this.transitionCooldownMs
    ) {
      this.lastTransitionTime = now;

      const evidence = [];
      if (isEnergySurge) evidence.push("energy_increase");
      if (isFluxSurge) evidence.push("spectral_shift");

      let type: "transition" | "energy_change" = "transition";
      let confidence = 0.6;
      if (isEnergySurge && isFluxSurge) {
        confidence = 0.85; // Strong acoustic transition
      } else if (isEnergySurge) {
        type = "energy_change";
        confidence = 0.7;
      } else {
        type = "transition"; // Spectral shift only, treated as transition
        confidence = 0.65;
      }

      this.pendingSignals.push(
        this.createSignal(type, confidence, {
          evidence,
          energyRatio,
          fluxRatio,
          rms,
          baselineEnergy,
        }),
      );
    }
  }

  public update(positionMs: number): MusicPerceptionSignal | null {
    if (this.dspUnavailable || !this.audioElement) return null;

    if (!this.audioElement.paused) {
      this.startAnalysisLoop();
      perceptionTelemetry.updateMobileMusicPerception({ lifecycle: "active" });
    } else {
      this.stopAnalysisLoop();
      perceptionTelemetry.updateMobileMusicPerception({ lifecycle: "inactive" });
    }

    // Drain pending signals (return the first one, or null)
    if (this.pendingSignals.length > 0) {
      const sig = this.pendingSignals.shift() || null;
      if (sig) {
        perceptionTelemetry.updateMobileMusicPerception({
          signalsOut: perceptionTelemetry.getMobileMusicPipeline().perception.signalsOut + 1,
          lastSignalAt: Date.now(),
          lastSignalType: sig.type,
        });
      }
      return sig;
    }

    return null;
  }

  private createSignal(
    type:
      | "section"
      | "transition"
      | "energy_change"
      | "silence"
      | "onset"
      | "tempo_change"
      | "vocal_presence"
      | "instrumental_presence"
      | "unknown",
    confidence: number,
    metadata: Record<string, unknown>,
  ): MusicPerceptionSignal {
    // Derive timestamp from authoritative media position
    const timestampMs = this.audioElement
      ? Math.floor(this.audioElement.currentTime * 1000)
      : Date.now();
    return {
      type,
      trackId: this.currentTrack!.id,
      sessionId: this.currentSessionId!,
      timestampMs,
      confidence,
      source: this.id,
      metadata,
    };
  }

  public getCurrentContext(): MusicPerceptionContext | null {
    return null;
  }

  public deactivate(): void {
    this.stopAnalysisLoop();
  }

  public dispose(): void {
    this.stopAnalysisLoop();
    this.pendingSignals = [];
    this.lastTickAt = null;
    this.tickCount = 0;
    this.consecutiveZeroFrames = 0;
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (e) {}
      this.sourceNode = null;
    }
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch (e) {}
      this.audioContext = null;
    }
    this.analyser = null;
    this.audioElement = null;
    this.dspUnavailable = false;
  }
}
